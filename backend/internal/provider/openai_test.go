package provider

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOpenAIGeneratePayloadAndUsage(t *testing.T) {
	captured := make(chan capturedRequest, 1)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		captured <- captureRequest(t, request)
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"id":"resp_1",
			"model":"vendor-text-model",
			"status":"completed",
			"output":[
				{"type":"reasoning","summary":[]},
				{"type":"message","content":[{"type":"output_text","text":"hello"}]}
			],
			"usage":{
				"input_tokens":100,
				"output_tokens":20,
				"total_tokens":120,
				"input_tokens_details":{"cached_tokens":64,"cache_write_tokens":8},
				"output_tokens_details":{"reasoning_tokens":7}
			}
		}`))
	}))
	defer server.Close()

	adapter := NewOpenAI("openai-secret", WithBaseURL(server.URL))
	response, err := adapter.Generate(context.Background(), Request{
		Model:              "vendor-text-model",
		System:             "stable system\ndynamic suffix",
		StableSystemPrefix: "stable system",
		Input:              "say hello",
		MaxOutputTokens:    128,
		Temperature:        float64Pointer(0.7),
		Reasoning:          &ReasoningConfig{Enabled: true, Effort: "high"},
	})
	if err != nil {
		t.Fatalf("Generate returned error: %v", err)
	}

	request := <-captured
	if request.path != "/v1/responses" {
		t.Errorf("path = %q, want /v1/responses", request.path)
	}
	if got := request.header.Get("Authorization"); got != "Bearer openai-secret" {
		t.Errorf("Authorization = %q", got)
	}
	payload := decodeObject(t, request.body)
	if got := payload["model"]; got != "vendor-text-model" {
		t.Errorf("model = %#v", got)
	}
	if got := payload["instructions"]; got != "stable system\ndynamic suffix" {
		t.Errorf("instructions = %#v", got)
	}
	if got := payload["input"]; got != "say hello" {
		t.Errorf("input = %#v", got)
	}
	if got := payload["max_output_tokens"]; got != float64(128) {
		t.Errorf("max_output_tokens = %#v", got)
	}
	if got := payload["temperature"]; got != 0.7 {
		t.Errorf("temperature = %#v", got)
	}
	if got := payload["prompt_cache_key"]; got != OpenAIPromptCacheKey("vendor-text-model", "stable system") {
		t.Errorf("prompt_cache_key = %#v", got)
	}
	if strings.Contains(string(request.body), "openai-secret") {
		t.Error("API key leaked into request payload")
	}
	if got := objectValue(t, payload["reasoning"])["effort"]; got != "high" {
		t.Errorf("reasoning effort = %#v", got)
	}

	if response.Text != "hello" {
		t.Errorf("text = %q", response.Text)
	}
	if response.Usage.CacheReadInputTokens != 64 || response.Usage.CacheCreationInputTokens != 8 {
		t.Errorf("cache usage = %+v", response.Usage)
	}
	if response.Usage.ReasoningTokens != 7 || response.Usage.TotalTokens != 120 {
		t.Errorf("usage = %+v", response.Usage)
	}
}

func TestOpenAIExplicitlyDisablesReasoning(t *testing.T) {
	payload := openAIRequestPayload(normalizedRequest{
		model:           "gpt-5.6-terra",
		messages:        []Message{{Role: RoleUser, Content: "hello"}},
		maxOutputTokens: 32,
		reasoning:       &ReasoningConfig{Enabled: false},
	}, false)
	if got := objectValue(t, payload["reasoning"])["effort"]; got != "none" {
		t.Fatalf("reasoning effort = %#v, want none", got)
	}
}

func TestOpenAIPromptCacheKeyStableAcrossLaterTurns(t *testing.T) {
	base := openAIRequestPayload(normalizedRequest{
		model:           "gpt-5.5",
		system:          "stable system\ndynamic",
		stableSystem:    "stable system",
		messages:        []Message{{Role: RoleUser, Content: "first"}},
		maxOutputTokens: 32,
	}, false)
	extended := openAIRequestPayload(normalizedRequest{
		model:        "gpt-5.5",
		system:       "stable system\ndifferent dynamic material",
		stableSystem: "stable system",
		messages: []Message{
			{Role: RoleUser, Content: "first"},
			{Role: RoleAssistant, Content: "answer"},
			{Role: RoleUser, Content: "later"},
		},
		maxOutputTokens: 32,
	}, false)
	if base["prompt_cache_key"] != extended["prompt_cache_key"] {
		t.Errorf("cache key changed across later turns: %q != %q", base["prompt_cache_key"], extended["prompt_cache_key"])
	}
}

func TestOpenAIGPT5OmitsSamplingParameters(t *testing.T) {
	request := normalizedRequest{
		model:           "openai/gpt-5.5",
		messages:        []Message{{Role: RoleUser, Content: "hello"}},
		maxOutputTokens: 32,
		temperature:     float64Pointer(0.7),
		topP:            float64Pointer(0.9),
	}
	payloads := map[string]map[string]any{
		"Responses":        openAIRequestPayload(request, false),
		"Chat Completions": openAIChatRequestPayload(request, false, true),
	}
	for name, payload := range payloads {
		if _, exists := payload["temperature"]; exists {
			t.Errorf("%s GPT-5 payload contains temperature", name)
		}
		if _, exists := payload["top_p"]; exists {
			t.Errorf("%s GPT-5 payload contains top_p", name)
		}
	}
}
