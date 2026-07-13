package provider

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestProvidersParseNon2xxErrors(t *testing.T) {
	tests := []struct {
		name        string
		body        string
		newProvider func(string) Provider
		wantType    string
		wantCode    string
		wantMessage string
	}{
		{
			name:        "openai",
			body:        `{"error":{"type":"rate_limit_error","code":"rate_limit","message":"slow down"}}`,
			newProvider: func(baseURL string) Provider { return NewOpenAI("key", WithBaseURL(baseURL)) },
			wantType:    "rate_limit_error",
			wantCode:    "rate_limit",
			wantMessage: "slow down",
		},
		{
			name:        "anthropic",
			body:        `{"type":"error","error":{"type":"overloaded_error","message":"try later"}}`,
			newProvider: func(baseURL string) Provider { return NewAnthropic("key", WithBaseURL(baseURL)) },
			wantType:    "overloaded_error",
			wantMessage: "try later",
		},
		{
			name:        "gemini",
			body:        `{"error":{"code":429,"message":"quota exhausted","status":"RESOURCE_EXHAUSTED"}}`,
			newProvider: func(baseURL string) Provider { return NewGemini("key", WithBaseURL(baseURL)) },
			wantType:    "RESOURCE_EXHAUSTED",
			wantCode:    "429",
			wantMessage: "quota exhausted",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.Header().Set("Content-Type", "application/json")
				writer.Header().Set("x-request-id", "req_test")
				writer.Header().Set("Retry-After", "3")
				writer.WriteHeader(http.StatusTooManyRequests)
				_, _ = writer.Write([]byte(test.body))
			}))
			defer server.Close()

			_, err := test.newProvider(server.URL).Generate(context.Background(), Request{Input: "hello"})
			if err == nil {
				t.Fatal("Generate returned nil error")
			}
			var upstream *UpstreamError
			if !errors.As(err, &upstream) {
				t.Fatalf("error type = %T, want *UpstreamError: %v", err, err)
			}
			if upstream.StatusCode != http.StatusTooManyRequests {
				t.Errorf("status = %d", upstream.StatusCode)
			}
			if upstream.Type != test.wantType || upstream.Code != test.wantCode || upstream.Message != test.wantMessage {
				t.Errorf("upstream error = %+v", upstream)
			}
			if upstream.RequestID != "req_test" || upstream.RetryAfter != "3" {
				t.Errorf("error metadata = %+v", upstream)
			}
			if !upstream.Temporary() {
				t.Error("429 error is not marked temporary")
			}
		})
	}
}

func TestInjectedHTTPClientTimeoutIsPreserved(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		time.Sleep(150 * time.Millisecond)
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"output_text":"late"}`))
	}))
	defer server.Close()

	client := &http.Client{Timeout: 20 * time.Millisecond}
	adapter := NewOpenAI("key", WithBaseURL(server.URL), WithHTTPClient(client))
	_, err := adapter.Generate(context.Background(), Request{Input: "hello"})
	if err == nil {
		t.Fatal("Generate returned nil error")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("error = %v, want context deadline exceeded", err)
	}
}
