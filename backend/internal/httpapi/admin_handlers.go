package httpapi

import (
	"errors"
	"net/http"
	"net/mail"
	"net/url"
	"strconv"
	"strings"
	"unicode"

	"github.com/gin-gonic/gin"
	"github.com/yuzukumo/narratium-webui/backend/internal/domain"
	"github.com/yuzukumo/narratium-webui/backend/internal/store"
	"golang.org/x/crypto/bcrypt"
)

func (a *API) listUsers(c *gin.Context) {
	limit, offset := parsePagination(c)
	result, err := a.repo.ListUsers(c.Request.Context(), limit, offset)
	if err != nil {
		a.internalError(c, "list users", err)
		return
	}
	result.Items = jsonArray(result.Items)
	c.JSON(http.StatusOK, result)
}

type updateUserRequest struct {
	Name   *string `json:"name"`
	Email  *string `json:"email"`
	Role   *string `json:"role"`
	Status *string `json:"status"`
}

func (a *API) updateUser(c *gin.Context) {
	current, err := a.repo.UserByID(c.Request.Context(), c.Param("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(c, http.StatusNotFound, "user_not_found", "User not found.")
		return
	}
	if err != nil {
		a.internalError(c, "load user", err)
		return
	}
	var request updateUserRequest
	if err := decodeJSON(c, &request); err != nil {
		writeDecodeError(c, err, "Invalid user update.")
		return
	}
	if request.Name == nil && request.Email == nil && request.Role == nil && request.Status == nil {
		writeError(c, http.StatusBadRequest, "invalid_request", "At least one user field is required.")
		return
	}
	if request.Name != nil {
		current.Name = strings.TrimSpace(*request.Name)
		if err := validateName(current.Name); err != nil {
			writeError(c, http.StatusBadRequest, "invalid_name", err.Error())
			return
		}
	}
	if request.Email != nil {
		current.Email = strings.TrimSpace(*request.Email)
		if err := validateEmail(current.Email); err != nil {
			writeError(c, http.StatusBadRequest, "invalid_email", err.Error())
			return
		}
	}
	if request.Role != nil {
		current.Role = strings.TrimSpace(*request.Role)
	}
	if request.Status != nil {
		current.Status = strings.TrimSpace(*request.Status)
	}
	if current.Role != domain.RoleAdmin && current.Role != domain.RoleUser {
		writeError(c, http.StatusBadRequest, "invalid_role", "Role must be admin or user.")
		return
	}
	if current.Status != domain.StatusActive && current.Status != domain.StatusDisabled {
		writeError(c, http.StatusBadRequest, "invalid_status", "Status must be active or disabled.")
		return
	}
	user, err := a.repo.UpdateUser(
		c.Request.Context(), current.ID, current.Name, current.Email, current.Role, current.Status,
	)
	if errors.Is(err, store.ErrNotFound) {
		writeError(c, http.StatusNotFound, "user_not_found", "User not found.")
		return
	}
	if errors.Is(err, store.ErrLastAdmin) {
		writeError(c, http.StatusConflict, "last_admin", err.Error())
		return
	}
	if errors.Is(err, store.ErrConflict) {
		writeError(c, http.StatusConflict, "user_conflict", "That name or email address is already in use.")
		return
	}
	if err != nil {
		a.internalError(c, "update user", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": user})
}

type updateUserPasswordRequest struct {
	Password string `json:"password"`
}

func (a *API) updateUserPassword(c *gin.Context) {
	var request updateUserPasswordRequest
	if err := decodeJSON(c, &request); err != nil {
		writeDecodeError(c, err, "A new password is required.")
		return
	}
	if err := validatePassword(request.Password); err != nil {
		writeError(c, http.StatusBadRequest, "invalid_password", err.Error())
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(request.Password), 12)
	if err != nil {
		a.internalError(c, "hash replacement password", err)
		return
	}
	user, err := a.repo.UpdateUserPassword(c.Request.Context(), c.Param("id"), string(hash))
	if errors.Is(err, store.ErrNotFound) {
		writeError(c, http.StatusNotFound, "user_not_found", "User not found.")
		return
	}
	if err != nil {
		a.internalError(c, "update user password", err)
		return
	}
	a.logger.Info("user password reset",
		"action", "user.password_reset", "actor_user_id", currentUser(c).ID,
		"target_user_id", user.ID, "request_id", requestID(c))
	c.JSON(http.StatusOK, gin.H{"user": user})
}

type balanceAdjustmentRequest struct {
	Mode           string `json:"mode"`
	AmountMicrousd int64  `json:"amount_microusd,string"`
	Note           string `json:"note"`
}

func (a *API) adjustUserBalance(c *gin.Context) {
	var request balanceAdjustmentRequest
	if err := decodeJSON(c, &request); err != nil {
		writeDecodeError(c, err, "A quota adjustment request is required.")
		return
	}
	request.Note = strings.TrimSpace(request.Note)
	if len(request.Note) > 500 {
		writeError(c, http.StatusBadRequest, "invalid_note", "The adjustment note cannot exceed 500 characters.")
		return
	}
	mode := strings.TrimSpace(request.Mode)
	amount := request.AmountMicrousd
	if mode != domain.BalanceAdjustmentAdd &&
		mode != domain.BalanceAdjustmentSubtract &&
		mode != domain.BalanceAdjustmentOverride {
		writeError(c, http.StatusBadRequest, "invalid_quota_adjustment", "Select add, subtract, or override.")
		return
	}
	if amount < 0 || (mode != domain.BalanceAdjustmentOverride && amount == 0) {
		writeError(c, http.StatusBadRequest, "invalid_quota_adjustment", "Enter a non-negative amount; increases and decreases must be greater than zero.")
		return
	}
	user, entry, err := a.repo.AdjustUserQuota(
		c.Request.Context(), c.Param("id"), currentUser(c).ID, mode, amount, request.Note,
	)
	if errors.Is(err, store.ErrNotFound) {
		writeError(c, http.StatusNotFound, "user_not_found", "User not found.")
		return
	}
	if errors.Is(err, store.ErrInsufficientBalance) {
		writeError(c, http.StatusConflict, "insufficient_available_quota", "The quota cannot be reduced below the amount reserved by active requests.")
		return
	}
	if errors.Is(err, store.ErrConflict) {
		writeError(c, http.StatusConflict, "quota_adjustment_conflict", "The quota adjustment could not be applied.")
		return
	}
	if err != nil {
		a.internalError(c, "adjust user balance", err)
		return
	}
	a.logger.Info("user quota adjusted",
		"action", "user.quota_adjust", "actor_user_id", currentUser(c).ID,
		"target_user_id", user.ID, "mode", mode, "amount_microusd", amount,
		"request_id", requestID(c))
	c.JSON(http.StatusCreated, gin.H{"user": user, "entry": entry})
}

func (a *API) listUserBalanceLedger(c *gin.Context) {
	if _, err := a.repo.UserByID(c.Request.Context(), c.Param("id")); errors.Is(err, store.ErrNotFound) {
		writeError(c, http.StatusNotFound, "user_not_found", "User not found.")
		return
	} else if err != nil {
		a.internalError(c, "load ledger user", err)
		return
	}
	limit, offset := parsePagination(c)
	result, err := a.repo.ListBalanceLedger(c.Request.Context(), c.Param("id"), limit, offset)
	if err != nil {
		a.internalError(c, "list user balance ledger", err)
		return
	}
	result.Items = jsonArray(result.Items)
	c.JSON(http.StatusOK, result)
}

func (a *API) getBalance(c *gin.Context) {
	user, err := a.repo.UserByID(c.Request.Context(), currentUser(c).ID)
	if err != nil {
		a.internalError(c, "load user balance", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"balance_microusd":           strconv.FormatInt(user.BalanceMicrousd, 10),
		"reserved_microusd":          strconv.FormatInt(user.ReservedMicrousd, 10),
		"available_balance_microusd": strconv.FormatInt(user.AvailableBalanceMicrousd, 10),
	})
}

func validateEmail(value string) error {
	if value == "" {
		return errors.New("Email address is required.")
	}
	if len(value) > 254 {
		return errors.New("Email address cannot exceed 254 characters.")
	}
	parsed, err := mail.ParseAddress(value)
	if err != nil || !strings.EqualFold(parsed.Address, value) {
		return errors.New("Email address is invalid.")
	}
	return nil
}

func (a *API) getAdminSettings(c *gin.Context) {
	enabled, err := a.repo.RegistrationEnabled(c.Request.Context())
	if err != nil {
		a.internalError(c, "load settings", err)
		return
	}
	verificationEnabled, err := a.repo.EmailVerificationEnabled(c.Request.Context())
	if err != nil {
		a.internalError(c, "load email verification settings", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"registration_enabled":       enabled,
		"email_verification_enabled": verificationEnabled,
	})
}

type updateSettingsRequest struct {
	RegistrationEnabled      *bool `json:"registration_enabled"`
	EmailVerificationEnabled *bool `json:"email_verification_enabled"`
}

func (a *API) updateAdminSettings(c *gin.Context) {
	var request updateSettingsRequest
	if err := decodeJSON(c, &request); err != nil {
		writeDecodeError(c, err, "A settings value is required.")
		return
	}
	if request.RegistrationEnabled == nil && request.EmailVerificationEnabled == nil {
		writeError(c, http.StatusBadRequest, "invalid_request", "A settings value is required.")
		return
	}
	if request.RegistrationEnabled != nil {
		if err := a.repo.SetRegistrationEnabled(c.Request.Context(), *request.RegistrationEnabled); err != nil {
			a.internalError(c, "update registration settings", err)
			return
		}
	}
	if request.EmailVerificationEnabled != nil {
		if *request.EmailVerificationEnabled && !a.mailer.Configured() {
			writeError(c, http.StatusServiceUnavailable, "email_delivery_unavailable", "Configure SMTP email delivery before enabling email verification.")
			return
		}
		if err := a.repo.SetEmailVerificationEnabled(c.Request.Context(), *request.EmailVerificationEnabled); err != nil {
			a.internalError(c, "update email verification settings", err)
			return
		}
	}
	registrationEnabled, err := a.repo.RegistrationEnabled(c.Request.Context())
	if err != nil {
		a.internalError(c, "reload registration settings", err)
		return
	}
	verificationEnabled, err := a.repo.EmailVerificationEnabled(c.Request.Context())
	if err != nil {
		a.internalError(c, "reload email verification settings", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"registration_enabled":       registrationEnabled,
		"email_verification_enabled": verificationEnabled,
	})
}

func (a *API) listProviders(c *gin.Context) {
	items, err := a.repo.ListProviders(c.Request.Context())
	if err != nil {
		a.internalError(c, "list providers", err)
		return
	}
	for index := range items {
		sanitizeProvider(&items[index])
	}
	c.JSON(http.StatusOK, gin.H{"items": jsonArray(items)})
}

type saveProviderRequest struct {
	Name                  *string   `json:"name"`
	Provider              *string   `json:"provider"`
	APIFormat             *string   `json:"api_format"`
	PromptCacheKeyEnabled *bool     `json:"prompt_cache_key_enabled"`
	BaseURL               *string   `json:"base_url"`
	Models                *[]string `json:"models"`
	APIKey                *string   `json:"api_key"`
	ClearAPIKey           bool      `json:"clear_api_key"`
	Enabled               *bool     `json:"enabled"`
}

func (a *API) createProvider(c *gin.Context) {
	var request saveProviderRequest
	if err := decodeJSON(c, &request); err != nil {
		writeDecodeError(c, err, "Invalid provider configuration.")
		return
	}
	if request.Name == nil || request.Provider == nil || request.BaseURL == nil || request.Models == nil {
		writeError(c, http.StatusBadRequest, "invalid_request", "name, provider, base_url, and models are required.")
		return
	}
	if request.ClearAPIKey {
		writeError(c, http.StatusBadRequest, "invalid_request", "clear_api_key is only valid when updating a provider.")
		return
	}
	models, err := normalizeProviderModels(*request.Models)
	if err != nil {
		writeError(c, http.StatusBadRequest, "invalid_models", err.Error())
		return
	}
	if request.APIKey == nil || strings.TrimSpace(*request.APIKey) == "" {
		writeError(c, http.StatusBadRequest, "invalid_request", "api_key is required when creating a provider.")
		return
	}
	item := domain.ProviderConfig{
		Name: strings.TrimSpace(*request.Name), Provider: strings.TrimSpace(*request.Provider),
		BaseURL: normalizeProviderBaseURL(*request.BaseURL), Models: models, Enabled: true,
	}
	item.APIFormat = defaultProviderAPIFormat(item.Provider)
	if request.APIFormat != nil {
		item.APIFormat = strings.TrimSpace(*request.APIFormat)
	}
	item.PromptCacheKeyEnabled = defaultPromptCacheKeyEnabled(item.Provider, item.APIFormat)
	if request.PromptCacheKeyEnabled != nil {
		item.PromptCacheKeyEnabled = *request.PromptCacheKeyEnabled
	}
	if request.Enabled != nil {
		item.Enabled = *request.Enabled
	}
	if request.APIKey != nil && strings.TrimSpace(*request.APIKey) != "" {
		ciphertext, err := a.cryptor.Encrypt(strings.TrimSpace(*request.APIKey))
		if err != nil {
			a.internalError(c, "encrypt provider key", err)
			return
		}
		item.APIKeyCiphertext = ciphertext
	}
	if err := validateProvider(item, a.cfg.AllowInsecureProviderHTTP); err != nil {
		writeError(c, http.StatusBadRequest, "invalid_provider", err.Error())
		return
	}
	saved, err := a.repo.CreateProvider(c.Request.Context(), item)
	if errors.Is(err, store.ErrConflict) {
		writeError(c, http.StatusConflict, "provider_conflict", "A provider with this ID already exists.")
		return
	}
	if err != nil {
		a.internalError(c, "create provider", err)
		return
	}
	a.recordProviderAudit(c, "provider.create", saved, "api_key_changed", item.APIKeyCiphertext != "")
	if a.onProviderModelsChanged != nil {
		a.onProviderModelsChanged()
	}
	sanitizeProvider(&saved)
	c.JSON(http.StatusCreated, gin.H{"provider": saved})
}

func (a *API) updateProvider(c *gin.Context) {
	item, err := a.repo.ProviderByID(c.Request.Context(), c.Param("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(c, http.StatusNotFound, "provider_not_found", "Provider not found.")
		return
	}
	if err != nil {
		a.internalError(c, "load provider", err)
		return
	}
	original := item
	var request saveProviderRequest
	if err := decodeJSON(c, &request); err != nil {
		writeDecodeError(c, err, "Invalid provider configuration.")
		return
	}
	if request.ClearAPIKey && request.APIKey != nil && strings.TrimSpace(*request.APIKey) != "" {
		writeError(c, http.StatusBadRequest, "invalid_request", "api_key and clear_api_key cannot be used together.")
		return
	}
	if request.Name != nil {
		item.Name = strings.TrimSpace(*request.Name)
	}
	providerChanged := false
	if request.Provider != nil {
		nextProvider := strings.TrimSpace(*request.Provider)
		providerChanged = nextProvider != item.Provider
		item.Provider = nextProvider
	}
	apiFormatChanged := false
	if request.APIFormat != nil {
		nextAPIFormat := strings.TrimSpace(*request.APIFormat)
		apiFormatChanged = nextAPIFormat != item.APIFormat
		item.APIFormat = nextAPIFormat
	} else if providerChanged {
		item.APIFormat = defaultProviderAPIFormat(item.Provider)
		apiFormatChanged = true
	}
	if request.PromptCacheKeyEnabled != nil {
		item.PromptCacheKeyEnabled = *request.PromptCacheKeyEnabled
	} else if apiFormatChanged || providerChanged {
		item.PromptCacheKeyEnabled = defaultPromptCacheKeyEnabled(item.Provider, item.APIFormat)
	}
	if request.BaseURL != nil {
		item.BaseURL = normalizeProviderBaseURL(*request.BaseURL)
	} else if providerChanged && item.BaseURL == defaultProviderBaseURL(original.Provider) {
		item.BaseURL = defaultProviderBaseURL(item.Provider)
	}
	if request.Models != nil {
		item.Models, err = normalizeProviderModels(*request.Models)
		if err != nil {
			writeError(c, http.StatusBadRequest, "invalid_models", err.Error())
			return
		}
	}
	if request.Enabled != nil {
		item.Enabled = *request.Enabled
	}
	if request.ClearAPIKey {
		item.APIKeyCiphertext = ""
	} else if request.APIKey != nil && strings.TrimSpace(*request.APIKey) != "" {
		item.APIKeyCiphertext, err = a.cryptor.Encrypt(strings.TrimSpace(*request.APIKey))
		if err != nil {
			a.internalError(c, "encrypt provider key", err)
			return
		}
	}
	if err := validateProvider(item, a.cfg.AllowInsecureProviderHTTP); err != nil {
		writeError(c, http.StatusBadRequest, "invalid_provider", err.Error())
		return
	}
	saved, err := a.repo.UpdateProvider(c.Request.Context(), item)
	if errors.Is(err, store.ErrNotFound) {
		writeError(c, http.StatusNotFound, "provider_not_found", "Provider no longer exists.")
		return
	}
	if err != nil {
		a.internalError(c, "update provider", err)
		return
	}
	keyAction := "unchanged"
	if request.ClearAPIKey {
		keyAction = "cleared"
	} else if request.APIKey != nil && strings.TrimSpace(*request.APIKey) != "" {
		keyAction = "replaced"
	}
	a.recordProviderAudit(c, "provider.update", saved,
		"previous_provider", original.Provider,
		"provider_changed", providerChanged,
		"api_key_action", keyAction,
	)
	if a.onProviderModelsChanged != nil {
		a.onProviderModelsChanged()
	}
	sanitizeProvider(&saved)
	c.JSON(http.StatusOK, gin.H{"provider": saved})
}

func (a *API) deleteProvider(c *gin.Context) {
	deleted, err := a.repo.DeleteProvider(c.Request.Context(), c.Param("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(c, http.StatusNotFound, "provider_not_found", "Provider not found.")
		return
	}
	if err != nil {
		a.internalError(c, "delete provider", err)
		return
	}
	a.recordProviderAudit(c, "provider.delete", deleted)
	c.Status(http.StatusNoContent)
}

func (a *API) listEnabledModels(c *gin.Context) {
	items, err := a.repo.ListModels(c.Request.Context(), true)
	if err != nil {
		a.internalError(c, "list models", err)
		return
	}
	configured := make([]domain.Model, 0, len(items))
	for _, item := range items {
		capabilities, parseErr := domain.ParseModelCapabilities(item.Capabilities, item.Provider)
		if parseErr == nil && capabilities.Validate(item.Provider, a.cfg.MaxOutputTokens) == nil && item.Pricing.Validate() == nil {
			configured = append(configured, item)
		}
	}
	c.JSON(http.StatusOK, gin.H{"items": jsonArray(configured)})
}

func (a *API) listModels(c *gin.Context) {
	items, err := a.repo.ListModels(c.Request.Context(), true)
	if err != nil {
		a.internalError(c, "list admin models", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": jsonArray(items)})
}

type updateModelRequest struct {
	Capabilities *domain.ModelCapabilities `json:"capabilities"`
	Pricing      *domain.ModelPricing      `json:"pricing"`
}

func (a *API) updateModel(c *gin.Context) {
	item, err := a.repo.ModelByID(c.Request.Context(), c.Param("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(c, http.StatusNotFound, "model_not_found", "Model not found.")
		return
	}
	if err != nil {
		a.internalError(c, "load admin model", err)
		return
	}

	var request updateModelRequest
	if err := decodeJSON(c, &request); err != nil {
		writeDecodeError(c, err, "Invalid model configuration.")
		return
	}
	if request.Capabilities == nil && request.Pricing == nil {
		writeError(c, http.StatusBadRequest, "invalid_request", "capabilities or pricing is required.")
		return
	}
	if request.Pricing != nil {
		if err := request.Pricing.Validate(); err != nil {
			writeError(c, http.StatusBadRequest, "invalid_model_pricing", err.Error())
			return
		}
		item.Pricing = *request.Pricing
	}
	if request.Capabilities != nil {
		capabilities := *request.Capabilities
		if capabilities.SchemaVersion == 0 {
			capabilities.SchemaVersion = domain.ModelCapabilitiesSchemaVersion
		}
		if err := capabilities.Validate(item.Provider, a.cfg.MaxOutputTokens); err != nil {
			writeError(c, http.StatusBadRequest, "invalid_model_capabilities", err.Error())
			return
		}
		item.Capabilities = capabilities.JSON()
	}

	saved, err := a.repo.UpdateModel(c.Request.Context(), item)
	if errors.Is(err, store.ErrNotFound) {
		writeError(c, http.StatusNotFound, "model_not_found", "Model no longer exists.")
		return
	}
	if err != nil {
		a.internalError(c, "update admin model", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"model": saved})
}

func sanitizeProvider(item *domain.ProviderConfig) {
	item.HasAPIKey = item.APIKeyCiphertext != ""
	item.APIKeyCiphertext = ""
}

func validateProvider(item domain.ProviderConfig, allowInsecureHTTP bool) error {
	if item.Name == "" || len(item.Name) > 100 {
		return errors.New("Provider name must contain 1 to 100 characters.")
	}
	if item.Provider != "openai" && item.Provider != "anthropic" && item.Provider != "gemini" {
		return errors.New("Provider must be openai, anthropic, or gemini.")
	}
	switch item.Provider {
	case "openai":
		if item.APIFormat != domain.ProviderAPIFormatResponses && item.APIFormat != domain.ProviderAPIFormatChatCompletions {
			return errors.New("OpenAI API format must be responses or chat_completions.")
		}
	case "anthropic":
		if item.APIFormat != domain.ProviderAPIFormatMessages {
			return errors.New("Anthropic API format must be messages.")
		}
		if item.PromptCacheKeyEnabled {
			return errors.New("prompt_cache_key is only available for OpenAI providers.")
		}
	case "gemini":
		if item.APIFormat != domain.ProviderAPIFormatGenerateContent {
			return errors.New("Gemini API format must be generate_content.")
		}
		if item.PromptCacheKeyEnabled {
			return errors.New("prompt_cache_key is only available for OpenAI providers.")
		}
	}
	parsed, err := url.Parse(item.BaseURL)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return errors.New("Base URL must be an absolute URL without credentials, query, or fragment.")
	}
	if parsed.Scheme != "https" && !(allowInsecureHTTP && parsed.Scheme == "http") {
		return errors.New("Base URL must use HTTPS. Insecure HTTP requires the explicit development override.")
	}
	return nil
}

func defaultProviderAPIFormat(provider string) string {
	switch provider {
	case "anthropic":
		return domain.ProviderAPIFormatMessages
	case "gemini":
		return domain.ProviderAPIFormatGenerateContent
	default:
		return domain.ProviderAPIFormatResponses
	}
}

func defaultPromptCacheKeyEnabled(provider, apiFormat string) bool {
	return provider == "openai" && apiFormat == domain.ProviderAPIFormatResponses
}

func defaultProviderBaseURL(provider string) string {
	switch provider {
	case "anthropic":
		return "https://api.anthropic.com"
	case "gemini":
		return "https://generativelanguage.googleapis.com"
	default:
		return "https://api.openai.com"
	}
}

func normalizeProviderBaseURL(value string) string {
	return strings.TrimRight(strings.TrimSpace(value), "/")
}

func normalizeProviderModels(values []string) ([]string, error) {
	if len(values) == 0 {
		return nil, errors.New("At least one model ID is required.")
	}
	if len(values) > 1000 {
		return nil, errors.New("A provider cannot contain more than 1000 model IDs.")
	}

	models := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		modelID := strings.TrimSpace(value)
		if modelID == "" {
			return nil, errors.New("Model IDs cannot be empty.")
		}
		if len(modelID) > 255 {
			return nil, errors.New("Model IDs cannot exceed 255 characters.")
		}
		if strings.IndexFunc(modelID, unicode.IsControl) >= 0 {
			return nil, errors.New("Model IDs cannot contain control characters.")
		}
		if _, exists := seen[modelID]; exists {
			continue
		}
		seen[modelID] = struct{}{}
		models = append(models, modelID)
	}
	return models, nil
}

func (a *API) recordProviderAudit(c *gin.Context, action string, item domain.ProviderConfig, attributes ...any) {
	fields := []any{
		"action", action,
		"actor_user_id", currentUser(c).ID,
		"provider_id", item.ID,
		"provider", item.Provider,
		"request_id", requestID(c),
	}
	fields = append(fields, attributes...)
	a.logger.Info("provider configuration changed", fields...)
}

func (a *API) internalError(c *gin.Context, operation string, err error) {
	a.logger.Error(operation, "error", err, "request_id", requestID(c))
	writeError(c, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
}
