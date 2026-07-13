package provider

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestProviderStreamsHandleFragmentedSSE(t *testing.T) {
	tests := []struct {
		name        string
		body        string
		newProvider func(string) Provider
		wantCache   int64
	}{
		{
			name: "openai",
			body: "data: {\"type\":\"response.output_text.delta\",\"delta\":\"\u4f60\"}\n\n" +
				"data: {\"type\":\"response.output_text.delta\",\"delta\":\"\u597d\"}\n\n" +
				"data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_stream\",\"status\":\"completed\",\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"\u4f60\u597d\"}]}],\"usage\":{\"input_tokens\":5,\"output_tokens\":2,\"input_tokens_details\":{\"cached_tokens\":3}}}}\n\n",
			newProvider: func(baseURL string) Provider { return NewOpenAI("key", WithBaseURL(baseURL)) },
			wantCache:   3,
		},
		{
			name: "anthropic",
			body: "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_stream\",\"type\":\"message\",\"model\":\"claude-stream\",\"content\":[],\"usage\":{\"input_tokens\":5,\"cache_read_input_tokens\":2}}}\n\n" +
				"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"\u4f60\"}}\n\n" +
				"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"\u597d\"}}\n\n" +
				"event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":2}}\n\n" +
				"event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
			newProvider: func(baseURL string) Provider { return NewAnthropic("key", WithBaseURL(baseURL)) },
			wantCache:   2,
		},
		{
			name: "gemini",
			body: "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"\u4f60\"}]}}]}\n\n" +
				"data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"\u597d\"}]},\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"promptTokenCount\":5,\"candidatesTokenCount\":2,\"totalTokenCount\":7,\"cachedContentTokenCount\":1}}\n\n",
			newProvider: func(baseURL string) Provider { return NewGemini("key", WithBaseURL(baseURL)) },
			wantCache:   1,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			captured := make(chan capturedRequest, 1)
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				captured <- captureRequest(t, request)
				writer.Header().Set("Content-Type", "text/event-stream")
				writer.WriteHeader(http.StatusOK)
				writeFragmented(t, writer, test.body)
			}))
			defer server.Close()

			eventChannel, err := test.newProvider(server.URL).Stream(context.Background(), Request{
				Model:  "arbitrary-model",
				System: "stable system",
				Input:  "hello",
			})
			if err != nil {
				t.Fatalf("Stream returned error: %v", err)
			}
			events := collectEvents(t, eventChannel)
			request := <-captured
			assertStreamingRequest(t, test.name, request)

			var deltas strings.Builder
			var completed *Response
			for _, event := range events {
				switch event.Type {
				case EventDelta:
					deltas.WriteString(event.Delta)
				case EventCompleted:
					completed = event.Response
				case EventError:
					t.Fatalf("stream error event: %v", event.Err)
				}
			}
			if got := deltas.String(); got != "\u4f60\u597d" {
				t.Errorf("deltas = %q", got)
			}
			if completed == nil {
				t.Fatal("missing completed event")
			}
			if completed.Text != "\u4f60\u597d" {
				t.Errorf("completed text = %q", completed.Text)
			}
			if completed.Usage.CacheReadInputTokens != test.wantCache {
				t.Errorf("cache read tokens = %d, want %d", completed.Usage.CacheReadInputTokens, test.wantCache)
			}
		})
	}
}

func assertStreamingRequest(t *testing.T, kind string, request capturedRequest) {
	t.Helper()
	payload := decodeObject(t, request.body)
	switch kind {
	case "openai", "anthropic":
		if payload["stream"] != true {
			t.Errorf("stream payload field = %#v", payload["stream"])
		}
	case "gemini":
		if request.path != "/v1beta/models/arbitrary-model:streamGenerateContent" {
			t.Errorf("Gemini stream path = %q", request.path)
		}
		if request.query != "alt=sse" {
			t.Errorf("Gemini stream query = %q", request.query)
		}
	}
}

func TestGeminiStreamParsesFragmentedJSONArray(t *testing.T) {
	body := "[" +
		"{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"hel\"}]}}]}," +
		"{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"lo\"}]},\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"promptTokenCount\":4,\"candidatesTokenCount\":2,\"totalTokenCount\":6,\"cachedContentTokenCount\":2}}" +
		"]"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusOK)
		writeFragmented(t, writer, body)
	}))
	defer server.Close()

	eventChannel, err := NewGemini("key", WithBaseURL(server.URL)).Stream(context.Background(), Request{Input: "hello"})
	if err != nil {
		t.Fatalf("Stream returned error: %v", err)
	}
	events := collectEvents(t, eventChannel)
	var text strings.Builder
	var completed *Response
	for _, event := range events {
		if event.Type == EventDelta {
			text.WriteString(event.Delta)
		}
		if event.Type == EventCompleted {
			completed = event.Response
		}
		if event.Type == EventError {
			t.Fatalf("stream error: %v", event.Err)
		}
	}
	if text.String() != "hello" || completed == nil || completed.Text != "hello" {
		t.Errorf("events = %+v, delta text = %q", events, text.String())
	}
	if completed.Usage.CacheReadInputTokens != 2 {
		t.Errorf("usage = %+v", completed.Usage)
	}
	if completed.Usage.InputTokens != 2 {
		t.Errorf("ordinary input tokens = %d, want 2", completed.Usage.InputTokens)
	}
}

func TestProvidersNormalizeInStreamErrors(t *testing.T) {
	tests := []struct {
		name        string
		body        string
		newProvider func(string) Provider
		wantMessage string
		wantInput   int64
		wantOutput  int64
	}{
		{
			name:        "openai",
			body:        "data: {\"type\":\"response.failed\",\"response\":{\"status\":\"failed\",\"error\":{\"code\":\"server_error\",\"message\":\"OpenAI exploded\"},\"usage\":{\"input_tokens\":19,\"output_tokens\":4}}}\n\n",
			newProvider: func(baseURL string) Provider { return NewOpenAI("key", WithBaseURL(baseURL)) },
			wantMessage: "OpenAI exploded",
			wantInput:   19,
			wantOutput:  4,
		},
		{
			name:        "anthropic",
			body:        "event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Anthropic exploded\"}}\n\n",
			newProvider: func(baseURL string) Provider { return NewAnthropic("key", WithBaseURL(baseURL)) },
			wantMessage: "Anthropic exploded",
		},
		{
			name:        "gemini",
			body:        "data: {\"error\":{\"code\":500,\"status\":\"INTERNAL\",\"message\":\"Gemini exploded\"}}\n\n",
			newProvider: func(baseURL string) Provider { return NewGemini("key", WithBaseURL(baseURL)) },
			wantMessage: "Gemini exploded",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.Header().Set("Content-Type", "text/event-stream")
				_, _ = writer.Write([]byte(test.body))
			}))
			defer server.Close()

			eventChannel, err := test.newProvider(server.URL).Stream(context.Background(), Request{Input: "hello"})
			if err != nil {
				t.Fatalf("Stream returned initial error: %v", err)
			}
			events := collectEvents(t, eventChannel)
			if len(events) != 1 || events[0].Type != EventError {
				t.Fatalf("events = %+v, want one error event", events)
			}
			var upstream *UpstreamError
			if !errors.As(events[0].Err, &upstream) {
				t.Fatalf("event error type = %T: %v", events[0].Err, events[0].Err)
			}
			if upstream.Message != test.wantMessage {
				t.Errorf("message = %q, want %q", upstream.Message, test.wantMessage)
			}
			if events[0].Usage.InputTokens != test.wantInput || events[0].Usage.OutputTokens != test.wantOutput {
				t.Errorf("error usage = %+v, want input=%d output=%d", events[0].Usage, test.wantInput, test.wantOutput)
			}
		})
	}
}

func TestGeminiStreamReportsBlockedTerminalEvents(t *testing.T) {
	tests := []struct {
		name     string
		body     string
		wantCode string
	}{
		{
			name:     "prompt feedback",
			body:     `data: {"promptFeedback":{"blockReason":"SAFETY","blockReasonMessage":"blocked prompt"},"usageMetadata":{"promptTokenCount":7,"totalTokenCount":7}}` + "\n\n",
			wantCode: "SAFETY",
		},
		{
			name:     "candidate finish reason",
			body:     `data: {"candidates":[{"finishReason":"PROHIBITED_CONTENT"}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":2,"totalTokenCount":9}}` + "\n\n",
			wantCode: "PROHIBITED_CONTENT",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.Header().Set("Content-Type", "text/event-stream")
				_, _ = writer.Write([]byte(test.body))
			}))
			defer server.Close()

			eventChannel, err := NewGemini("key", WithBaseURL(server.URL)).Stream(context.Background(), Request{Input: "hello"})
			if err != nil {
				t.Fatal(err)
			}
			events := collectEvents(t, eventChannel)
			if len(events) != 1 || events[0].Type != EventError {
				t.Fatalf("events=%+v, want one error", events)
			}
			var upstream *UpstreamError
			if !errors.As(events[0].Err, &upstream) {
				t.Fatalf("error=%T %v, want UpstreamError", events[0].Err, events[0].Err)
			}
			if upstream.Code != test.wantCode {
				t.Fatalf("error=%v code=%q, want %q", events[0].Err, upstream.Code, test.wantCode)
			}
			if events[0].Usage.InputTokens != 7 {
				t.Fatalf("usage=%+v", events[0].Usage)
			}
		})
	}
}

func TestStreamHonorsContextCancellation(t *testing.T) {
	handlerDone := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		defer close(handlerDone)
		writer.Header().Set("Content-Type", "text/event-stream")
		writer.WriteHeader(http.StatusOK)
		writer.(http.Flusher).Flush()
		<-request.Context().Done()
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	eventChannel, err := NewOpenAI("key", WithBaseURL(server.URL)).Stream(ctx, Request{Input: "hello"})
	if err != nil {
		t.Fatalf("Stream returned error: %v", err)
	}
	cancel()
	events := collectEvents(t, eventChannel)
	if len(events) != 1 || events[0].Type != EventError || !errors.Is(events[0].Err, context.Canceled) {
		t.Fatalf("events = %+v, want context cancellation error", events)
	}
	select {
	case <-handlerDone:
	case <-time.After(2 * time.Second):
		t.Fatal("upstream request context was not canceled")
	}
}

func TestStreamDoesNotDropErrorAfterBufferedDeltas(t *testing.T) {
	wantErr := errors.New("terminal stream error")
	response := &http.Response{Body: io.NopCloser(strings.NewReader(""))}
	eventChannel := startStream(context.Background(), response, func(emit func(Event) error) error {
		for range streamChannelBuffer {
			if err := emit(Event{Type: EventDelta, Delta: "x"}); err != nil {
				return err
			}
		}
		return wantErr
	})

	// Let the producer fill the buffer and block on terminal error delivery.
	time.Sleep(10 * time.Millisecond)
	events := collectEvents(t, eventChannel)
	if len(events) != streamChannelBuffer+1 {
		t.Fatalf("event count = %d, want %d", len(events), streamChannelBuffer+1)
	}
	last := events[len(events)-1]
	if last.Type != EventError || !errors.Is(last.Err, wantErr) {
		t.Errorf("last event = %+v", last)
	}
}
