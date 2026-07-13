package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/yuzukumo/narratium-webui/backend/internal/domain"
	llmprovider "github.com/yuzukumo/narratium-webui/backend/internal/provider"
	"github.com/yuzukumo/narratium-webui/backend/internal/store"
)

type chatRequest struct {
	ModelID            string   `json:"model_id"`
	System             string   `json:"system"`
	StableSystemPrefix string   `json:"stable_system_prefix,omitempty"`
	Input              string   `json:"input"`
	MaxOutputTokens    int      `json:"max_output_tokens"`
	Temperature        *float64 `json:"temperature,omitempty"`
}

type chatUsage struct {
	CostMicrousd             int64  `json:"cost_microusd,string,omitempty"`
	InputTokens              int64  `json:"input_tokens"`
	OutputTokens             int64  `json:"output_tokens"`
	TotalTokens              int64  `json:"total_tokens"`
	ReasoningTokens          int64  `json:"reasoning_tokens,omitempty"`
	CacheReadInputTokens     int64  `json:"cache_read_input_tokens,omitempty"`
	CacheCreationInputTokens int64  `json:"cache_creation_input_tokens,omitempty"`
	DurationMS               int64  `json:"duration_ms"`
	FirstTokenMS             *int64 `json:"first_token_ms,omitempty"`
}

type chatResponse struct {
	ID           string    `json:"id,omitempty"`
	Model        string    `json:"model"`
	Text         string    `json:"text"`
	FinishReason string    `json:"finish_reason,omitempty"`
	Usage        chatUsage `json:"usage"`
}

func (a *API) chat(c *gin.Context) {
	var request chatRequest
	if err := decodeJSON(c, &request); err != nil {
		writeDecodeError(c, err, "Invalid chat request.")
		return
	}
	if err := validateChatRequest(request, a.cfg.MaxOutputTokens); err != nil {
		writeError(c, http.StatusBadRequest, "invalid_chat_request", err.Error())
		return
	}
	user := currentUser(c)
	release, retryAfter, limitReason, ok := a.chatLimiter.acquire(user.ID)
	if !ok {
		setRetryAfterDuration(c, retryAfter)
		code := "chat_rate_limited"
		message := "Too many model requests. Try again later."
		if limitReason == chatLimitConcurrency {
			code = "chat_concurrency_limited"
			message = "Too many model requests are already running for this account."
		}
		writeError(c, http.StatusTooManyRequests, code, message)
		return
	}
	defer release()

	model, err := a.repo.ModelByID(c.Request.Context(), request.ModelID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(c, http.StatusNotFound, "model_not_available", "The selected model is not available.")
			return
		}
		a.internalError(c, "load chat model", err)
		return
	}
	capabilities, err := domain.ParseModelCapabilities(model.Capabilities, model.Provider)
	if err != nil || capabilities.Validate(model.Provider, a.cfg.MaxOutputTokens) != nil {
		writeError(c, http.StatusConflict, "invalid_model_configuration", "The selected model capabilities are invalid.")
		return
	}
	if err := model.Pricing.Validate(); err != nil {
		writeError(c, http.StatusConflict, "invalid_model_pricing", "The selected model pricing is invalid.")
		return
	}
	outputLimit := capabilities.MaxOutputTokens
	if a.cfg.MaxOutputTokens > 0 {
		outputLimit = min(outputLimit, a.cfg.MaxOutputTokens)
	}
	if request.MaxOutputTokens > outputLimit {
		writeError(c, http.StatusBadRequest, "max_output_tokens_exceeded", fmt.Sprintf("max_output_tokens must not exceed %d for the selected model", outputLimit))
		return
	}
	estimatedInputTokens := estimateChatInputTokens(request.System, request.Input)
	if estimatedInputTokens+request.MaxOutputTokens > capabilities.ContextWindow {
		writeError(c, http.StatusBadRequest, "context_window_exceeded", "The estimated prompt and requested output exceed the selected model context window.")
		return
	}
	providerConfig, err := a.repo.ProviderByID(c.Request.Context(), model.ProviderConfigID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(c, http.StatusConflict, "provider_not_configured", "The selected model provider is not configured.")
			return
		}
		a.internalError(c, "load model provider", err)
		return
	}
	if !providerConfig.Enabled || providerConfig.APIKeyCiphertext == "" {
		writeError(c, http.StatusConflict, "provider_not_configured", "The selected model provider is not configured.")
		return
	}
	if err := validateProvider(providerConfig, a.cfg.AllowInsecureProviderHTTP); err != nil {
		writeError(c, http.StatusConflict, "invalid_provider_configuration", err.Error())
		return
	}
	apiKey, err := a.cryptor.Decrypt(providerConfig.APIKeyCiphertext)
	if err != nil {
		a.internalError(c, "decrypt model provider", err)
		return
	}
	kind := llmprovider.Kind(providerConfig.Provider)
	adapter, err := llmprovider.New(
		kind,
		apiKey,
		llmprovider.WithBaseURL(providerConfig.BaseURL),
		llmprovider.WithDefaultModel(model.ExternalID),
		llmprovider.WithAPIFormat(providerConfig.APIFormat),
		llmprovider.WithPromptCacheKeyEnabled(providerConfig.PromptCacheKeyEnabled),
		llmprovider.WithHTTPClient(a.client),
	)
	if err != nil {
		a.internalError(c, "create model provider", err)
		return
	}
	providerRequest := llmprovider.Request{
		Model: model.ExternalID, System: request.System,
		StableSystemPrefix: request.StableSystemPrefix, Input: request.Input,
		MaxOutputTokens: request.MaxOutputTokens, Temperature: request.Temperature,
		Reasoning: &llmprovider.ReasoningConfig{
			Enabled: capabilities.Reasoning.Enabled,
			Effort:  capabilities.Reasoning.Effort,
		},
	}

	startedAt := time.Now()
	reservationTTL := a.cfg.UpstreamTimeout + 2*time.Minute
	if reservationTTL < 3*time.Minute {
		reservationTTL = 7 * time.Minute
	}
	inputUpperBound := billingInputTokenUpperBound(
		capabilities.ContextWindow, request.MaxOutputTokens, request.System, request.Input,
	)
	reservation, err := a.repo.ReserveBalance(c.Request.Context(), domain.BillingReservation{
		UserID: user.ID, ModelID: model.ID, RequestID: requestID(c),
		EstimatedCostMicrousd: domain.EstimateMaximumCost(
			model.Pricing, int64(inputUpperBound), int64(request.MaxOutputTokens),
		),
		ExpiresAt: startedAt.Add(reservationTTL),
	})
	if errors.Is(err, store.ErrInsufficientBalance) {
		writeError(c, http.StatusForbidden, "insufficient_user_quota", "Insufficient quota.")
		return
	}
	if errors.Is(err, store.ErrConflict) {
		writeError(c, http.StatusConflict, "billing_request_conflict", "A model request with this request ID already exists.")
		return
	}
	if err != nil {
		a.internalError(c, "reserve model request balance", err)
		return
	}
	a.streamChat(c, adapter, providerRequest, model, reservation, startedAt)
}

func (a *API) streamChat(
	c *gin.Context,
	adapter llmprovider.Provider,
	request llmprovider.Request,
	model domain.Model,
	reservation domain.BillingReservation,
	startedAt time.Time,
) {
	events, err := adapter.Stream(c.Request.Context(), request)
	if err != nil {
		usage := usageFromProviderError(err)
		if _, settleErr := a.finalizeChatBilling(
			reservation.ID, model, reservation.RequestID, "", "", time.Since(startedAt), nil,
			usage, providerErrorCode(err),
		); settleErr != nil {
			a.internalError(c, "settle failed model request", settleErr)
			return
		}
		a.writeProviderError(c, err)
		return
	}
	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-cache, no-transform")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	flusher, _ := c.Writer.(http.Flusher)
	terminal := false
	var finalUsage llmprovider.Usage
	var firstTokenMS *int64
	var errorCode string
	var settlement domain.BillingSettlement
	settled := false
	settle := func() (domain.BillingSettlement, error) {
		if settled {
			return settlement, nil
		}
		result, settleErr := a.finalizeChatBilling(
			reservation.ID, model, reservation.RequestID, "", "", time.Since(startedAt), firstTokenMS,
			finalUsage, errorCode,
		)
		if settleErr == nil {
			settled = true
			settlement = result
		}
		return result, settleErr
	}
	defer func() {
		if settled {
			return
		}
		if _, settleErr := settle(); settleErr != nil {
			a.logger.Error("settle model usage", "error", settleErr, "request_id", reservation.RequestID)
		}
	}()

	for event := range events {
		if c.Request.Context().Err() != nil {
			if !terminal {
				errorCode = "canceled"
			}
			return
		}
		switch event.Type {
		case llmprovider.EventDelta:
			if event.Delta != "" && firstTokenMS == nil {
				value := max(time.Since(startedAt).Milliseconds(), 1)
				firstTokenMS = &value
			}
			if event.Delta != "" && writeSSE(c, gin.H{"type": "delta", "delta": event.Delta}) != nil {
				errorCode = "client_disconnected"
				return
			}
		case llmprovider.EventCompleted:
			if terminal {
				continue
			}
			terminal = true
			finalUsage = event.Usage
			response := event.Response
			if response == nil {
				response = &llmprovider.Response{Model: model.ExternalID, Text: event.Text, Usage: event.Usage}
			}
			finalUsage = response.Usage
			duration := time.Since(startedAt)
			settlement, settleErr := settle()
			if settleErr != nil {
				errorCode = "billing_finalize_failed"
				a.logger.Error("settle completed model request", "error", settleErr, "request_id", reservation.RequestID)
				_ = writeSSE(c, gin.H{
					"type": "error", "code": errorCode,
					"message": "The response could not be billed safely.", "request_id": reservation.RequestID,
				})
				return
			}
			usagePayload := toChatUsage(response.Usage, duration, firstTokenMS)
			usagePayload.CostMicrousd = settlement.CostMicrousd
			responsePayload := toChatResponse(response, duration, firstTokenMS)
			responsePayload.Usage.CostMicrousd = settlement.CostMicrousd
			if err := writeSSE(c, gin.H{
				"type": "completed", "text": response.Text,
				"usage":    usagePayload,
				"response": responsePayload,
				"billing":  settlement,
			}); err != nil {
				errorCode = "client_disconnected"
				return
			}
		case llmprovider.EventError:
			if terminal {
				continue
			}
			terminal = true
			finalUsage = event.Usage
			errorCode = providerErrorCode(event.Err)
			settlement, settleErr := settle()
			if settleErr != nil {
				errorCode = "billing_finalize_failed"
				a.logger.Error("settle failed model stream", "error", settleErr, "request_id", reservation.RequestID)
				if writeSSE(c, gin.H{
					"type": "error", "code": errorCode,
					"message": "The failed response could not be billed safely.", "request_id": reservation.RequestID,
				}) != nil {
					errorCode = "client_disconnected"
				}
				return
			}
			payload := gin.H{
				"type": "error", "code": errorCode,
				"message": "The model stream failed.", "request_id": reservation.RequestID,
				"billing": settlement,
			}
			if retryAfter := retryAfterFromError(event.Err); retryAfter != "" {
				payload["retry_after"] = retryAfter
			}
			if event.Usage != (llmprovider.Usage{}) {
				usagePayload := toChatUsage(event.Usage, time.Since(startedAt), firstTokenMS)
				usagePayload.CostMicrousd = settlement.CostMicrousd
				payload["usage"] = usagePayload
			}
			if err := writeSSE(c, payload); err != nil {
				errorCode = "client_disconnected"
				return
			}
		}
		if flusher != nil {
			flusher.Flush()
		}
	}
	if !terminal && c.Request.Context().Err() == nil {
		terminal = true
		errorCode = "stream_ended"
		settlement, settleErr := settle()
		if settleErr != nil {
			errorCode = "billing_finalize_failed"
			a.logger.Error("settle unexpectedly ended model stream", "error", settleErr, "request_id", reservation.RequestID)
		}
		_ = writeSSE(c, gin.H{
			"type": "error", "code": errorCode,
			"message": "The model stream ended unexpectedly.", "request_id": reservation.RequestID,
			"billing": settlement,
		})
		if flusher != nil {
			flusher.Flush()
		}
	}
}

func writeSSE(c *gin.Context, payload any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(c.Writer, "data: %s\n\n", encoded)
	return err
}

func validateChatRequest(request chatRequest, maxOutputTokens int) error {
	if strings.TrimSpace(request.ModelID) == "" {
		return errors.New("model_id is required")
	}
	if strings.TrimSpace(request.Input) == "" {
		return errors.New("input is required")
	}
	if request.MaxOutputTokens < 1 {
		return errors.New("max_output_tokens must be positive")
	}
	if maxOutputTokens > 0 && request.MaxOutputTokens > maxOutputTokens {
		return fmt.Errorf("max_output_tokens must be between 1 and %d", maxOutputTokens)
	}
	if request.Temperature != nil && (*request.Temperature < 0 || *request.Temperature > 2) {
		return errors.New("temperature must be between 0 and 2")
	}
	if request.StableSystemPrefix != "" && !strings.HasPrefix(strings.TrimSpace(request.System), strings.TrimSpace(request.StableSystemPrefix)) {
		return errors.New("stable_system_prefix must be a prefix of system")
	}
	return nil
}

func toChatResponse(response *llmprovider.Response, duration time.Duration, firstTokenMS *int64) chatResponse {
	return chatResponse{
		ID: response.ID, Model: response.Model, Text: response.Text,
		FinishReason: response.FinishReason, Usage: toChatUsage(response.Usage, duration, firstTokenMS),
	}
}

func toChatUsage(usage llmprovider.Usage, duration time.Duration, firstTokenMS *int64) chatUsage {
	return chatUsage{
		InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens,
		TotalTokens: usage.TotalTokens, ReasoningTokens: usage.ReasoningTokens,
		CacheReadInputTokens:     usage.CacheReadInputTokens,
		CacheCreationInputTokens: usage.CacheCreationInputTokens,
		DurationMS:               max(duration.Milliseconds(), 1),
		FirstTokenMS:             firstTokenMS,
	}
}

func estimateChatInputTokens(values ...string) int {
	ascii, nonASCII := 0, 0
	for _, value := range values {
		for _, character := range value {
			if character <= 0x7f {
				ascii++
			} else {
				nonASCII++
			}
		}
	}
	return (ascii+3)/4 + nonASCII + len(values)*4
}

func billingInputTokenUpperBound(contextWindow, maxOutputTokens int, values ...string) int {
	bytes := 1024
	for _, value := range values {
		bytes += len([]byte(value))
	}
	maximumInput := max(contextWindow-maxOutputTokens, 0)
	return min(bytes, maximumInput)
}

func providerErrorCode(err error) string {
	var upstream *llmprovider.UpstreamError
	if errors.As(err, &upstream) {
		if upstream.Code != "" {
			return upstream.Code
		}
		return fmt.Sprintf("upstream_%d", upstream.StatusCode)
	}
	if errors.Is(err, context.Canceled) {
		return "canceled"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "upstream_timeout"
	}
	return "provider_error"
}

func usageFromProviderError(err error) llmprovider.Usage {
	var upstream *llmprovider.UpstreamError
	if errors.As(err, &upstream) {
		return upstream.Usage
	}
	return llmprovider.Usage{}
}

func (a *API) writeProviderError(c *gin.Context, err error) {
	var upstream *llmprovider.UpstreamError
	if errors.As(err, &upstream) {
		a.logger.Warn("provider request failed", "provider", upstream.Provider,
			"status", upstream.StatusCode, "code", upstream.Code,
			"upstream_request_id", upstream.RequestID, "request_id", requestID(c))
		if upstream.StatusCode == http.StatusTooManyRequests {
			setRetryAfter(c, upstream.RetryAfter)
			writeError(c, http.StatusTooManyRequests, "provider_rate_limited", "The model provider is rate limited. Try again later.")
			return
		}
		if upstream.StatusCode == http.StatusBadRequest || upstream.StatusCode == http.StatusRequestEntityTooLarge || upstream.StatusCode == http.StatusUnprocessableEntity {
			writeError(c, http.StatusBadRequest, "provider_rejected_request", "The model provider rejected the request parameters.")
			return
		}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		writeError(c, http.StatusGatewayTimeout, "provider_timeout", "The model provider timed out.")
		return
	}
	a.logger.Warn("provider request failed", "error", err, "request_id", requestID(c))
	writeError(c, http.StatusBadGateway, "provider_error", "The model provider request failed.")
}

func retryAfterFromError(err error) string {
	var upstream *llmprovider.UpstreamError
	if errors.As(err, &upstream) {
		return normalizeRetryAfter(upstream.RetryAfter)
	}
	return ""
}

func setRetryAfter(c *gin.Context, raw string) {
	if value := normalizeRetryAfter(raw); value != "" {
		c.Header("Retry-After", value)
	}
}

func setRetryAfterDuration(c *gin.Context, duration time.Duration) {
	seconds := max(int64((duration+time.Second-1)/time.Second), 1)
	c.Header("Retry-After", strconv.FormatInt(seconds, 10))
}

func normalizeRetryAfter(raw string) string {
	raw = strings.TrimSpace(raw)
	if len(raw) == 0 || len(raw) > 128 {
		return ""
	}
	if seconds, err := strconv.ParseInt(raw, 10, 64); err == nil {
		if seconds >= 0 && seconds <= 86400 {
			return strconv.FormatInt(seconds, 10)
		}
		return ""
	}
	if date, err := http.ParseTime(raw); err == nil {
		return date.UTC().Format(http.TimeFormat)
	}
	return ""
}

func (a *API) finalizeChatBilling(
	reservationID string,
	model domain.Model,
	requestID string,
	characterID string,
	characterName string,
	duration time.Duration,
	firstTokenMS *int64,
	usage llmprovider.Usage,
	errorCode string,
) (domain.BillingSettlement, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	usageLog := domain.UsageLog{
		ModelID: model.ID, Provider: model.Provider,
		CharacterID: characterID, CharacterName: characterName,
		UpstreamModel: model.ExternalID, RequestID: requestID,
		InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens,
		ReasoningTokens:          usage.ReasoningTokens,
		CacheReadInputTokens:     usage.CacheReadInputTokens,
		CacheCreationInputTokens: usage.CacheCreationInputTokens,
		DurationMS:               max(duration.Milliseconds(), 1), FirstTokenMS: firstTokenMS, ErrorCode: errorCode,
	}
	cost := domain.CalculateUsageCost(model.Provider, model.Pricing, usageLog)
	return a.repo.FinalizeBilling(ctx, reservationID, usageLog, cost)
}
