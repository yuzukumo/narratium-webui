package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strings"
)

const (
	maxResponseBytes    = int64(32 << 20)
	maxErrorBodyBytes   = int64(1 << 20)
	streamChannelBuffer = 16
)

type baseClient struct {
	kind                  Kind
	apiKey                string
	baseURL               string
	defaultModel          string
	httpClient            *http.Client
	apiFormat             string
	promptCacheKeyEnabled bool
}

type normalizedRequest struct {
	model           string
	system          string
	stableSystem    string
	messages        []Message
	maxOutputTokens int
	temperature     *float64
	topP            *float64
	stopSequences   []string
	reasoning       *ReasoningConfig
}

func newBaseClient(kind Kind, apiKey, defaultBaseURL, defaultModel string, options ...Option) baseClient {
	settings := clientOptions{
		baseURL:               defaultBaseURL,
		defaultModel:          defaultModel,
		httpClient:            http.DefaultClient,
		promptCacheKeyEnabled: true,
	}
	for _, option := range options {
		if option != nil {
			option(&settings)
		}
	}
	if strings.TrimSpace(settings.baseURL) == "" {
		settings.baseURL = defaultBaseURL
	}
	if settings.httpClient == nil {
		settings.httpClient = http.DefaultClient
	}
	return baseClient{
		kind:                  kind,
		apiKey:                strings.TrimSpace(apiKey),
		baseURL:               strings.TrimRight(strings.TrimSpace(settings.baseURL), "/"),
		defaultModel:          strings.TrimSpace(settings.defaultModel),
		httpClient:            settings.httpClient,
		apiFormat:             settings.apiFormat,
		promptCacheKeyEnabled: settings.promptCacheKeyEnabled,
	}
}

func (client baseClient) normalize(request Request) (normalizedRequest, error) {
	if client.apiKey == "" {
		return normalizedRequest{}, ErrMissingAPIKey
	}

	model := strings.TrimSpace(request.Model)
	if model == "" {
		model = client.defaultModel
	}
	if model == "" {
		return normalizedRequest{}, fmt.Errorf("%w: model is required", ErrInvalidRequest)
	}

	system := strings.TrimSpace(request.System)
	stableSystem := strings.TrimSpace(request.StableSystemPrefix)
	if stableSystem == "" {
		stableSystem = system
	}
	if stableSystem != "" && !strings.HasPrefix(system, stableSystem) {
		return normalizedRequest{}, fmt.Errorf("%w: stable system prefix is not a prefix of system", ErrInvalidRequest)
	}

	messages := make([]Message, 0, len(request.Messages)+1)
	for index, message := range request.Messages {
		role := Role(strings.ToLower(strings.TrimSpace(string(message.Role))))
		if role != RoleUser && role != RoleAssistant {
			return normalizedRequest{}, fmt.Errorf("%w: message %d has unsupported role %q", ErrInvalidRequest, index, message.Role)
		}
		if strings.TrimSpace(message.Content) == "" {
			return normalizedRequest{}, fmt.Errorf("%w: message %d content is empty", ErrInvalidRequest, index)
		}
		message.Role = role
		messages = append(messages, message)
	}
	if strings.TrimSpace(request.Input) != "" {
		messages = append(messages, Message{Role: RoleUser, Content: request.Input})
	}
	if len(messages) == 0 {
		return normalizedRequest{}, fmt.Errorf("%w: at least one message or input is required", ErrInvalidRequest)
	}

	maxTokens := request.MaxOutputTokens
	if maxTokens == 0 {
		maxTokens = DefaultMaxOutputTokens
	}
	if maxTokens < 0 {
		return normalizedRequest{}, fmt.Errorf("%w: max output tokens must be positive", ErrInvalidRequest)
	}
	if err := validateOptionalNumber("temperature", request.Temperature); err != nil {
		return normalizedRequest{}, err
	}
	if err := validateOptionalNumber("top_p", request.TopP); err != nil {
		return normalizedRequest{}, err
	}

	stops := make([]string, 0, len(request.StopSequences))
	for _, stop := range request.StopSequences {
		if stop != "" {
			stops = append(stops, stop)
		}
	}

	var reasoning *ReasoningConfig
	if request.Reasoning != nil {
		reasoning = &ReasoningConfig{
			Enabled: request.Reasoning.Enabled,
			Effort:  strings.TrimSpace(request.Reasoning.Effort),
		}
		if reasoning.Enabled && reasoning.Effort == "" {
			return normalizedRequest{}, fmt.Errorf("%w: reasoning effort is required when reasoning is enabled", ErrInvalidRequest)
		}
		if !reasoning.Enabled && reasoning.Effort != "" {
			return normalizedRequest{}, fmt.Errorf("%w: reasoning effort must be empty when reasoning is disabled", ErrInvalidRequest)
		}
	}

	return normalizedRequest{
		model:           model,
		system:          system,
		stableSystem:    stableSystem,
		messages:        messages,
		maxOutputTokens: maxTokens,
		temperature:     request.Temperature,
		topP:            request.TopP,
		stopSequences:   stops,
		reasoning:       reasoning,
	}, nil
}

func validateOptionalNumber(name string, value *float64) error {
	if value != nil && (math.IsNaN(*value) || math.IsInf(*value, 0)) {
		return fmt.Errorf("%w: %s must be finite", ErrInvalidRequest, name)
	}
	return nil
}

func newJSONRequest(ctx context.Context, endpoint string, payload any) (*http.Request, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("encode provider request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create provider request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	return request, nil
}

func (client baseClient) do(request *http.Request) (*http.Response, error) {
	response, err := client.httpClient.Do(request)
	if err == nil {
		return response, nil
	}
	if contextError := request.Context().Err(); contextError != nil {
		return nil, contextError
	}
	return nil, fmt.Errorf("%s upstream request: %w", client.kind, err)
}

func (client baseClient) requireSuccess(response *http.Response) error {
	if response.StatusCode >= http.StatusOK && response.StatusCode < http.StatusMultipleChoices {
		return nil
	}
	body, readErr := readLimited(response.Body, maxErrorBodyBytes)
	if readErr != nil && !errorsIsResponseTooLarge(readErr) {
		return fmt.Errorf("read %s error response: %w", client.kind, readErr)
	}
	return parseUpstreamError(client.kind, response.StatusCode, response.Header, body, "")
}

func errorsIsResponseTooLarge(err error) bool {
	return err == ErrResponseTooLarge
}

func readLimited(reader io.Reader, limit int64) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > limit {
		return body[:limit], ErrResponseTooLarge
	}
	return body, nil
}

func resolveEndpoint(baseURL, version, resource string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return "", fmt.Errorf("invalid provider base URL: %w", err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("invalid provider base URL %q", baseURL)
	}

	path := strings.TrimRight(parsed.Path, "/")
	resourceSuffix := "/" + strings.TrimLeft(resource, "/")
	if !strings.HasSuffix(path, resourceSuffix) {
		versionSuffix := "/" + strings.Trim(version, "/")
		if strings.HasSuffix(path, versionSuffix) {
			path += resourceSuffix
		} else {
			path += versionSuffix + resourceSuffix
		}
	}
	parsed.Path = path
	parsed.RawPath = ""
	return parsed.String(), nil
}

func startStream(ctx context.Context, response *http.Response, parse func(func(Event) error) error) <-chan Event {
	events := make(chan Event, streamChannelBuffer)
	go func() {
		defer close(events)
		defer response.Body.Close()

		emit := func(event Event) error {
			select {
			case events <- event:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		}

		if err := parse(emit); err != nil {
			if contextError := ctx.Err(); contextError != nil {
				err = contextError
			}
			errorEvent := Event{Type: EventError, Err: err}
			var upstreamError *UpstreamError
			if errors.As(err, &upstreamError) {
				errorEvent.Usage = upstreamError.Usage
			}
			select {
			case events <- errorEvent:
			case <-ctx.Done():
				// Cancellation may have happened while the channel was full. Make
				// one best-effort delivery without keeping an abandoned stream alive.
				select {
				case events <- errorEvent:
				default:
				}
			}
		}
	}()
	return events
}

func completedEvent(response *Response) Event {
	return Event{
		Type:     EventCompleted,
		Text:     response.Text,
		Usage:    response.Usage,
		Response: response,
	}
}
