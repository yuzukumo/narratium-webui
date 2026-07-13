// Package provider provides a normalized text-generation interface for the
// OpenAI Responses and Chat Completions, Anthropic Messages, and Gemini
// generateContent APIs.
package provider

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type Kind string

const (
	KindOpenAI    Kind = "openai"
	KindAnthropic Kind = "anthropic"
	KindGemini    Kind = "gemini"

	DefaultOpenAIModel     = "gpt-5.5"
	DefaultAnthropicModel  = "claude-fable-5"
	DefaultGeminiModel     = "gemini-3.1-pro-preview"
	DefaultMaxOutputTokens = 4096

	OpenAIAPIFormatResponses       = "responses"
	OpenAIAPIFormatChatCompletions = "chat_completions"
)

var (
	ErrMissingAPIKey    = errors.New("provider API key is required")
	ErrInvalidRequest   = errors.New("invalid provider request")
	ErrEmptyResponse    = errors.New("provider returned an empty response")
	ErrResponseTooLarge = errors.New("provider response exceeds the size limit")
	ErrStreamTerminated = errors.New("provider stream ended before a terminal event")
)

type Role string

const (
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
)

// Message is one conversational turn. CacheBreakpoint is honored by
// Anthropic only; at most four breakpoints, including the system breakpoint,
// are sent upstream.
type Message struct {
	Role            Role   `json:"role"`
	Content         string `json:"content"`
	CacheBreakpoint bool   `json:"cache_breakpoint,omitempty"`
}

// ReasoningConfig is an explicit provider-neutral reasoning policy. A nil
// policy leaves the upstream default untouched; Enabled false requests the
// provider's documented disabled mode.
type ReasoningConfig struct {
	Enabled bool
	Effort  string
}

// Request contains provider-neutral text generation parameters. Input is a
// shorthand for a final user message and is appended after Messages.
//
// StableSystemPrefix identifies the initial, stable part of System. If it is
// empty, the complete System string is considered stable. An explicit prefix
// must be an exact prefix of System.
type Request struct {
	Model              string
	System             string
	StableSystemPrefix string
	Messages           []Message
	Input              string
	MaxOutputTokens    int
	Temperature        *float64
	TopP               *float64
	StopSequences      []string
	Reasoning          *ReasoningConfig
}

// Usage exposes mutually exclusive ordinary input, cache read, cache creation,
// and output buckets. TotalTokens uses the provider total when available.
type Usage struct {
	InputTokens              int64 `json:"input_tokens"`
	OutputTokens             int64 `json:"output_tokens"`
	TotalTokens              int64 `json:"total_tokens"`
	ReasoningTokens          int64 `json:"reasoning_tokens,omitempty"`
	CacheReadInputTokens     int64 `json:"cache_read_input_tokens,omitempty"`
	CacheCreationInputTokens int64 `json:"cache_creation_input_tokens,omitempty"`
}

type Response struct {
	ID           string          `json:"id,omitempty"`
	Model        string          `json:"model,omitempty"`
	Text         string          `json:"text"`
	FinishReason string          `json:"finish_reason,omitempty"`
	Usage        Usage           `json:"usage"`
	Raw          json.RawMessage `json:"-"`
}

type EventType string

const (
	EventDelta     EventType = "delta"
	EventCompleted EventType = "completed"
	EventError     EventType = "error"
)

// Event is the normalized streaming contract. Completed events expose Text
// and Usage directly for convenient consumers and also include Response.
type Event struct {
	Type     EventType
	Delta    string
	Text     string
	Usage    Usage
	Response *Response
	Err      error
}

type Provider interface {
	Kind() Kind
	Generate(context.Context, Request) (*Response, error)
	Stream(context.Context, Request) (<-chan Event, error)
}

// Adapter is retained as a descriptive alias for Provider.
type Adapter = Provider

type clientOptions struct {
	baseURL               string
	defaultModel          string
	httpClient            *http.Client
	apiFormat             string
	promptCacheKeyEnabled bool
}

type Option func(*clientOptions)

func WithBaseURL(baseURL string) Option {
	return func(options *clientOptions) {
		options.baseURL = strings.TrimSpace(baseURL)
	}
}

func WithDefaultModel(model string) Option {
	return func(options *clientOptions) {
		if model = strings.TrimSpace(model); model != "" {
			options.defaultModel = model
		}
	}
}

// WithAPIFormat selects an OpenAI wire protocol. OpenAI defaults to the
// Responses API; chat_completions is available for compatible gateways.
// Other provider adapters ignore this option.
func WithAPIFormat(apiFormat string) Option {
	return func(options *clientOptions) {
		options.apiFormat = strings.ToLower(strings.TrimSpace(apiFormat))
	}
}

// WithPromptCacheKeyEnabled controls whether OpenAI requests include the
// prompt_cache_key extension. It defaults to true for the official OpenAI
// APIs and can be disabled for compatible gateways that reject the field.
func WithPromptCacheKeyEnabled(enabled bool) Option {
	return func(options *clientOptions) {
		options.promptCacheKeyEnabled = enabled
	}
}

// WithHTTPClient injects the client used for all upstream requests. The
// adapter does not replace its timeout or transport, so callers can apply
// service-specific timeout, proxy, and tracing policy.
func WithHTTPClient(client *http.Client) Option {
	return func(options *clientOptions) {
		if client != nil {
			options.httpClient = client
		}
	}
}

// New constructs a provider by kind. Provider-specific constructors are also
// available when the concrete adapter type is useful.
func New(kind Kind, apiKey string, options ...Option) (Provider, error) {
	switch Kind(strings.ToLower(strings.TrimSpace(string(kind)))) {
	case KindOpenAI:
		adapter := NewOpenAI(apiKey, options...)
		if adapter.configurationError != nil {
			return nil, adapter.configurationError
		}
		return adapter, nil
	case KindAnthropic:
		return NewAnthropic(apiKey, options...), nil
	case KindGemini:
		return NewGemini(apiKey, options...), nil
	default:
		return nil, errors.New("unsupported provider: " + string(kind))
	}
}
