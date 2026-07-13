package provider

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGeminiGenerateNativePayloadAndImplicitCacheUsage(t *testing.T) {
	captured := make(chan capturedRequest, 1)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		captured <- captureRequest(t, request)
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"responseId":"gem_1",
			"modelVersion":"custom-gemini-model",
			"candidates":[{
				"content":{"role":"model","parts":[
					{"text":"private reasoning","thought":true},
					{"text":"hello"}
				]},
				"finishReason":"STOP"
			}],
			"usageMetadata":{
				"promptTokenCount":40,
				"candidatesTokenCount":9,
				"totalTokenCount":52,
				"cachedContentTokenCount":17,
				"thoughtsTokenCount":3
			}
		}`))
	}))
	defer server.Close()

	adapter := NewGemini("gemini-secret", WithBaseURL(server.URL))
	response, err := adapter.Generate(context.Background(), Request{
		Model:              "models/custom-gemini-model",
		System:             "stable system\ndynamic system",
		StableSystemPrefix: "stable system",
		Messages: []Message{
			{Role: RoleUser, Content: "earlier question"},
			{Role: RoleAssistant, Content: "earlier answer"},
		},
		Input:           "latest question",
		MaxOutputTokens: 512,
		Temperature:     float64Pointer(0.6),
		TopP:            float64Pointer(0.9),
		StopSequences:   []string{"STOP"},
		Reasoning:       &ReasoningConfig{Enabled: true, Effort: "high"},
	})
	if err != nil {
		t.Fatalf("Generate returned error: %v", err)
	}

	request := <-captured
	if request.path != "/v1beta/models/custom-gemini-model:generateContent" {
		t.Errorf("path = %q", request.path)
	}
	if strings.Contains(request.path, "interactions") {
		t.Errorf("Gemini Interactions endpoint used: %q", request.path)
	}
	if got := request.header.Get("x-goog-api-key"); got != "gemini-secret" {
		t.Errorf("x-goog-api-key = %q", got)
	}
	if strings.Contains(string(request.body), "gemini-secret") {
		t.Error("API key leaked into request payload")
	}
	if strings.Contains(strings.ToLower(string(request.body)), "cache") {
		t.Errorf("Gemini request contains explicit cache fields: %s", request.body)
	}

	payload := decodeObject(t, request.body)
	system := objectValue(t, payload["systemInstruction"])
	parts := arrayValue(t, system["parts"])
	if got := objectValue(t, parts[0])["text"]; got != "stable system\ndynamic system" {
		t.Errorf("system instruction = %#v", got)
	}
	contents := arrayValue(t, payload["contents"])
	if len(contents) != 3 {
		t.Fatalf("contents length = %d, want 3", len(contents))
	}
	if got := objectValue(t, contents[1])["role"]; got != "model" {
		t.Errorf("assistant role mapped to %#v, want model", got)
	}
	config := objectValue(t, payload["generationConfig"])
	if config["maxOutputTokens"] != float64(512) || config["temperature"] != 0.6 || config["topP"] != 0.9 {
		t.Errorf("generationConfig = %#v", config)
	}
	if got := objectValue(t, config["thinkingConfig"])["thinkingLevel"]; got != "HIGH" {
		t.Errorf("thinking level = %#v", got)
	}

	if response.Text != "hello" {
		t.Errorf("text = %q (thought text must not be included)", response.Text)
	}
	if response.Usage.InputTokens != 23 || response.Usage.OutputTokens != 9 || response.Usage.TotalTokens != 52 {
		t.Errorf("usage = %+v", response.Usage)
	}
	if response.Usage.CacheReadInputTokens != 17 || response.Usage.ReasoningTokens != 3 {
		t.Errorf("cache/reasoning usage = %+v", response.Usage)
	}
}

func TestGeminiExplicitlyDisablesThinking(t *testing.T) {
	payload := geminiRequestPayload(normalizedRequest{
		model:           "gemini-3.1-pro-preview",
		messages:        []Message{{Role: RoleUser, Content: "hello"}},
		maxOutputTokens: 32,
		reasoning:       &ReasoningConfig{Enabled: false},
	})
	generation := objectValue(t, payload["generationConfig"])
	thinking := objectValue(t, generation["thinkingConfig"])
	if got := thinking["thinkingBudget"]; got != 0 {
		t.Fatalf("thinkingBudget = %#v, want 0", got)
	}
	if _, exists := thinking["thinkingLevel"]; exists {
		t.Fatalf("thinkingLevel = %#v, want omitted", thinking["thinkingLevel"])
	}
}

func TestGeminiPreservesConfiguredAPIVersion(t *testing.T) {
	endpoint, err := resolveGeminiEndpoint("https://example.test/custom/v1", "arbitrary-model", false)
	if err != nil {
		t.Fatalf("resolve endpoint: %v", err)
	}
	if endpoint != "https://example.test/custom/v1/models/arbitrary-model:generateContent" {
		t.Errorf("endpoint = %q", endpoint)
	}

	endpoint, err = resolveGeminiEndpoint("https://example.test/custom/v1beta/models", "arbitrary-model", true)
	if err != nil {
		t.Fatalf("resolve models endpoint: %v", err)
	}
	if endpoint != "https://example.test/custom/v1beta/models/arbitrary-model:streamGenerateContent?alt=sse" {
		t.Errorf("models endpoint = %q", endpoint)
	}
}
