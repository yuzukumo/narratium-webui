package provider

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

const defaultOpenAIBaseURL = "https://api.openai.com"

type OpenAI struct {
	client             baseClient
	apiFormat          string
	configurationError error
}

func NewOpenAI(apiKey string, options ...Option) *OpenAI {
	client := newBaseClient(
		KindOpenAI,
		apiKey,
		defaultOpenAIBaseURL,
		DefaultOpenAIModel,
		options...,
	)
	apiFormat, err := normalizeOpenAIAPIFormat(client.apiFormat)
	return &OpenAI{client: client, apiFormat: apiFormat, configurationError: err}
}

func (provider *OpenAI) Kind() Kind { return KindOpenAI }

func (provider *OpenAI) String() string {
	return fmt.Sprintf("provider.OpenAI{baseURL:%q, defaultModel:%q, apiFormat:%q, apiKey:<redacted>}", provider.client.baseURL, provider.client.defaultModel, provider.apiFormat)
}

func (provider *OpenAI) GoString() string { return provider.String() }

// OpenAIPromptCacheKey returns the deterministic key used to route requests
// with the same model and stable system prefix to the same prompt cache.
func OpenAIPromptCacheKey(model, stableSystemPrefix string) string {
	seed := strings.ToLower(strings.TrimSpace(model)) + "\x00" + strings.TrimSpace(stableSystemPrefix)
	digest := sha256.Sum256([]byte(seed))
	return "narratium:" + hex.EncodeToString(digest[:16])
}

func normalizeOpenAIAPIFormat(apiFormat string) (string, error) {
	apiFormat = strings.ToLower(strings.TrimSpace(apiFormat))
	if apiFormat == "" {
		return OpenAIAPIFormatResponses, nil
	}
	switch apiFormat {
	case OpenAIAPIFormatResponses, OpenAIAPIFormatChatCompletions:
		return apiFormat, nil
	default:
		return "", fmt.Errorf(
			"%w: unsupported OpenAI API format %q; supported formats are %q and %q",
			ErrInvalidRequest, apiFormat, OpenAIAPIFormatResponses, OpenAIAPIFormatChatCompletions,
		)
	}
}

func (provider *OpenAI) Generate(ctx context.Context, request Request) (*Response, error) {
	if provider.configurationError != nil {
		return nil, provider.configurationError
	}
	normalized, err := provider.client.normalize(request)
	if err != nil {
		return nil, err
	}
	if provider.apiFormat == OpenAIAPIFormatChatCompletions {
		return provider.generateChatCompletions(ctx, normalized)
	}
	return provider.generateResponse(ctx, normalized)
}

func (provider *OpenAI) generateResponse(ctx context.Context, normalized normalizedRequest) (*Response, error) {
	endpoint, err := resolveEndpoint(provider.client.baseURL, "v1", "responses")
	if err != nil {
		return nil, err
	}
	httpRequest, err := newJSONRequest(ctx, endpoint, openAIRequestPayloadWithPromptCacheKey(
		normalized, false, provider.client.promptCacheKeyEnabled,
	))
	if err != nil {
		return nil, err
	}
	provider.setHeaders(httpRequest, false)

	httpResponse, err := provider.client.do(httpRequest)
	if err != nil {
		return nil, err
	}
	defer httpResponse.Body.Close()
	if err := provider.client.requireSuccess(httpResponse); err != nil {
		return nil, err
	}
	body, err := readLimited(httpResponse.Body, maxResponseBytes)
	if err != nil {
		return nil, fmt.Errorf("read OpenAI response: %w", err)
	}

	var wire openAIResponseWire
	if err := json.Unmarshal(body, &wire); err != nil {
		return nil, fmt.Errorf("decode OpenAI response: %w", err)
	}
	return normalizeOpenAIResponse(wire, body, normalized.model, "")
}

func (provider *OpenAI) Stream(ctx context.Context, request Request) (<-chan Event, error) {
	if provider.configurationError != nil {
		return nil, provider.configurationError
	}
	normalized, err := provider.client.normalize(request)
	if err != nil {
		return nil, err
	}
	if provider.apiFormat == OpenAIAPIFormatChatCompletions {
		return provider.streamChatCompletions(ctx, normalized)
	}
	return provider.streamResponse(ctx, normalized)
}

func (provider *OpenAI) streamResponse(ctx context.Context, normalized normalizedRequest) (<-chan Event, error) {
	endpoint, err := resolveEndpoint(provider.client.baseURL, "v1", "responses")
	if err != nil {
		return nil, err
	}
	httpRequest, err := newJSONRequest(ctx, endpoint, openAIRequestPayloadWithPromptCacheKey(
		normalized, true, provider.client.promptCacheKeyEnabled,
	))
	if err != nil {
		return nil, err
	}
	provider.setHeaders(httpRequest, true)

	httpResponse, err := provider.client.do(httpRequest)
	if err != nil {
		return nil, err
	}
	if err := provider.client.requireSuccess(httpResponse); err != nil {
		httpResponse.Body.Close()
		return nil, err
	}

	events := startStream(ctx, httpResponse, func(emit func(Event) error) error {
		return parseOpenAIStream(httpResponse, normalized.model, emit)
	})
	return events, nil
}

func (provider *OpenAI) setHeaders(request *http.Request, stream bool) {
	request.Header.Set("Authorization", "Bearer "+provider.client.apiKey)
	if stream {
		request.Header.Set("Accept", "text/event-stream")
	} else {
		request.Header.Set("Accept", "application/json")
	}
}

func openAIRequestPayload(request normalizedRequest, stream bool) map[string]any {
	return openAIRequestPayloadWithPromptCacheKey(request, stream, true)
}

func openAIRequestPayloadWithPromptCacheKey(request normalizedRequest, stream, promptCacheKeyEnabled bool) map[string]any {
	payload := map[string]any{
		"model":             request.model,
		"input":             openAIInput(request.messages),
		"max_output_tokens": request.maxOutputTokens,
	}
	if request.system != "" {
		payload["instructions"] = request.system
	}
	if promptCacheKeyEnabled && request.stableSystem != "" {
		payload["prompt_cache_key"] = OpenAIPromptCacheKey(request.model, request.stableSystem)
	}
	if request.reasoning != nil {
		effort := "none"
		if request.reasoning.Enabled {
			effort = request.reasoning.Effort
		}
		payload["reasoning"] = map[string]any{"effort": effort}
	}
	if !isGPT5Model(request.model) {
		if request.temperature != nil {
			payload["temperature"] = *request.temperature
		}
		if request.topP != nil {
			payload["top_p"] = *request.topP
		}
	}
	if stream {
		payload["stream"] = true
	}
	return payload
}

func openAIInput(messages []Message) any {
	if len(messages) == 1 && messages[0].Role == RoleUser {
		return messages[0].Content
	}
	input := make([]map[string]string, 0, len(messages))
	for _, message := range messages {
		input = append(input, map[string]string{
			"role":    string(message.Role),
			"content": message.Content,
		})
	}
	return input
}

func isGPT5Model(model string) bool {
	normalized := strings.ToLower(strings.TrimSpace(model))
	if slash := strings.LastIndexByte(normalized, '/'); slash >= 0 {
		normalized = normalized[slash+1:]
	}
	if !strings.HasPrefix(normalized, "gpt-5") {
		return false
	}
	return len(normalized) == len("gpt-5") || normalized[len("gpt-5")] == '-' || normalized[len("gpt-5")] == '.'
}

type openAIResponseWire struct {
	ID                string                       `json:"id"`
	Type              string                       `json:"type"`
	Model             string                       `json:"model"`
	Status            string                       `json:"status"`
	OutputText        string                       `json:"output_text"`
	Output            []openAIOutputWire           `json:"output"`
	Usage             *openAIUsageWire             `json:"usage"`
	Error             json.RawMessage              `json:"error"`
	IncompleteDetails *openAIIncompleteDetailsWire `json:"incomplete_details"`
}

type openAIIncompleteDetailsWire struct {
	Reason string `json:"reason"`
}

type openAIOutputWire struct {
	Type    string                  `json:"type"`
	Content []openAIContentPartWire `json:"content"`
}

type openAIContentPartWire struct {
	Type    string `json:"type"`
	Text    string `json:"text"`
	Refusal string `json:"refusal"`
}

type openAIUsageWire struct {
	InputTokens              int64                   `json:"input_tokens"`
	PromptTokens             int64                   `json:"prompt_tokens"`
	OutputTokens             int64                   `json:"output_tokens"`
	CompletionTokens         int64                   `json:"completion_tokens"`
	TotalTokens              int64                   `json:"total_tokens"`
	CachedTokens             int64                   `json:"cached_tokens"`
	PromptCacheHitTokens     int64                   `json:"prompt_cache_hit_tokens"`
	CacheReadInputTokens     int64                   `json:"cache_read_input_tokens"`
	CacheCreationInputTokens int64                   `json:"cache_creation_input_tokens"`
	CacheCreationTokens      int64                   `json:"cache_creation_tokens"`
	CacheWriteInputTokens    int64                   `json:"cache_write_input_tokens"`
	CacheWriteTokens         int64                   `json:"cache_write_tokens"`
	InputTokensDetails       openAIInputDetailsWire  `json:"input_tokens_details"`
	PromptTokensDetails      openAIInputDetailsWire  `json:"prompt_tokens_details"`
	OutputTokensDetails      openAIOutputDetailsWire `json:"output_tokens_details"`
	CompletionTokensDetails  openAIOutputDetailsWire `json:"completion_tokens_details"`
}

type openAIInputDetailsWire struct {
	CachedTokens        int64 `json:"cached_tokens"`
	CacheCreationTokens int64 `json:"cache_creation_tokens"`
	CacheWriteTokens    int64 `json:"cache_write_tokens"`
}

type openAIOutputDetailsWire struct {
	ReasoningTokens int64 `json:"reasoning_tokens"`
}

func normalizeOpenAIResponse(wire openAIResponseWire, raw []byte, fallbackModel, streamedText string) (*Response, error) {
	if wire.Type == "error" || strings.EqualFold(wire.Status, "failed") || hasJSONValue(wire.Error) {
		upstreamError := parseUpstreamError(KindOpenAI, http.StatusOK, nil, raw, "OpenAI response failed")
		upstreamError.Usage = normalizeOpenAIUsage(wire.Usage)
		return nil, upstreamError
	}

	text := extractOpenAIText(wire)
	if text == "" {
		text = streamedText
	}
	if strings.TrimSpace(text) == "" {
		return nil, fmt.Errorf("%w: OpenAI", ErrEmptyResponse)
	}
	model := wire.Model
	if model == "" {
		model = fallbackModel
	}
	finishReason := wire.Status
	if wire.IncompleteDetails != nil && wire.IncompleteDetails.Reason != "" {
		finishReason = wire.IncompleteDetails.Reason
	}
	return &Response{
		ID:           wire.ID,
		Model:        model,
		Text:         text,
		FinishReason: finishReason,
		Usage:        normalizeOpenAIUsage(wire.Usage),
		Raw:          append(json.RawMessage(nil), raw...),
	}, nil
}

func extractOpenAIText(response openAIResponseWire) string {
	if response.OutputText != "" {
		return response.OutputText
	}
	var result strings.Builder
	for _, output := range response.Output {
		if output.Type != "message" && output.Type != "" {
			continue
		}
		for _, part := range output.Content {
			switch part.Type {
			case "output_text", "text", "":
				result.WriteString(part.Text)
			case "refusal":
				result.WriteString(part.Refusal)
			}
		}
	}
	return result.String()
}

func normalizeOpenAIUsage(wire *openAIUsageWire) Usage {
	if wire == nil {
		return Usage{}
	}
	input := firstNonZero(wire.InputTokens, wire.PromptTokens)
	output := firstNonZero(wire.OutputTokens, wire.CompletionTokens)
	cacheRead := firstNonZero(
		wire.InputTokensDetails.CachedTokens,
		wire.PromptTokensDetails.CachedTokens,
		wire.CachedTokens,
		wire.PromptCacheHitTokens,
		wire.CacheReadInputTokens,
	)
	cacheCreation := firstNonZero(
		wire.CacheCreationInputTokens,
		wire.InputTokensDetails.CacheCreationTokens,
		wire.PromptTokensDetails.CacheCreationTokens,
		wire.InputTokensDetails.CacheWriteTokens,
		wire.PromptTokensDetails.CacheWriteTokens,
		wire.CacheWriteInputTokens,
		wire.CacheCreationTokens,
		wire.CacheWriteTokens,
	)
	ordinaryInput := max(input-cacheRead-cacheCreation, 0)
	total := wire.TotalTokens
	if total == 0 {
		total = ordinaryInput + cacheRead + cacheCreation + output
	}
	return Usage{
		InputTokens:              ordinaryInput,
		OutputTokens:             output,
		TotalTokens:              total,
		ReasoningTokens:          firstNonZero(wire.OutputTokensDetails.ReasoningTokens, wire.CompletionTokensDetails.ReasoningTokens),
		CacheReadInputTokens:     cacheRead,
		CacheCreationInputTokens: cacheCreation,
	}
}

func parseOpenAIStream(response *http.Response, model string, emit func(Event) error) error {
	var accumulated strings.Builder
	terminal := false

	err := parseWireEvents(response.Body, response.Header.Get("Content-Type"), func(event wireEvent) error {
		if strings.TrimSpace(string(event.data)) == "[DONE]" {
			return nil
		}
		var envelope struct {
			Type     string          `json:"type"`
			Delta    string          `json:"delta"`
			Response json.RawMessage `json:"response"`
			Usage    json.RawMessage `json:"usage"`
			Error    json.RawMessage `json:"error"`
		}
		if err := json.Unmarshal(event.data, &envelope); err != nil {
			return fmt.Errorf("decode OpenAI stream event: %w", err)
		}
		eventType := envelope.Type
		if eventType == "" {
			eventType = event.name
		}
		if eventType == "error" || hasJSONValue(envelope.Error) {
			return openAIStreamError(response.Header, event.data, envelope.Response, envelope.Usage, "OpenAI stream failed")
		}

		switch eventType {
		case "response.output_text.delta":
			if envelope.Delta == "" {
				return nil
			}
			accumulated.WriteString(envelope.Delta)
			return emit(Event{Type: EventDelta, Delta: envelope.Delta})

		case "response.failed":
			return openAIStreamError(response.Header, event.data, envelope.Response, envelope.Usage, "OpenAI response failed")

		case "response.completed", "response.done", "response.incomplete":
			if terminal {
				return nil
			}
			if !hasJSONValue(envelope.Response) {
				return fmt.Errorf("OpenAI terminal event has no response")
			}
			var wire openAIResponseWire
			if err := json.Unmarshal(envelope.Response, &wire); err != nil {
				return fmt.Errorf("decode OpenAI terminal response: %w", err)
			}
			if wire.Usage == nil && hasJSONValue(envelope.Usage) {
				var usage openAIUsageWire
				if err := json.Unmarshal(envelope.Usage, &usage); err == nil {
					wire.Usage = &usage
				}
			}
			normalized, err := normalizeOpenAIResponse(wire, envelope.Response, model, accumulated.String())
			if err != nil {
				return err
			}
			terminal = true
			return emit(completedEvent(normalized))
		}
		return nil
	})
	if err != nil {
		return err
	}
	if !terminal {
		return fmt.Errorf("%w: OpenAI", ErrStreamTerminated)
	}
	return nil
}

func openAIStreamError(headers http.Header, raw, responseRaw, usageRaw json.RawMessage, fallback string) *UpstreamError {
	upstreamError := parseUpstreamError(KindOpenAI, http.StatusOK, headers, raw, fallback)
	var usage *openAIUsageWire
	if hasJSONValue(responseRaw) {
		var response openAIResponseWire
		if json.Unmarshal(responseRaw, &response) == nil {
			usage = response.Usage
		}
	}
	if usage == nil && hasJSONValue(usageRaw) {
		var decoded openAIUsageWire
		if json.Unmarshal(usageRaw, &decoded) == nil {
			usage = &decoded
		}
	}
	upstreamError.Usage = normalizeOpenAIUsage(usage)
	return upstreamError
}

func hasJSONValue(raw json.RawMessage) bool {
	trimmed := strings.TrimSpace(string(raw))
	return trimmed != "" && trimmed != "null"
}

func firstNonZero(values ...int64) int64 {
	for _, value := range values {
		if value != 0 {
			return value
		}
	}
	return 0
}
