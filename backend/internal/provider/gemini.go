package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

const defaultGeminiBaseURL = "https://generativelanguage.googleapis.com"

type Gemini struct {
	client baseClient
}

func NewGemini(apiKey string, options ...Option) *Gemini {
	return &Gemini{client: newBaseClient(
		KindGemini,
		apiKey,
		defaultGeminiBaseURL,
		DefaultGeminiModel,
		options...,
	)}
}

func (provider *Gemini) Kind() Kind { return KindGemini }

func (provider *Gemini) String() string {
	return fmt.Sprintf("provider.Gemini{baseURL:%q, defaultModel:%q, apiKey:<redacted>}", provider.client.baseURL, provider.client.defaultModel)
}

func (provider *Gemini) GoString() string { return provider.String() }

func (provider *Gemini) Generate(ctx context.Context, request Request) (*Response, error) {
	normalized, err := provider.client.normalize(request)
	if err != nil {
		return nil, err
	}
	endpoint, err := resolveGeminiEndpoint(provider.client.baseURL, normalized.model, false)
	if err != nil {
		return nil, err
	}
	httpRequest, err := newJSONRequest(ctx, endpoint, geminiRequestPayload(normalized))
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
		return nil, fmt.Errorf("read Gemini response: %w", err)
	}

	var wire geminiResponseWire
	if err := json.Unmarshal(body, &wire); err != nil {
		return nil, fmt.Errorf("decode Gemini response: %w", err)
	}
	return normalizeGeminiResponse(wire, body, normalized.model, "")
}

func (provider *Gemini) Stream(ctx context.Context, request Request) (<-chan Event, error) {
	normalized, err := provider.client.normalize(request)
	if err != nil {
		return nil, err
	}
	endpoint, err := resolveGeminiEndpoint(provider.client.baseURL, normalized.model, true)
	if err != nil {
		return nil, err
	}
	httpRequest, err := newJSONRequest(ctx, endpoint, geminiRequestPayload(normalized))
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
		return parseGeminiStream(httpResponse, normalized.model, emit)
	})
	return events, nil
}

func (provider *Gemini) setHeaders(request *http.Request, stream bool) {
	request.Header.Set("x-goog-api-key", provider.client.apiKey)
	if stream {
		request.Header.Set("Accept", "text/event-stream")
	} else {
		request.Header.Set("Accept", "application/json")
	}
}

func resolveGeminiEndpoint(baseURL, model string, stream bool) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return "", fmt.Errorf("invalid Gemini base URL: %w", err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("invalid Gemini base URL %q", baseURL)
	}
	model = strings.TrimSpace(model)
	if len(model) >= len("models/") && strings.EqualFold(model[:len("models/")], "models/") {
		model = model[len("models/"):]
	}
	if model == "" {
		return "", fmt.Errorf("%w: Gemini model is required", ErrInvalidRequest)
	}

	path := strings.TrimRight(parsed.Path, "/")
	path = strings.TrimSuffix(path, "/models")
	if !strings.HasSuffix(path, "/v1") && !strings.HasSuffix(path, "/v1beta") {
		path += "/v1beta"
	}
	action := "generateContent"
	if stream {
		action = "streamGenerateContent"
	}
	rawPath := strings.TrimRight((&url.URL{Path: path}).EscapedPath(), "/") +
		"/models/" + url.PathEscape(model) + ":" + action
	decodedPath, err := url.PathUnescape(rawPath)
	if err != nil {
		return "", fmt.Errorf("build Gemini endpoint: %w", err)
	}
	parsed.Path = decodedPath
	parsed.RawPath = rawPath
	if stream {
		query := parsed.Query()
		query.Set("alt", "sse")
		parsed.RawQuery = query.Encode()
	}
	return parsed.String(), nil
}

func geminiRequestPayload(request normalizedRequest) map[string]any {
	contents := make([]map[string]any, 0, len(request.messages))
	for _, message := range request.messages {
		role := "user"
		if message.Role == RoleAssistant {
			role = "model"
		}
		contents = append(contents, map[string]any{
			"role":  role,
			"parts": []map[string]string{{"text": message.Content}},
		})
	}
	generationConfig := map[string]any{
		"maxOutputTokens": request.maxOutputTokens,
	}
	if request.temperature != nil {
		generationConfig["temperature"] = *request.temperature
	}
	if request.topP != nil {
		generationConfig["topP"] = *request.topP
	}
	if len(request.stopSequences) > 0 {
		generationConfig["stopSequences"] = request.stopSequences
	}
	if request.reasoning != nil {
		if request.reasoning.Enabled {
			generationConfig["thinkingConfig"] = geminiThinkingConfig(request.model, request.reasoning.Effort)
		} else {
			generationConfig["thinkingConfig"] = map[string]any{"thinkingBudget": 0}
		}
	}

	payload := map[string]any{
		"contents":         contents,
		"generationConfig": generationConfig,
	}
	if request.system != "" {
		payload["systemInstruction"] = map[string]any{
			"parts": []map[string]string{{"text": request.system}},
		}
	}
	return payload
}

func geminiThinkingConfig(model, effort string) map[string]any {
	normalizedModel := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(model), "models/"))
	if strings.HasPrefix(normalizedModel, "gemini-2.5") {
		budget := 1024
		switch strings.ToLower(effort) {
		case "medium":
			budget = 8192
		case "high":
			budget = 24576
		}
		return map[string]any{"thinkingBudget": budget}
	}
	return map[string]any{"thinkingLevel": strings.ToUpper(effort)}
}

type geminiResponseWire struct {
	Candidates     []geminiCandidateWire     `json:"candidates"`
	UsageMetadata  *geminiUsageWire          `json:"usageMetadata"`
	PromptFeedback *geminiPromptFeedbackWire `json:"promptFeedback"`
	ModelVersion   string                    `json:"modelVersion"`
	ResponseID     string                    `json:"responseId"`
	Error          json.RawMessage           `json:"error"`
}

type geminiCandidateWire struct {
	Content      geminiContentWire `json:"content"`
	FinishReason string            `json:"finishReason"`
}

type geminiContentWire struct {
	Role  string           `json:"role"`
	Parts []geminiPartWire `json:"parts"`
}

type geminiPartWire struct {
	Text    string `json:"text"`
	Thought bool   `json:"thought"`
}

type geminiPromptFeedbackWire struct {
	BlockReason        string `json:"blockReason"`
	BlockReasonMessage string `json:"blockReasonMessage"`
}

type geminiUsageWire struct {
	PromptTokenCount        *int64 `json:"promptTokenCount"`
	CandidatesTokenCount    *int64 `json:"candidatesTokenCount"`
	TotalTokenCount         *int64 `json:"totalTokenCount"`
	CachedContentTokenCount *int64 `json:"cachedContentTokenCount"`
	ThoughtsTokenCount      *int64 `json:"thoughtsTokenCount"`
}

func normalizeGeminiResponse(wire geminiResponseWire, raw []byte, fallbackModel, streamedText string) (*Response, error) {
	if hasJSONValue(wire.Error) {
		upstreamError := parseUpstreamError(KindGemini, http.StatusOK, nil, raw, "Gemini response failed")
		upstreamError.Usage = normalizeGeminiUsage(wire.UsageMetadata)
		return nil, upstreamError
	}
	if wire.PromptFeedback != nil && wire.PromptFeedback.BlockReason != "" {
		message := wire.PromptFeedback.BlockReasonMessage
		if message == "" {
			message = "Gemini blocked the prompt: " + wire.PromptFeedback.BlockReason
		}
		return nil, &UpstreamError{
			Provider:   KindGemini,
			StatusCode: http.StatusOK,
			Type:       "prompt_blocked",
			Code:       wire.PromptFeedback.BlockReason,
			Message:    message,
			Body:       append(json.RawMessage(nil), raw...),
			Usage:      normalizeGeminiUsage(wire.UsageMetadata),
		}
	}

	text := streamedText
	if text == "" {
		text = extractGeminiText(wire)
	}
	model := wire.ModelVersion
	if model == "" {
		model = fallbackModel
	}
	finishReason := ""
	if len(wire.Candidates) > 0 {
		finishReason = wire.Candidates[0].FinishReason
	}
	if strings.TrimSpace(text) == "" {
		if finishReason != "" && !strings.EqualFold(finishReason, "STOP") {
			return nil, &UpstreamError{
				Provider: KindGemini, StatusCode: http.StatusOK,
				Type: "candidate_terminated", Code: finishReason,
				Message: "Gemini ended the candidate without user-visible text: " + finishReason,
				Body:    append(json.RawMessage(nil), raw...), Usage: normalizeGeminiUsage(wire.UsageMetadata),
			}
		}
		return nil, fmt.Errorf("%w: Gemini", ErrEmptyResponse)
	}
	return &Response{
		ID:           wire.ResponseID,
		Model:        model,
		Text:         text,
		FinishReason: finishReason,
		Usage:        normalizeGeminiUsage(wire.UsageMetadata),
		Raw:          append(json.RawMessage(nil), raw...),
	}, nil
}

func extractGeminiText(response geminiResponseWire) string {
	for _, candidate := range response.Candidates {
		var text strings.Builder
		for _, part := range candidate.Content.Parts {
			if !part.Thought {
				text.WriteString(part.Text)
			}
		}
		if text.Len() > 0 {
			return text.String()
		}
	}
	return ""
}

func normalizeGeminiUsage(wire *geminiUsageWire) Usage {
	if wire == nil {
		return Usage{}
	}
	input := int64Value(wire.PromptTokenCount)
	output := int64Value(wire.CandidatesTokenCount)
	reasoning := int64Value(wire.ThoughtsTokenCount)
	cacheRead := int64Value(wire.CachedContentTokenCount)
	ordinaryInput := max(input-cacheRead, 0)
	total := int64Value(wire.TotalTokenCount)
	if total == 0 {
		total = ordinaryInput + cacheRead + output + reasoning
	}
	return Usage{
		InputTokens:          ordinaryInput,
		OutputTokens:         output,
		TotalTokens:          total,
		ReasoningTokens:      reasoning,
		CacheReadInputTokens: cacheRead,
	}
}

func parseGeminiStream(response *http.Response, model string, emit func(Event) error) error {
	var accumulated string
	var usage geminiUsageWire
	var lastWire geminiResponseWire
	var lastRaw json.RawMessage
	finishReason := ""
	terminal := false

	err := parseWireEvents(response.Body, response.Header.Get("Content-Type"), func(event wireEvent) error {
		if strings.TrimSpace(string(event.data)) == "[DONE]" {
			return nil
		}
		var wire geminiResponseWire
		if err := json.Unmarshal(event.data, &wire); err != nil {
			return fmt.Errorf("decode Gemini stream event: %w", err)
		}
		mergeGeminiUsage(&usage, wire.UsageMetadata)
		wire.UsageMetadata = &usage
		if hasJSONValue(wire.Error) || event.name == "error" {
			upstreamError := parseUpstreamError(KindGemini, http.StatusOK, response.Header, event.data, "Gemini stream failed")
			upstreamError.Usage = normalizeGeminiUsage(&usage)
			return upstreamError
		}
		if wire.PromptFeedback != nil && wire.PromptFeedback.BlockReason != "" {
			_, normalizationError := normalizeGeminiResponse(wire, event.data, model, accumulated)
			return normalizationError
		}
		incoming := extractGeminiText(wire)
		delta, next := computeGeminiTextDelta(accumulated, incoming)
		accumulated = next
		if delta != "" {
			if err := emit(Event{Type: EventDelta, Delta: delta}); err != nil {
				return err
			}
		}
		if len(wire.Candidates) > 0 && wire.Candidates[0].FinishReason != "" {
			finishReason = wire.Candidates[0].FinishReason
			terminal = true
		}
		lastWire = wire
		lastRaw = append(lastRaw[:0], event.data...)
		return nil
	})
	if err != nil {
		return err
	}
	if !terminal {
		return fmt.Errorf("%w: Gemini", ErrStreamTerminated)
	}
	lastWire.UsageMetadata = &usage
	normalized, err := normalizeGeminiResponse(lastWire, lastRaw, model, accumulated)
	if err != nil {
		return err
	}
	normalized.FinishReason = finishReason
	return emit(completedEvent(normalized))
}

func computeGeminiTextDelta(seen, incoming string) (delta, next string) {
	incoming = strings.TrimSuffix(incoming, "\x00")
	if incoming == "" {
		return "", seen
	}
	if strings.HasPrefix(incoming, seen) {
		return strings.TrimPrefix(incoming, seen), incoming
	}
	if strings.HasPrefix(seen, incoming) {
		return "", seen
	}
	return incoming, seen + incoming
}

func mergeGeminiUsage(destination *geminiUsageWire, source *geminiUsageWire) {
	if destination == nil || source == nil {
		return
	}
	copyInt64Pointer(&destination.PromptTokenCount, source.PromptTokenCount)
	copyInt64Pointer(&destination.CandidatesTokenCount, source.CandidatesTokenCount)
	copyInt64Pointer(&destination.TotalTokenCount, source.TotalTokenCount)
	copyInt64Pointer(&destination.CachedContentTokenCount, source.CachedContentTokenCount)
	copyInt64Pointer(&destination.ThoughtsTokenCount, source.ThoughtsTokenCount)
}
