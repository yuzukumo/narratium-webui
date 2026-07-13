package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

const (
	defaultAnthropicBaseURL = "https://api.anthropic.com"
	anthropicVersion        = "2023-06-01"
	maxAnthropicBreakpoints = 4
)

type Anthropic struct {
	client baseClient
}

func NewAnthropic(apiKey string, options ...Option) *Anthropic {
	return &Anthropic{client: newBaseClient(
		KindAnthropic,
		apiKey,
		defaultAnthropicBaseURL,
		DefaultAnthropicModel,
		options...,
	)}
}

func (provider *Anthropic) Kind() Kind { return KindAnthropic }

func (provider *Anthropic) String() string {
	return fmt.Sprintf("provider.Anthropic{baseURL:%q, defaultModel:%q, apiKey:<redacted>}", provider.client.baseURL, provider.client.defaultModel)
}

func (provider *Anthropic) GoString() string { return provider.String() }

func (provider *Anthropic) Generate(ctx context.Context, request Request) (*Response, error) {
	normalized, err := provider.client.normalize(request)
	if err != nil {
		return nil, err
	}
	endpoint, err := resolveEndpoint(provider.client.baseURL, "v1", "messages")
	if err != nil {
		return nil, err
	}
	httpRequest, err := newJSONRequest(ctx, endpoint, anthropicRequestPayload(normalized, false))
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
		return nil, fmt.Errorf("read Anthropic response: %w", err)
	}

	var wire anthropicResponseWire
	if err := json.Unmarshal(body, &wire); err != nil {
		return nil, fmt.Errorf("decode Anthropic response: %w", err)
	}
	return normalizeAnthropicResponse(wire, body, normalized.model, "")
}

func (provider *Anthropic) Stream(ctx context.Context, request Request) (<-chan Event, error) {
	normalized, err := provider.client.normalize(request)
	if err != nil {
		return nil, err
	}
	endpoint, err := resolveEndpoint(provider.client.baseURL, "v1", "messages")
	if err != nil {
		return nil, err
	}
	httpRequest, err := newJSONRequest(ctx, endpoint, anthropicRequestPayload(normalized, true))
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
		return parseAnthropicStream(httpResponse, normalized.model, emit)
	})
	return events, nil
}

func (provider *Anthropic) setHeaders(request *http.Request, stream bool) {
	request.Header.Set("x-api-key", provider.client.apiKey)
	request.Header.Set("anthropic-version", anthropicVersion)
	if stream {
		request.Header.Set("Accept", "text/event-stream")
	} else {
		request.Header.Set("Accept", "application/json")
	}
}

func anthropicRequestPayload(request normalizedRequest, stream bool) map[string]any {
	payload := map[string]any{
		"model":      request.model,
		"max_tokens": request.maxOutputTokens,
	}

	system, systemBreakpoints := anthropicSystemBlocks(request.system, request.stableSystem)
	if system != nil {
		payload["system"] = system
	}
	messageBreakpoints := selectAnthropicMessageBreakpoints(request.messages, maxAnthropicBreakpoints-systemBreakpoints)
	messages := make([]map[string]any, 0, len(request.messages))
	for index, message := range request.messages {
		content := any(message.Content)
		if messageBreakpoints[index] {
			content = []map[string]any{{
				"type":          "text",
				"text":          message.Content,
				"cache_control": map[string]string{"type": "ephemeral"},
			}}
		}
		messages = append(messages, map[string]any{
			"role":    string(message.Role),
			"content": content,
		})
	}
	payload["messages"] = messages

	if request.temperature != nil {
		payload["temperature"] = *request.temperature
	}
	if request.topP != nil {
		payload["top_p"] = *request.topP
	}
	if len(request.stopSequences) > 0 {
		payload["stop_sequences"] = request.stopSequences
	}
	if request.reasoning != nil {
		if request.reasoning.Enabled {
			payload["output_config"] = map[string]string{"effort": request.reasoning.Effort}
			payload["thinking"] = map[string]string{"type": "adaptive"}
		} else {
			payload["thinking"] = map[string]string{"type": "disabled"}
		}
	}
	if stream {
		payload["stream"] = true
	}
	return payload
}

func anthropicSystemBlocks(system, stablePrefix string) (any, int) {
	if system == "" {
		return nil, 0
	}
	if stablePrefix == "" {
		return system, 0
	}

	blocks := []map[string]any{{
		"type":          "text",
		"text":          stablePrefix,
		"cache_control": map[string]string{"type": "ephemeral"},
	}}
	if remainder := strings.TrimPrefix(system, stablePrefix); remainder != "" {
		blocks = append(blocks, map[string]any{
			"type": "text",
			"text": remainder,
		})
	}
	return blocks, 1
}

func selectAnthropicMessageBreakpoints(messages []Message, allowance int) map[int]bool {
	selected := make(map[int]bool)
	for index := len(messages) - 1; index >= 0 && allowance > 0; index-- {
		if messages[index].CacheBreakpoint {
			selected[index] = true
			allowance--
		}
	}
	return selected
}

type anthropicResponseWire struct {
	ID           string                      `json:"id"`
	Type         string                      `json:"type"`
	Role         string                      `json:"role"`
	Model        string                      `json:"model"`
	Content      []anthropicContentBlockWire `json:"content"`
	StopReason   string                      `json:"stop_reason"`
	StopSequence *string                     `json:"stop_sequence"`
	Usage        anthropicUsageWire          `json:"usage"`
	Error        json.RawMessage             `json:"error"`
}

type anthropicContentBlockWire struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type anthropicUsageWire struct {
	InputTokens              *int64                      `json:"input_tokens"`
	OutputTokens             *int64                      `json:"output_tokens"`
	CacheCreationInputTokens *int64                      `json:"cache_creation_input_tokens"`
	CacheReadInputTokens     *int64                      `json:"cache_read_input_tokens"`
	CachedTokens             *int64                      `json:"cached_tokens"`
	CacheCreation            *anthropicCacheCreationWire `json:"cache_creation"`
}

type anthropicCacheCreationWire struct {
	Ephemeral5mInputTokens *int64 `json:"ephemeral_5m_input_tokens"`
	Ephemeral1hInputTokens *int64 `json:"ephemeral_1h_input_tokens"`
}

func normalizeAnthropicResponse(wire anthropicResponseWire, raw []byte, fallbackModel, streamedText string) (*Response, error) {
	if wire.Type == "error" || hasJSONValue(wire.Error) {
		return nil, parseUpstreamError(KindAnthropic, http.StatusOK, nil, raw, "Anthropic response failed")
	}
	text := streamedText
	if text == "" {
		text = extractAnthropicText(wire.Content)
	}
	if strings.TrimSpace(text) == "" {
		return nil, fmt.Errorf("%w: Anthropic", ErrEmptyResponse)
	}
	model := wire.Model
	if model == "" {
		model = fallbackModel
	}
	return &Response{
		ID:           wire.ID,
		Model:        model,
		Text:         text,
		FinishReason: wire.StopReason,
		Usage:        normalizeAnthropicUsage(&wire.Usage),
		Raw:          append(json.RawMessage(nil), raw...),
	}, nil
}

func extractAnthropicText(content []anthropicContentBlockWire) string {
	var result strings.Builder
	for _, block := range content {
		if block.Type == "text" || block.Type == "" {
			result.WriteString(block.Text)
		}
	}
	return result.String()
}

func normalizeAnthropicUsage(wire *anthropicUsageWire) Usage {
	if wire == nil {
		return Usage{}
	}
	input := int64Value(wire.InputTokens)
	output := int64Value(wire.OutputTokens)
	cacheRead := int64Value(wire.CacheReadInputTokens)
	if cacheRead == 0 {
		cacheRead = int64Value(wire.CachedTokens)
	}
	cacheCreation := int64Value(wire.CacheCreationInputTokens)
	if cacheCreation == 0 && wire.CacheCreation != nil {
		cacheCreation = int64Value(wire.CacheCreation.Ephemeral5mInputTokens) +
			int64Value(wire.CacheCreation.Ephemeral1hInputTokens)
	}
	return Usage{
		InputTokens:              input,
		OutputTokens:             output,
		TotalTokens:              input + output + cacheRead + cacheCreation,
		CacheReadInputTokens:     cacheRead,
		CacheCreationInputTokens: cacheCreation,
	}
}

func parseAnthropicStream(response *http.Response, model string, emit func(Event) error) error {
	var accumulated strings.Builder
	var message anthropicResponseWire
	var usage anthropicUsageWire
	terminal := false

	err := parseWireEvents(response.Body, response.Header.Get("Content-Type"), func(event wireEvent) error {
		if strings.TrimSpace(string(event.data)) == "[DONE]" {
			return nil
		}
		var envelope struct {
			Type         string                     `json:"type"`
			Message      *anthropicResponseWire     `json:"message"`
			ContentBlock *anthropicContentBlockWire `json:"content_block"`
			Delta        *anthropicDeltaWire        `json:"delta"`
			Usage        *anthropicUsageWire        `json:"usage"`
			Error        json.RawMessage            `json:"error"`
		}
		if err := json.Unmarshal(event.data, &envelope); err != nil {
			return fmt.Errorf("decode Anthropic stream event: %w", err)
		}
		eventType := envelope.Type
		if eventType == "" {
			eventType = event.name
		}
		if eventType == "error" || hasJSONValue(envelope.Error) {
			return parseUpstreamError(KindAnthropic, http.StatusOK, response.Header, event.data, "Anthropic stream failed")
		}

		switch eventType {
		case "message_start":
			if envelope.Message == nil {
				return nil
			}
			message = *envelope.Message
			mergeAnthropicUsage(&usage, &envelope.Message.Usage)
			initial := extractAnthropicText(message.Content)
			if initial != "" {
				accumulated.WriteString(initial)
				return emit(Event{Type: EventDelta, Delta: initial})
			}

		case "content_block_start":
			if envelope.ContentBlock != nil && envelope.ContentBlock.Type == "text" && envelope.ContentBlock.Text != "" {
				accumulated.WriteString(envelope.ContentBlock.Text)
				return emit(Event{Type: EventDelta, Delta: envelope.ContentBlock.Text})
			}

		case "content_block_delta":
			if envelope.Delta != nil && envelope.Delta.Type == "text_delta" && envelope.Delta.Text != "" {
				accumulated.WriteString(envelope.Delta.Text)
				return emit(Event{Type: EventDelta, Delta: envelope.Delta.Text})
			}

		case "message_delta":
			mergeAnthropicUsage(&usage, envelope.Usage)
			if envelope.Delta != nil && envelope.Delta.StopReason != "" {
				message.StopReason = envelope.Delta.StopReason
			}

		case "message_stop":
			if terminal {
				return nil
			}
			message.Usage = usage
			raw, _ := json.Marshal(message)
			normalized, err := normalizeAnthropicResponse(message, raw, model, accumulated.String())
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
		return fmt.Errorf("%w: Anthropic", ErrStreamTerminated)
	}
	return nil
}

type anthropicDeltaWire struct {
	Type         string  `json:"type"`
	Text         string  `json:"text"`
	StopReason   string  `json:"stop_reason"`
	StopSequence *string `json:"stop_sequence"`
}

func mergeAnthropicUsage(destination, source *anthropicUsageWire) {
	if destination == nil || source == nil {
		return
	}
	copyInt64Pointer(&destination.InputTokens, source.InputTokens)
	copyInt64Pointer(&destination.OutputTokens, source.OutputTokens)
	copyInt64Pointer(&destination.CacheCreationInputTokens, source.CacheCreationInputTokens)
	copyInt64Pointer(&destination.CacheReadInputTokens, source.CacheReadInputTokens)
	copyInt64Pointer(&destination.CachedTokens, source.CachedTokens)
	if source.CacheCreation != nil {
		if destination.CacheCreation == nil {
			destination.CacheCreation = &anthropicCacheCreationWire{}
		}
		copyInt64Pointer(&destination.CacheCreation.Ephemeral5mInputTokens, source.CacheCreation.Ephemeral5mInputTokens)
		copyInt64Pointer(&destination.CacheCreation.Ephemeral1hInputTokens, source.CacheCreation.Ephemeral1hInputTokens)
	}
}

func copyInt64Pointer(destination **int64, source *int64) {
	if source == nil {
		return
	}
	value := *source
	*destination = &value
}

func int64Value(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}
