package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuzukumo/narratium-webui/backend/internal/domain"
	llmprovider "github.com/yuzukumo/narratium-webui/backend/internal/provider"
	"github.com/yuzukumo/narratium-webui/backend/internal/store"
)

type createChatRunRequest struct {
	chatRequest
	CharacterID   string `json:"character_id"`
	CharacterName string `json:"character_name"`
	NodeID        string `json:"node_id"`
	ParentNodeID  string `json:"parent_node_id"`
	UserMessage   string `json:"user_message"`
	ModelName     string `json:"model_name"`
}

type preparedChatRequest struct {
	adapter      llmprovider.Provider
	model        domain.Model
	request      llmprovider.Request
	capabilities domain.ModelCapabilities
}

type chatPreparationError struct {
	status  int
	code    string
	message string
}

func (e *chatPreparationError) Error() string { return e.message }

func (a *API) createChatRun(c *gin.Context) {
	var input createChatRunRequest
	if err := decodeJSON(c, &input); err != nil {
		writeDecodeError(c, err, "Invalid chat run request.")
		return
	}
	input.CharacterID = strings.TrimSpace(input.CharacterID)
	input.CharacterName = strings.TrimSpace(input.CharacterName)
	input.NodeID = strings.TrimSpace(input.NodeID)
	input.ParentNodeID = strings.TrimSpace(input.ParentNodeID)
	input.UserMessage = strings.TrimSpace(input.UserMessage)
	if input.ParentNodeID == "" {
		input.ParentNodeID = "root"
	}
	if input.ModelName == "" {
		input.ModelName = strings.TrimSpace(input.ModelID)
	}
	if input.CharacterID == "" || input.NodeID == "" || input.UserMessage == "" {
		writeError(c, http.StatusBadRequest, "invalid_chat_run_request", "character_id, node_id, and user_message are required.")
		return
	}
	if len(input.CharacterID) > 256 || len(input.CharacterName) > 256 || len(input.NodeID) > 256 || len(input.ParentNodeID) > 256 || len(input.UserMessage) > 1<<20 {
		writeError(c, http.StatusBadRequest, "invalid_chat_run_request", "The chat run metadata is too large.")
		return
	}
	if err := validateChatRequest(input.chatRequest, a.cfg.MaxOutputTokens); err != nil {
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

	prepared, prepErr := a.prepareChatRequest(c.Request.Context(), input.chatRequest)
	if prepErr != nil {
		release()
		writeError(c, prepErr.status, prepErr.code, prepErr.message)
		return
	}

	runID := uuid.NewString()
	startedAt := time.Now()
	reservationTTL := a.cfg.UpstreamTimeout + 2*time.Minute
	if reservationTTL < 3*time.Minute {
		reservationTTL = 7 * time.Minute
	}
	inputUpperBound := billingInputTokenUpperBound(
		prepared.capabilities.ContextWindow, input.MaxOutputTokens,
		input.System, input.Input,
	)
	// Once request validation has completed, generation setup belongs to the
	// server. A browser disconnect must not leave a committed run half-created
	// or cancel an accepted generation.
	setupCtx, cancelSetup := context.WithTimeout(a.backgroundCtx, 10*time.Second)
	defer cancelSetup()
	reservation, err := a.repo.ReserveBalance(setupCtx, domain.BillingReservation{
		ID: runID, UserID: user.ID, ModelID: prepared.model.ID, RequestID: runID,
		EstimatedCostMicrousd: domain.EstimateMaximumCost(
			prepared.model.Pricing, int64(inputUpperBound), int64(input.MaxOutputTokens),
		),
		ExpiresAt: startedAt.Add(reservationTTL),
	})
	if errors.Is(err, store.ErrInsufficientBalance) {
		release()
		writeError(c, http.StatusForbidden, "insufficient_user_quota", "Insufficient quota.")
		return
	}
	if errors.Is(err, store.ErrConflict) {
		release()
		writeError(c, http.StatusConflict, "billing_request_conflict", "A model request with this request ID already exists.")
		return
	}
	if err != nil {
		release()
		a.internalError(c, "reserve chat run balance", err)
		return
	}

	run := domain.ChatRun{
		ID:                   runID,
		UserID:               user.ID,
		CharacterID:          input.CharacterID,
		CharacterName:        input.CharacterName,
		NodeID:               input.NodeID,
		ParentNodeID:         input.ParentNodeID,
		UserMessage:          input.UserMessage,
		ModelID:              prepared.model.ID,
		ModelName:            input.ModelName,
		Provider:             prepared.model.Provider,
		RequestID:            runID,
		BillingReservationID: reservation.ID,
		Status:               domain.ChatRunStatusRunning,
	}
	if err := a.repo.CreateChatRun(setupCtx, run); err != nil {
		_ = a.repo.ReleaseBalanceReservation(context.Background(), reservation.ID)
		release()
		if errors.Is(err, store.ErrConflict) {
			writeError(c, http.StatusConflict, "chat_run_conflict", "A generation for this conversation is already running.")
			return
		}
		a.internalError(c, "create chat run", err)
		return
	}
	if err := a.repo.AttachChatRunReservation(setupCtx, run.ID, reservation.ID); err != nil {
		_ = a.repo.ReleaseBalanceReservation(context.Background(), reservation.ID)
		a.failChatRunSetup(run.ID, "billing_reservation_attach_failed", "The generation could not be initialized safely.")
		release()
		a.internalError(c, "attach chat run reservation", err)
		return
	}
	persistedRun, err := a.repo.ChatRunByID(setupCtx, user.ID, run.ID)
	if err != nil {
		_ = a.repo.ReleaseBalanceReservation(context.Background(), reservation.ID)
		a.failChatRunSetup(run.ID, "chat_run_reload_failed", "The generation could not be initialized safely.")
		release()
		a.internalError(c, "reload chat run", err)
		return
	}
	run = persistedRun

	workerCtx, cancel := context.WithCancel(a.backgroundCtx)
	a.registerChatRun(run.ID, cancel)
	go func() {
		defer release()
		defer a.unregisterChatRun(run.ID)
		a.executeChatRun(workerCtx, prepared, run)
	}()

	c.Header("X-Chat-Run-ID", run.ID)
	c.JSON(http.StatusAccepted, gin.H{"run": run})
}

func (a *API) failChatRunSetup(runID, code, message string) {
	_, err := a.repo.FinishChatRun(context.Background(), runID, domain.ChatRunUpdate{
		Status: domain.ChatRunStatusFailed, ErrorCode: code, ErrorMessage: message,
	})
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		a.logger.Error("persist failed chat run setup", "error", err, "run_id", runID)
	} else if err == nil {
		a.notifyChatRun(runID)
	}
}

func (a *API) prepareChatRequest(ctx context.Context, input chatRequest) (preparedChatRequest, *chatPreparationError) {
	prepared := preparedChatRequest{}
	model, err := a.repo.ModelByID(ctx, input.ModelID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return prepared, &chatPreparationError{http.StatusNotFound, "model_not_available", "The selected model is not available."}
		}
		return prepared, &chatPreparationError{http.StatusInternalServerError, "internal_error", "Unable to load the selected model."}
	}
	capabilities, err := domain.ParseModelCapabilities(model.Capabilities, model.Provider)
	if err != nil || capabilities.Validate(model.Provider, a.cfg.MaxOutputTokens) != nil {
		return prepared, &chatPreparationError{http.StatusConflict, "invalid_model_configuration", "The selected model capabilities are invalid."}
	}
	if err := model.Pricing.Validate(); err != nil {
		return prepared, &chatPreparationError{http.StatusConflict, "invalid_model_pricing", "The selected model pricing is invalid."}
	}
	outputLimit := capabilities.MaxOutputTokens
	if a.cfg.MaxOutputTokens > 0 {
		outputLimit = min(outputLimit, a.cfg.MaxOutputTokens)
	}
	if input.MaxOutputTokens > outputLimit {
		return prepared, &chatPreparationError{http.StatusBadRequest, "max_output_tokens_exceeded", fmt.Sprintf("max_output_tokens must not exceed %d for the selected model", outputLimit)}
	}
	if estimateChatInputTokens(input.System, input.Input)+input.MaxOutputTokens > capabilities.ContextWindow {
		return prepared, &chatPreparationError{http.StatusBadRequest, "context_window_exceeded", "The estimated prompt and requested output exceed the selected model context window."}
	}
	providerConfig, err := a.repo.ProviderByID(ctx, model.ProviderConfigID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return prepared, &chatPreparationError{http.StatusConflict, "provider_not_configured", "The selected model provider is not configured."}
		}
		return prepared, &chatPreparationError{http.StatusInternalServerError, "internal_error", "Unable to load the selected provider."}
	}
	if !providerConfig.Enabled || providerConfig.APIKeyCiphertext == "" {
		return prepared, &chatPreparationError{http.StatusConflict, "provider_not_configured", "The selected model provider is not configured."}
	}
	if err := validateProvider(providerConfig, a.cfg.AllowInsecureProviderHTTP); err != nil {
		return prepared, &chatPreparationError{http.StatusConflict, "invalid_provider_configuration", err.Error()}
	}
	apiKey, err := a.cryptor.Decrypt(providerConfig.APIKeyCiphertext)
	if err != nil {
		return prepared, &chatPreparationError{http.StatusInternalServerError, "internal_error", "Unable to decrypt the selected provider configuration."}
	}
	adapter, err := llmprovider.New(
		llmprovider.Kind(providerConfig.Provider), apiKey,
		llmprovider.WithBaseURL(providerConfig.BaseURL),
		llmprovider.WithDefaultModel(model.ExternalID),
		llmprovider.WithAPIFormat(providerConfig.APIFormat),
		llmprovider.WithPromptCacheKeyEnabled(providerConfig.PromptCacheKeyEnabled),
		llmprovider.WithHTTPClient(a.client),
	)
	if err != nil {
		return prepared, &chatPreparationError{http.StatusInternalServerError, "internal_error", "Unable to create the selected provider client."}
	}
	prepared.model = model
	prepared.capabilities = capabilities
	prepared.adapter = adapter
	prepared.request = llmprovider.Request{
		Model: model.ExternalID, System: input.System,
		StableSystemPrefix: input.StableSystemPrefix, Input: input.Input,
		MaxOutputTokens: input.MaxOutputTokens, Temperature: input.Temperature,
		Reasoning: &llmprovider.ReasoningConfig{Enabled: capabilities.Reasoning.Enabled, Effort: capabilities.Reasoning.Effort},
	}
	return prepared, nil
}

func (a *API) executeChatRun(ctx context.Context, prepared preparedChatRequest, run domain.ChatRun) {
	if a.cfg.UpstreamTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, a.cfg.UpstreamTimeout)
		defer cancel()
	}
	startedAt := time.Now()
	events, err := prepared.adapter.Stream(ctx, prepared.request)
	if err != nil {
		a.finishChatRun(run, prepared.model, startedAt, "", nil, usageFromProviderError(err), providerErrorCode(err), chatRunErrorMessage(err), ctx.Err())
		return
	}

	text := ""
	var usage llmprovider.Usage
	var responseID, finishReason string
	var firstTokenMS *int64
	lastPersisted := time.Time{}
	lastPersistedLength := 0
	terminal := false
	for event := range events {
		switch event.Type {
		case llmprovider.EventDelta:
			if event.Delta != "" {
				text += event.Delta
				if firstTokenMS == nil {
					value := max(time.Since(startedAt).Milliseconds(), 1)
					firstTokenMS = &value
				}
			}
			if len(text)-lastPersistedLength >= 512 || time.Since(lastPersisted) >= 500*time.Millisecond {
				if persistErr := a.repo.UpdateChatRunProgress(context.Background(), run.ID, text, firstTokenMS); persistErr != nil && !errors.Is(persistErr, store.ErrNotFound) {
					a.logger.Warn("persist chat run progress failed", "error", persistErr, "run_id", run.ID)
				} else if persistErr == nil {
					a.notifyChatRun(run.ID)
				}
				lastPersisted, lastPersistedLength = time.Now(), len(text)
			}
		case llmprovider.EventCompleted:
			terminal = true
			text = event.Text
			usage = event.Usage
			if event.Response != nil {
				responseID, finishReason = event.Response.ID, event.Response.FinishReason
			}
		case llmprovider.EventError:
			terminal = true
			usage = event.Usage
			a.finishChatRun(run, prepared.model, startedAt, text, firstTokenMS, usage, providerErrorCode(event.Err), chatRunErrorMessage(event.Err), ctx.Err())
			return
		}
	}
	if !terminal {
		a.finishChatRun(run, prepared.model, startedAt, text, firstTokenMS, usage, "stream_ended", "The model stream ended unexpectedly.", ctx.Err())
		return
	}
	a.finishChatRunWithResponse(run, prepared.model, startedAt, text, firstTokenMS, usage, responseID, finishReason, ctx.Err())
}

func (a *API) finishChatRun(
	run domain.ChatRun,
	model domain.Model,
	startedAt time.Time,
	text string,
	firstTokenMS *int64,
	usage llmprovider.Usage,
	errorCode, errorMessage string,
	ctxErr error,
) {
	status := domain.ChatRunStatusFailed
	if errors.Is(ctxErr, context.Canceled) && a.chatRunWasExplicitlyCanceled(run.ID) {
		status = domain.ChatRunStatusCanceled
		errorCode, errorMessage = "canceled", "Generation stopped."
	}
	a.finishChatRunWithStatus(run, model, startedAt, text, firstTokenMS, usage, "", "", status, errorCode, errorMessage)
}

func (a *API) finishChatRunWithResponse(run domain.ChatRun, model domain.Model, startedAt time.Time, text string, firstTokenMS *int64, usage llmprovider.Usage, responseID, finishReason string, ctxErr error) {
	status := domain.ChatRunStatusCompleted
	errorCode, errorMessage := "", ""
	if a.chatRunWasExplicitlyCanceled(run.ID) || errors.Is(ctxErr, context.Canceled) {
		status = domain.ChatRunStatusCanceled
		errorCode, errorMessage = "canceled", "Generation stopped."
	}
	a.finishChatRunWithStatus(run, model, startedAt, text, firstTokenMS, usage, responseID, finishReason, status, errorCode, errorMessage)
}

func (a *API) finishChatRunWithStatus(
	run domain.ChatRun,
	model domain.Model,
	startedAt time.Time,
	text string,
	firstTokenMS *int64,
	usage llmprovider.Usage,
	responseID, finishReason, status, errorCode, errorMessage string,
) {
	settlement, err := a.finalizeChatBilling(
		run.BillingReservationID, model, run.RequestID, run.CharacterID,
		run.CharacterName, time.Since(startedAt), firstTokenMS, usage, errorCode,
	)
	if err != nil {
		a.logger.Error("settle background chat run failed", "error", err, "run_id", run.ID)
		status, errorCode, errorMessage = domain.ChatRunStatusFailed, "billing_finalize_failed", "The response could not be billed safely."
	}
	usagePayload := domain.ChatRunUsage{
		CostMicrousd: settlement.CostMicrousd,
		InputTokens:  usage.InputTokens, OutputTokens: usage.OutputTokens,
		TotalTokens: usage.TotalTokens, ReasoningTokens: usage.ReasoningTokens,
		CacheReadInputTokens:     usage.CacheReadInputTokens,
		CacheCreationInputTokens: usage.CacheCreationInputTokens,
		DurationMS:               max(time.Since(startedAt).Milliseconds(), 1), FirstTokenMS: firstTokenMS,
	}
	_, updateErr := a.repo.FinishChatRun(context.Background(), run.ID, domain.ChatRunUpdate{
		Status: status, ResponseText: text, ProviderResponseID: responseID,
		FinishReason: finishReason, Usage: usagePayload, Billing: settlement,
		ErrorCode: errorCode, ErrorMessage: errorMessage,
	})
	if updateErr != nil && !errors.Is(updateErr, store.ErrNotFound) {
		a.logger.Error("persist background chat run result failed", "error", updateErr, "run_id", run.ID)
	} else if updateErr == nil {
		a.notifyChatRun(run.ID)
	}
}

func chatRunErrorMessage(err error) string {
	if errors.Is(err, context.Canceled) {
		return "Generation stopped."
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "The model provider timed out."
	}
	var upstream *llmprovider.UpstreamError
	if errors.As(err, &upstream) {
		switch {
		case upstream.StatusCode == http.StatusTooManyRequests:
			return "The model provider is rate limited. Try again later."
		case upstream.StatusCode >= 400 && upstream.StatusCode < 500:
			return "The model provider rejected the request parameters."
		}
	}
	return "The model provider request failed."
}

func (a *API) listChatRuns(c *gin.Context) {
	characterID := strings.TrimSpace(c.Query("character_id"))
	if characterID == "" {
		writeError(c, http.StatusBadRequest, "invalid_request", "character_id is required.")
		return
	}
	items, err := a.repo.ListPendingChatRuns(c.Request.Context(), currentUser(c).ID, characterID)
	if err != nil {
		a.internalError(c, "list chat runs", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": jsonArray(items)})
}

func (a *API) getChatRun(c *gin.Context) {
	run, err := a.repo.ChatRunByID(c.Request.Context(), currentUser(c).ID, c.Param("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(c, http.StatusNotFound, "chat_run_not_found", "Generation not found.")
		return
	}
	if err != nil {
		a.internalError(c, "load chat run", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"run": run})
}

func (a *API) chatRunEvents(c *gin.Context) {
	runID := c.Param("id")
	userID := currentUser(c).ID
	if _, err := a.repo.ChatRunByID(c.Request.Context(), userID, runID); errors.Is(err, store.ErrNotFound) {
		writeError(c, http.StatusNotFound, "chat_run_not_found", "Generation not found.")
		return
	} else if err != nil {
		a.internalError(c, "load chat run events", err)
		return
	}
	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-cache, no-transform")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	flusher, _ := c.Writer.(http.Flusher)
	lastRevision := int64(0)
	updates, unsubscribe := a.subscribeChatRun(runID)
	defer unsubscribe()
	heartbeat := time.NewTicker(15 * time.Second)
	poll := time.NewTicker(2 * time.Second)
	defer heartbeat.Stop()
	defer poll.Stop()
	for {
		run, err := a.repo.ChatRunByID(c.Request.Context(), userID, runID)
		if errors.Is(err, store.ErrNotFound) {
			_ = writeSSE(c, gin.H{"type": "error", "code": "chat_run_not_found", "message": "Generation not found."})
			return
		}
		if err != nil {
			return
		}
		if run.Revision != lastRevision {
			if err := writeSSE(c, gin.H{"type": "snapshot", "run": run}); err != nil {
				return
			}
			lastRevision = run.Revision
			if flusher != nil {
				flusher.Flush()
			}
		}
		if run.Status == domain.ChatRunStatusCompleted || run.Status == domain.ChatRunStatusFailed || run.Status == domain.ChatRunStatusCanceled {
			return
		}
		select {
		case <-c.Request.Context().Done():
			return
		case <-updates:
		case <-poll.C:
		case <-heartbeat.C:
			if _, err := fmt.Fprint(c.Writer, ": keep-alive\n\n"); err != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
	}
}

func (a *API) cancelChatRun(c *gin.Context) {
	run, err := a.repo.RequestChatRunCancel(c.Request.Context(), currentUser(c).ID, c.Param("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(c, http.StatusNotFound, "chat_run_not_found", "Generation not found.")
		return
	}
	if err != nil {
		a.internalError(c, "cancel chat run", err)
		return
	}
	if run.Status == domain.ChatRunStatusQueued || run.Status == domain.ChatRunStatusRunning {
		a.markChatRunExplicitlyCanceled(run.ID)
		a.cancelRegisteredChatRun(run.ID)
	}
	a.notifyChatRun(run.ID)
	c.JSON(http.StatusOK, gin.H{"run": run})
}

func (a *API) subscribeChatRun(id string) (<-chan struct{}, func()) {
	updates := make(chan struct{}, 1)
	a.runMu.Lock()
	if a.runSubscribers[id] == nil {
		a.runSubscribers[id] = make(map[chan struct{}]struct{})
	}
	a.runSubscribers[id][updates] = struct{}{}
	a.runMu.Unlock()

	return updates, func() {
		a.runMu.Lock()
		delete(a.runSubscribers[id], updates)
		if len(a.runSubscribers[id]) == 0 {
			delete(a.runSubscribers, id)
		}
		a.runMu.Unlock()
	}
}

func (a *API) notifyChatRun(id string) {
	a.runMu.Lock()
	defer a.runMu.Unlock()
	for subscriber := range a.runSubscribers[id] {
		select {
		case subscriber <- struct{}{}:
		default:
		}
	}
}

func (a *API) acknowledgeChatRun(c *gin.Context) {
	err := a.repo.AcknowledgeChatRun(c.Request.Context(), currentUser(c).ID, c.Param("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(c, http.StatusNotFound, "chat_run_not_found", "Generation not found.")
		return
	}
	if err != nil {
		a.internalError(c, "acknowledge chat run", err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (a *API) registerChatRun(id string, cancel context.CancelFunc) {
	a.runMu.Lock()
	defer a.runMu.Unlock()
	a.runCancels[id] = cancel
	delete(a.runExplicitCancels, id)
}

func (a *API) unregisterChatRun(id string) {
	a.runMu.Lock()
	defer a.runMu.Unlock()
	delete(a.runCancels, id)
	delete(a.runExplicitCancels, id)
}

func (a *API) cancelRegisteredChatRun(id string) {
	a.runMu.Lock()
	cancel := a.runCancels[id]
	a.runMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (a *API) markChatRunExplicitlyCanceled(id string) {
	a.runMu.Lock()
	defer a.runMu.Unlock()
	a.runExplicitCancels[id] = true
}

func (a *API) chatRunWasExplicitlyCanceled(id string) bool {
	a.runMu.Lock()
	defer a.runMu.Unlock()
	return a.runExplicitCancels[id]
}
