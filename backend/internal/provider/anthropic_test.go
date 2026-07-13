package provider

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAnthropicGeneratePayloadCacheBreakpointsAndUsage(t *testing.T) {
	captured := make(chan capturedRequest, 1)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		captured <- captureRequest(t, request)
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"id":"msg_1",
			"type":"message",
			"role":"assistant",
			"model":"custom-claude",
			"content":[{"type":"text","text":"hello"}],
			"stop_reason":"end_turn",
			"usage":{
				"input_tokens":12,
				"output_tokens":5,
				"cache_creation":{"ephemeral_5m_input_tokens":7,"ephemeral_1h_input_tokens":3},
				"cached_tokens":11
			}
		}`))
	}))
	defer server.Close()

	messages := []Message{
		{Role: RoleUser, Content: "one", CacheBreakpoint: true},
		{Role: RoleAssistant, Content: "two", CacheBreakpoint: true},
		{Role: RoleUser, Content: "three", CacheBreakpoint: true},
		{Role: RoleAssistant, Content: "four", CacheBreakpoint: true},
		{Role: RoleUser, Content: "five", CacheBreakpoint: true},
	}
	adapter := NewAnthropic("anthropic-secret", WithBaseURL(server.URL))
	response, err := adapter.Generate(context.Background(), Request{
		Model:              "custom-claude",
		System:             "stable block\ndynamic block",
		StableSystemPrefix: "stable block",
		Messages:           messages,
		MaxOutputTokens:    256,
		Temperature:        float64Pointer(0.4),
		TopP:               float64Pointer(0.8),
		StopSequences:      []string{"STOP"},
		Reasoning:          &ReasoningConfig{Enabled: true, Effort: "max"},
	})
	if err != nil {
		t.Fatalf("Generate returned error: %v", err)
	}

	request := <-captured
	if request.path != "/v1/messages" {
		t.Errorf("path = %q, want /v1/messages", request.path)
	}
	if got := request.header.Get("x-api-key"); got != "anthropic-secret" {
		t.Errorf("x-api-key = %q", got)
	}
	if got := request.header.Get("anthropic-version"); got != anthropicVersion {
		t.Errorf("anthropic-version = %q", got)
	}
	if strings.Contains(string(request.body), "anthropic-secret") {
		t.Error("API key leaked into request payload")
	}

	payload := decodeObject(t, request.body)
	if got := payload["model"]; got != "custom-claude" {
		t.Errorf("model = %#v", got)
	}
	if got := payload["temperature"]; got != 0.4 {
		t.Errorf("temperature = %#v", got)
	}
	if got := objectValue(t, payload["output_config"])["effort"]; got != "max" {
		t.Errorf("output effort = %#v", got)
	}
	if got := objectValue(t, payload["thinking"])["type"]; got != "adaptive" {
		t.Errorf("thinking type = %#v", got)
	}

	system := arrayValue(t, payload["system"])
	if len(system) != 2 {
		t.Fatalf("system block count = %d, want 2", len(system))
	}
	stable := objectValue(t, system[0])
	if stable["text"] != "stable block" {
		t.Errorf("stable system block = %#v", stable["text"])
	}
	if got := objectValue(t, stable["cache_control"])["type"]; got != "ephemeral" {
		t.Errorf("stable cache_control.type = %#v", got)
	}
	if got := objectValue(t, system[1])["text"]; got != "\ndynamic block" {
		t.Errorf("dynamic system block = %#v", got)
	}

	messagePayloads := arrayValue(t, payload["messages"])
	breakpoints := 1
	for index, rawMessage := range messagePayloads {
		message := objectValue(t, rawMessage)
		content, isArray := message["content"].([]any)
		if index < 2 && isArray {
			t.Errorf("old message %d unexpectedly retained a cache breakpoint", index)
		}
		if index >= 2 {
			if !isArray || len(content) != 1 {
				t.Errorf("new message %d has content %#v, want one cacheable block", index, message["content"])
				continue
			}
			block := objectValue(t, content[0])
			if objectValue(t, block["cache_control"])["type"] != "ephemeral" {
				t.Errorf("message %d cache control = %#v", index, block["cache_control"])
			}
			breakpoints++
		}
	}
	if breakpoints != maxAnthropicBreakpoints {
		t.Errorf("cache breakpoints = %d, want %d", breakpoints, maxAnthropicBreakpoints)
	}

	if response.Text != "hello" || response.FinishReason != "end_turn" {
		t.Errorf("response = %+v", response)
	}
	if response.Usage.InputTokens != 12 || response.Usage.OutputTokens != 5 {
		t.Errorf("usage = %+v", response.Usage)
	}
	if response.Usage.CacheCreationInputTokens != 10 || response.Usage.CacheReadInputTokens != 11 {
		t.Errorf("cache usage = %+v", response.Usage)
	}
	if response.Usage.TotalTokens != 38 {
		t.Errorf("total tokens = %d, want 38", response.Usage.TotalTokens)
	}
}

func TestAnthropicUsesWholeSystemAsStableBlockByDefault(t *testing.T) {
	payload := anthropicRequestPayload(normalizedRequest{
		model:           "claude-anything",
		system:          "whole system",
		stableSystem:    "whole system",
		messages:        []Message{{Role: RoleUser, Content: "hello"}},
		maxOutputTokens: 32,
	}, false)
	system := arrayValue(t, payload["system"])
	block := objectValue(t, system[0])
	if block["text"] != "whole system" || objectValue(t, block["cache_control"])["type"] != "ephemeral" {
		t.Errorf("system block = %#v", block)
	}
}

func TestAnthropicOmitsUnconfiguredThinking(t *testing.T) {
	payload := anthropicRequestPayload(normalizedRequest{
		model:           "claude-fable-5",
		messages:        []Message{{Role: RoleUser, Content: "hello"}},
		maxOutputTokens: 32,
	}, false)
	if _, exists := payload["thinking"]; exists {
		t.Errorf("thinking = %#v, want omitted", payload["thinking"])
	}
	if _, exists := payload["output_config"]; exists {
		t.Errorf("output_config = %#v, want omitted", payload["output_config"])
	}
}

func TestAnthropicExplicitlyDisablesThinking(t *testing.T) {
	payload := anthropicRequestPayload(normalizedRequest{
		model:           "claude-fable-5",
		messages:        []Message{{Role: RoleUser, Content: "hello"}},
		maxOutputTokens: 32,
		reasoning:       &ReasoningConfig{Enabled: false},
	}, false)
	if got := objectValue(t, payload["thinking"])["type"]; got != "disabled" {
		t.Fatalf("thinking type = %#v, want disabled", got)
	}
	if _, exists := payload["output_config"]; exists {
		t.Fatalf("output_config = %#v, want omitted", payload["output_config"])
	}
}

func TestAnthropicStreamNormalizationPrefersAccumulatedText(t *testing.T) {
	response, err := normalizeAnthropicResponse(anthropicResponseWire{
		Content: []anthropicContentBlockWire{{Type: "text", Text: "initial"}},
	}, []byte(`{}`), "claude-anything", "initial plus delta")
	if err != nil {
		t.Fatalf("normalize response: %v", err)
	}
	if response.Text != "initial plus delta" {
		t.Errorf("text = %q", response.Text)
	}
}
