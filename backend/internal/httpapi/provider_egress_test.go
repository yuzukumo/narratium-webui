package httpapi

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"testing"

	"github.com/yuzukumo/narratium-webui/backend/internal/domain"
)

func TestProviderIPBlocked(t *testing.T) {
	tests := []struct {
		address string
		blocked bool
	}{
		{address: "127.0.0.1", blocked: true},
		{address: "10.0.0.1", blocked: true},
		{address: "100.64.0.1", blocked: true},
		{address: "169.254.169.254", blocked: true},
		{address: "::1", blocked: true},
		{address: "::ffff:192.168.1.1", blocked: true},
		{address: "2001:db8::1", blocked: true},
		{address: "8.8.8.8", blocked: false},
		{address: "2606:4700:4700::1111", blocked: false},
	}
	for _, test := range tests {
		t.Run(test.address, func(t *testing.T) {
			if got := providerIPBlocked(netip.MustParseAddr(test.address)); got != test.blocked {
				t.Fatalf("providerIPBlocked(%s)=%v, want %v", test.address, got, test.blocked)
			}
		})
	}
}

func TestRestrictedProviderDialerRejectsLoopbackBeforeConnect(t *testing.T) {
	dialer := restrictedProviderDialer{resolver: net.DefaultResolver}
	_, err := dialer.DialContext(context.Background(), "tcp", "127.0.0.1:8080")
	if !errors.Is(err, errProviderAddressBlocked) {
		t.Fatalf("error=%v, want blocked address", err)
	}
}

func TestValidateProviderRequiresHTTPSByDefault(t *testing.T) {
	item := domain.ProviderConfig{
		Name: "Local", Provider: "openai", APIFormat: domain.ProviderAPIFormatChatCompletions,
		BaseURL: "http://localhost:8080",
	}
	if err := validateProvider(item, false); err == nil {
		t.Fatal("expected insecure HTTP URL to be rejected")
	}
	if err := validateProvider(item, true); err != nil {
		t.Fatalf("development override rejected URL: %v", err)
	}
}

func TestValidateProviderRequiresMatchingAPIFormat(t *testing.T) {
	tests := []struct {
		name                  string
		provider              string
		apiFormat             string
		promptCacheKeyEnabled bool
		wantError             bool
	}{
		{name: "OpenAI Responses", provider: "openai", apiFormat: domain.ProviderAPIFormatResponses},
		{name: "OpenAI Chat Completions", provider: "openai", apiFormat: domain.ProviderAPIFormatChatCompletions},
		{name: "OpenAI native mismatch", provider: "openai", apiFormat: domain.ProviderAPIFormatMessages, wantError: true},
		{name: "Anthropic Messages", provider: "anthropic", apiFormat: domain.ProviderAPIFormatMessages},
		{name: "Anthropic rejects OpenAI cache key", provider: "anthropic", apiFormat: domain.ProviderAPIFormatMessages, promptCacheKeyEnabled: true, wantError: true},
		{name: "Gemini generateContent", provider: "gemini", apiFormat: domain.ProviderAPIFormatGenerateContent},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			item := domain.ProviderConfig{
				Name: "Provider", Provider: test.provider, APIFormat: test.apiFormat,
				PromptCacheKeyEnabled: test.promptCacheKeyEnabled, BaseURL: "https://provider.example",
			}
			err := validateProvider(item, false)
			if (err != nil) != test.wantError {
				t.Fatalf("validateProvider() error = %v, wantError=%v", err, test.wantError)
			}
		})
	}
}
