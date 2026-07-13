package provider

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOpenAIChatGeneratePayloadAndUsage(t *testing.T) {
	captured := make(chan capturedRequest, 1)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		captured <- captureRequest(t, request)
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"id":"chatcmpl_1",
			"model":"z-ai/glm-5.2",
			"choices":[{"index":0,"message":{"role":"assistant","content":"NARRATIUM_OK"},"finish_reason":"stop"}],
			"usage":{
				"prompt_tokens":100,
				"completion_tokens":20,
				"total_tokens":120,
				"prompt_tokens_details":{"cached_tokens":64,"cache_write_tokens":8},
				"completion_tokens_details":{"reasoning_tokens":7}
			}
		}`))
	}))
	defer server.Close()

	adapter := NewOpenAI(
		"openai-secret",
		WithBaseURL(server.URL),
		WithAPIFormat(OpenAIAPIFormatChatCompletions),
	)
	response, err := adapter.Generate(context.Background(), Request{
		Model:              "glm-5.2",
		System:             "stable system\ndynamic suffix",
		StableSystemPrefix: "stable system",
		Messages: []Message{
			{Role: RoleUser, Content: "first"},
			{Role: RoleAssistant, Content: "answer"},
		},
		Input:           "say hello",
		MaxOutputTokens: 128,
		Temperature:     float64Pointer(0.7),
		TopP:            float64Pointer(0.9),
		StopSequences:   []string{"END", "STOP"},
		Reasoning:       &ReasoningConfig{Enabled: true, Effort: "high"},
	})
	if err != nil {
		t.Fatalf("Generate returned error: %v", err)
	}

	request := <-captured
	if request.path != "/v1/chat/completions" {
		t.Fatalf("path = %q, want /v1/chat/completions", request.path)
	}
	if request.header.Get("Authorization") != "Bearer openai-secret" || request.header.Get("Accept") != "application/json" {
		t.Errorf("headers = %#v", request.header)
	}
	payload := decodeObject(t, request.body)
	if payload["model"] != "glm-5.2" || payload["max_completion_tokens"] != float64(128) || payload["stream"] != false {
		t.Errorf("core payload fields = %#v", payload)
	}
	if payload["reasoning_effort"] != "high" || payload["temperature"] != 0.7 || payload["top_p"] != 0.9 {
		t.Errorf("generation parameters = %#v", payload)
	}
	if payload["prompt_cache_key"] != OpenAIPromptCacheKey("glm-5.2", "stable system") {
		t.Errorf("prompt_cache_key = %#v", payload["prompt_cache_key"])
	}
	stops := arrayValue(t, payload["stop"])
	if len(stops) != 2 || stops[0] != "END" || stops[1] != "STOP" {
		t.Errorf("stop = %#v", stops)
	}
	messages := arrayValue(t, payload["messages"])
	if len(messages) != 4 {
		t.Fatalf("messages = %#v", messages)
	}
	if system := objectValue(t, messages[0]); system["role"] != "system" || system["content"] != "stable system\ndynamic suffix" {
		t.Errorf("system message = %#v", system)
	}
	if last := objectValue(t, messages[3]); last["role"] != "user" || last["content"] != "say hello" {
		t.Errorf("last message = %#v", last)
	}
	if _, exists := payload["stream_options"]; exists {
		t.Error("non-streaming payload contains stream_options")
	}

	if response.ID != "chatcmpl_1" || response.Model != "z-ai/glm-5.2" || response.Text != "NARRATIUM_OK" || response.FinishReason != "stop" {
		t.Errorf("response = %+v", response)
	}
	if response.Usage.InputTokens != 28 || response.Usage.OutputTokens != 20 || response.Usage.TotalTokens != 120 {
		t.Errorf("usage = %+v", response.Usage)
	}
	if response.Usage.CacheReadInputTokens != 64 || response.Usage.CacheCreationInputTokens != 8 || response.Usage.ReasoningTokens != 7 {
		t.Errorf("detailed usage = %+v", response.Usage)
	}
}

func TestOpenAIChatExplicitlyDisablesReasoning(t *testing.T) {
	payload := openAIChatRequestPayload(normalizedRequest{
		model:           "gpt-5.6-terra",
		messages:        []Message{{Role: RoleUser, Content: "hello"}},
		maxOutputTokens: 32,
		reasoning:       &ReasoningConfig{Enabled: false},
	}, false, true)
	if got := payload["reasoning_effort"]; got != "none" {
		t.Fatalf("reasoning_effort = %#v, want none", got)
	}
}

func TestOpenAIChatStreamParsesDeltasUsageAndDone(t *testing.T) {
	captured := make(chan capturedRequest, 1)
	body := "data: {\"id\":\"chatcmpl_stream\",\"model\":\"z-ai/glm-5.2\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"NARRATIUM_\"},\"finish_reason\":null}]}\n\n" +
		"data: {\"id\":\"chatcmpl_stream\",\"model\":\"z-ai/glm-5.2\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"OK\"},\"finish_reason\":\"stop\"}]}\n\n" +
		"data: {\"id\":\"chatcmpl_stream\",\"model\":\"z-ai/glm-5.2\",\"choices\":[],\"usage\":{\"prompt_tokens\":15,\"completion_tokens\":7,\"total_tokens\":22,\"prompt_tokens_details\":{\"cached_tokens\":9,\"cache_write_tokens\":3}}}\n\n" +
		"data: [DONE]\n\n"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		captured <- captureRequest(t, request)
		writer.Header().Set("Content-Type", "text/event-stream")
		writer.WriteHeader(http.StatusOK)
		writeFragmented(t, writer, body)
	}))
	defer server.Close()

	eventChannel, err := NewOpenAI(
		"key",
		WithBaseURL(server.URL),
		WithAPIFormat(OpenAIAPIFormatChatCompletions),
	).Stream(context.Background(), Request{
		Model: "glm-5.2", System: "stable", Input: "hello", MaxOutputTokens: 64,
	})
	if err != nil {
		t.Fatal(err)
	}
	events := collectEvents(t, eventChannel)
	request := <-captured
	payload := decodeObject(t, request.body)
	if request.path != "/v1/chat/completions" || payload["stream"] != true {
		t.Errorf("request = %+v payload=%#v", request, payload)
	}
	if objectValue(t, payload["stream_options"])["include_usage"] != true {
		t.Errorf("stream_options = %#v", payload["stream_options"])
	}

	var deltas strings.Builder
	var completed *Response
	for _, event := range events {
		switch event.Type {
		case EventDelta:
			deltas.WriteString(event.Delta)
		case EventCompleted:
			completed = event.Response
		case EventError:
			t.Fatalf("stream error: %v", event.Err)
		}
	}
	if deltas.String() != "NARRATIUM_OK" || completed == nil || completed.Text != "NARRATIUM_OK" {
		t.Fatalf("events = %+v, deltas = %q", events, deltas.String())
	}
	if completed.ID != "chatcmpl_stream" || completed.Model != "z-ai/glm-5.2" || completed.FinishReason != "stop" {
		t.Errorf("completed = %+v", completed)
	}
	if completed.Usage.InputTokens != 3 || completed.Usage.OutputTokens != 7 || completed.Usage.TotalTokens != 22 || completed.Usage.CacheReadInputTokens != 9 || completed.Usage.CacheCreationInputTokens != 3 {
		t.Errorf("usage = %+v", completed.Usage)
	}
}

func TestOpenAIPromptCacheKeyCanBeDisabled(t *testing.T) {
	tests := []struct {
		name      string
		apiFormat string
		response  string
		wantPath  string
	}{
		{
			name: "Responses", apiFormat: OpenAIAPIFormatResponses, wantPath: "/v1/responses",
			response: `{"id":"resp_1","model":"gpt-5.5","status":"completed","output_text":"ok"}`,
		},
		{
			name: "Chat Completions", apiFormat: OpenAIAPIFormatChatCompletions, wantPath: "/v1/chat/completions",
			response: `{"id":"chatcmpl_1","model":"glm-5.2","choices":[{"index":0,"message":{"content":"ok"},"finish_reason":"stop"}]}`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			captured := make(chan capturedRequest, 1)
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				captured <- captureRequest(t, request)
				writer.Header().Set("Content-Type", "application/json")
				_, _ = writer.Write([]byte(test.response))
			}))
			defer server.Close()

			adapter := NewOpenAI(
				"key",
				WithBaseURL(server.URL),
				WithAPIFormat(test.apiFormat),
				WithPromptCacheKeyEnabled(false),
			)
			if _, err := adapter.Generate(context.Background(), Request{
				Model: "glm-5.2", System: "stable system", Input: "hello",
			}); err != nil {
				t.Fatal(err)
			}
			request := <-captured
			if request.path != test.wantPath {
				t.Errorf("path = %q, want %q", request.path, test.wantPath)
			}
			payload := decodeObject(t, request.body)
			if _, exists := payload["prompt_cache_key"]; exists {
				t.Errorf("disabled prompt_cache_key was sent: %s", request.body)
			}
		})
	}
}

func TestOpenAIRejectsUnknownAPIFormat(t *testing.T) {
	_, err := New(KindOpenAI, "key", WithAPIFormat("legacy_completions"))
	if !errors.Is(err, ErrInvalidRequest) || !strings.Contains(err.Error(), "legacy_completions") {
		t.Fatalf("New error = %v", err)
	}

	adapter := NewOpenAI("key", WithAPIFormat("legacy_completions"))
	_, err = adapter.Generate(context.Background(), Request{Input: "hello"})
	if !errors.Is(err, ErrInvalidRequest) || !strings.Contains(err.Error(), OpenAIAPIFormatChatCompletions) {
		t.Fatalf("Generate error = %v", err)
	}
}

func TestOpenAIChatReportsEmbeddedErrorsAndTruncation(t *testing.T) {
	t.Run("non-stream error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"error":{"type":"invalid_request_error","code":"unsupported_parameter","message":"unsupported"},"usage":{"prompt_tokens":11,"completion_tokens":2}}`))
		}))
		defer server.Close()

		_, err := NewOpenAI("key", WithBaseURL(server.URL), WithAPIFormat(OpenAIAPIFormatChatCompletions)).Generate(
			context.Background(), Request{Input: "hello"},
		)
		var upstream *UpstreamError
		if !errors.As(err, &upstream) || upstream.Code != "unsupported_parameter" || upstream.Usage.InputTokens != 11 || upstream.Usage.OutputTokens != 2 {
			t.Fatalf("error = %T %v", err, err)
		}
	})

	t.Run("stream error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			writer.Header().Set("Content-Type", "text/event-stream")
			_, _ = writer.Write([]byte("data: {\"error\":{\"type\":\"server_error\",\"code\":\"upstream_failed\",\"message\":\"exploded\"},\"usage\":{\"prompt_tokens\":19,\"completion_tokens\":4}}\n\n"))
		}))
		defer server.Close()

		events, err := NewOpenAI("key", WithBaseURL(server.URL), WithAPIFormat(OpenAIAPIFormatChatCompletions)).Stream(
			context.Background(), Request{Input: "hello"},
		)
		if err != nil {
			t.Fatal(err)
		}
		collected := collectEvents(t, events)
		if len(collected) != 1 || collected[0].Type != EventError {
			t.Fatalf("events = %+v", collected)
		}
		var upstream *UpstreamError
		if !errors.As(collected[0].Err, &upstream) || upstream.Message != "exploded" || collected[0].Usage.InputTokens != 19 || collected[0].Usage.OutputTokens != 4 {
			t.Fatalf("error event = %+v", collected[0])
		}
	})

	t.Run("truncated stream", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			writer.Header().Set("Content-Type", "text/event-stream")
			_, _ = writer.Write([]byte("data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"partial\"},\"finish_reason\":\"stop\"}]}\n\n"))
		}))
		defer server.Close()

		events, err := NewOpenAI("key", WithBaseURL(server.URL), WithAPIFormat(OpenAIAPIFormatChatCompletions)).Stream(
			context.Background(), Request{Input: "hello"},
		)
		if err != nil {
			t.Fatal(err)
		}
		collected := collectEvents(t, events)
		if len(collected) != 2 || collected[0].Type != EventDelta || collected[1].Type != EventError || !errors.Is(collected[1].Err, ErrStreamTerminated) {
			t.Fatalf("events = %+v", collected)
		}
	})
}
