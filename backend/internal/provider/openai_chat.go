package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

func (provider *OpenAI) generateChatCompletions(ctx context.Context, request normalizedRequest) (*Response, error) {
	endpoint, err := resolveEndpoint(provider.client.baseURL, "v1", "chat/completions")
	if err != nil {
		return nil, err
	}
	httpRequest, err := newJSONRequest(ctx, endpoint, openAIChatRequestPayload(
		request, false, provider.client.promptCacheKeyEnabled,
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
		return nil, fmt.Errorf("read OpenAI Chat Completions response: %w", err)
	}

	var wire openAIChatResponseWire
	if err := json.Unmarshal(body, &wire); err != nil {
		return nil, fmt.Errorf("decode OpenAI Chat Completions response: %w", err)
	}
	return normalizeOpenAIChatResponse(wire, body, request.model)
}

func (provider *OpenAI) streamChatCompletions(ctx context.Context, request normalizedRequest) (<-chan Event, error) {
	endpoint, err := resolveEndpoint(provider.client.baseURL, "v1", "chat/completions")
	if err != nil {
		return nil, err
	}
	httpRequest, err := newJSONRequest(ctx, endpoint, openAIChatRequestPayload(
		request, true, provider.client.promptCacheKeyEnabled,
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
		return parseOpenAIChatStream(httpResponse, request.model, emit)
	})
	return events, nil
}

func openAIChatRequestPayload(request normalizedRequest, stream, promptCacheKeyEnabled bool) map[string]any {
	payload := map[string]any{
		"model":                 request.model,
		"messages":              openAIChatMessages(request),
		"max_completion_tokens": request.maxOutputTokens,
		"stream":                stream,
	}
	if stream {
		payload["stream_options"] = map[string]bool{"include_usage": true}
	}
	if promptCacheKeyEnabled && request.stableSystem != "" {
		payload["prompt_cache_key"] = OpenAIPromptCacheKey(request.model, request.stableSystem)
	}
	if request.reasoning != nil {
		effort := "none"
		if request.reasoning.Enabled {
			effort = request.reasoning.Effort
		}
		payload["reasoning_effort"] = effort
	}
	if len(request.stopSequences) > 0 {
		payload["stop"] = append([]string(nil), request.stopSequences...)
	}
	if !isGPT5Model(request.model) {
		if request.temperature != nil {
			payload["temperature"] = *request.temperature
		}
		if request.topP != nil {
			payload["top_p"] = *request.topP
		}
	}
	return payload
}

func openAIChatMessages(request normalizedRequest) []map[string]string {
	messages := make([]map[string]string, 0, len(request.messages)+1)
	if request.system != "" {
		messages = append(messages, map[string]string{"role": "system", "content": request.system})
	}
	for _, message := range request.messages {
		messages = append(messages, map[string]string{
			"role": string(message.Role), "content": message.Content,
		})
	}
	return messages
}

type openAIChatResponseWire struct {
	ID      string                 `json:"id"`
	Object  string                 `json:"object"`
	Type    string                 `json:"type"`
	Model   string                 `json:"model"`
	Choices []openAIChatChoiceWire `json:"choices"`
	Usage   *openAIUsageWire       `json:"usage"`
	Error   json.RawMessage        `json:"error"`
}

type openAIChatChoiceWire struct {
	Index        int                   `json:"index"`
	Message      openAIChatMessageWire `json:"message"`
	FinishReason string                `json:"finish_reason"`
}

type openAIChatMessageWire struct {
	Role             string          `json:"role"`
	Content          json.RawMessage `json:"content"`
	Refusal          string          `json:"refusal"`
	ReasoningContent string          `json:"reasoning_content"`
}

func normalizeOpenAIChatResponse(wire openAIChatResponseWire, raw []byte, fallbackModel string) (*Response, error) {
	if strings.EqualFold(wire.Type, "error") || strings.EqualFold(wire.Object, "error") || hasJSONValue(wire.Error) {
		upstreamError := parseUpstreamError(KindOpenAI, http.StatusOK, nil, raw, "OpenAI Chat Completions response failed")
		upstreamError.Usage = normalizeOpenAIUsage(wire.Usage)
		return nil, upstreamError
	}

	var choice *openAIChatChoiceWire
	for index := range wire.Choices {
		if wire.Choices[index].Index == 0 {
			choice = &wire.Choices[index]
			break
		}
	}
	if choice == nil && len(wire.Choices) > 0 {
		choice = &wire.Choices[0]
	}

	var text, finishReason string
	if choice != nil {
		var err error
		text, err = decodeOpenAIChatContent(choice.Message.Content)
		if err != nil {
			return nil, err
		}
		if text == "" {
			text = choice.Message.Refusal
		}
		finishReason = choice.FinishReason
	}
	if strings.TrimSpace(text) == "" {
		return nil, fmt.Errorf("%w: OpenAI Chat Completions", ErrEmptyResponse)
	}
	model := wire.Model
	if model == "" {
		model = fallbackModel
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

func decodeOpenAIChatContent(raw json.RawMessage) (string, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return "", nil
	}
	if strings.HasPrefix(trimmed, "\"") {
		var text string
		if err := json.Unmarshal(raw, &text); err != nil {
			return "", fmt.Errorf("decode OpenAI Chat Completions message content: %w", err)
		}
		return text, nil
	}

	var parts []struct {
		Type    string `json:"type"`
		Text    string `json:"text"`
		Refusal string `json:"refusal"`
	}
	if err := json.Unmarshal(raw, &parts); err != nil {
		return "", fmt.Errorf("decode OpenAI Chat Completions message content: %w", err)
	}
	var text strings.Builder
	for _, part := range parts {
		if part.Text != "" {
			text.WriteString(part.Text)
		} else if part.Refusal != "" {
			text.WriteString(part.Refusal)
		}
	}
	return text.String(), nil
}

type openAIChatChunkWire struct {
	ID      string                       `json:"id"`
	Object  string                       `json:"object"`
	Type    string                       `json:"type"`
	Model   string                       `json:"model"`
	Choices []openAIChatStreamChoiceWire `json:"choices"`
	Usage   *openAIUsageWire             `json:"usage"`
	Error   json.RawMessage              `json:"error"`
}

type openAIChatStreamChoiceWire struct {
	Index        int                   `json:"index"`
	Delta        openAIChatMessageWire `json:"delta"`
	FinishReason *string               `json:"finish_reason"`
}

func parseOpenAIChatStream(response *http.Response, fallbackModel string, emit func(Event) error) error {
	doneSignal := errors.New("OpenAI Chat Completions stream done")
	var accumulated strings.Builder
	var id, model, finishReason string
	var usage *openAIUsageWire
	var lastRaw json.RawMessage
	terminal := false

	err := parseWireEvents(response.Body, response.Header.Get("Content-Type"), func(event wireEvent) error {
		if strings.TrimSpace(string(event.data)) == "[DONE]" {
			text := accumulated.String()
			if strings.TrimSpace(text) == "" {
				return fmt.Errorf("%w: OpenAI Chat Completions", ErrEmptyResponse)
			}
			if model == "" {
				model = fallbackModel
			}
			normalized := &Response{
				ID: id, Model: model, Text: text, FinishReason: finishReason,
				Usage: normalizeOpenAIUsage(usage), Raw: append(json.RawMessage(nil), lastRaw...),
			}
			if err := emit(completedEvent(normalized)); err != nil {
				return err
			}
			terminal = true
			return doneSignal
		}

		var chunk openAIChatChunkWire
		if err := json.Unmarshal(event.data, &chunk); err != nil {
			return fmt.Errorf("decode OpenAI Chat Completions stream event: %w", err)
		}
		lastRaw = append(lastRaw[:0], event.data...)
		if chunk.Usage != nil {
			decoded := *chunk.Usage
			usage = &decoded
		}
		if strings.EqualFold(event.name, "error") || strings.EqualFold(chunk.Type, "error") || strings.EqualFold(chunk.Object, "error") || hasJSONValue(chunk.Error) {
			upstreamError := parseUpstreamError(KindOpenAI, http.StatusOK, response.Header, event.data, "OpenAI Chat Completions stream failed")
			upstreamError.Usage = normalizeOpenAIUsage(usage)
			return upstreamError
		}
		if chunk.ID != "" {
			id = chunk.ID
		}
		if chunk.Model != "" {
			model = chunk.Model
		}
		for _, choice := range chunk.Choices {
			if choice.Index != 0 {
				continue
			}
			delta, err := decodeOpenAIChatContent(choice.Delta.Content)
			if err != nil {
				return err
			}
			if delta == "" {
				delta = choice.Delta.Refusal
			}
			if delta != "" {
				accumulated.WriteString(delta)
				if err := emit(Event{Type: EventDelta, Delta: delta}); err != nil {
					return err
				}
			}
			if choice.FinishReason != nil {
				finishReason = *choice.FinishReason
			}
		}
		return nil
	})
	if errors.Is(err, doneSignal) {
		return nil
	}
	if err != nil {
		return err
	}
	if !terminal {
		return fmt.Errorf("%w: OpenAI Chat Completions", ErrStreamTerminated)
	}
	return nil
}
