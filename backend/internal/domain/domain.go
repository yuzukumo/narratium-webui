package domain

import (
	"encoding/json"
	"time"
)

const (
	RoleAdmin = "admin"
	RoleUser  = "user"

	StatusActive   = "active"
	StatusDisabled = "disabled"

	ProviderAPIFormatResponses       = "responses"
	ProviderAPIFormatChatCompletions = "chat_completions"
	ProviderAPIFormatMessages        = "messages"
	ProviderAPIFormatGenerateContent = "generate_content"
)

type User struct {
	ID                       string    `json:"id"`
	Name                     string    `json:"name"`
	Email                    string    `json:"email"`
	PasswordHash             string    `json:"-"`
	Role                     string    `json:"role"`
	Status                   string    `json:"status"`
	TokenVersion             int64     `json:"-"`
	BalanceMicrousd          int64     `json:"balance_microusd,string"`
	ReservedMicrousd         int64     `json:"reserved_microusd,string"`
	AvailableBalanceMicrousd int64     `json:"available_balance_microusd,string"`
	CreatedAt                time.Time `json:"created_at"`
	UpdatedAt                time.Time `json:"updated_at"`
}

type ProviderConfig struct {
	ID                    string    `json:"id"`
	Name                  string    `json:"name"`
	Provider              string    `json:"provider"`
	APIFormat             string    `json:"api_format"`
	PromptCacheKeyEnabled bool      `json:"prompt_cache_key_enabled"`
	BaseURL               string    `json:"base_url"`
	Models                []string  `json:"models"`
	APIKeyCiphertext      string    `json:"-"`
	HasAPIKey             bool      `json:"has_api_key"`
	Enabled               bool      `json:"enabled"`
	CreatedAt             time.Time `json:"created_at"`
	UpdatedAt             time.Time `json:"updated_at"`
}

type Model struct {
	ID               string          `json:"id"`
	ProviderConfigID string          `json:"provider_config_id"`
	Provider         string          `json:"provider"`
	ProviderName     string          `json:"provider_name"`
	ExternalID       string          `json:"external_id"`
	Capabilities     json.RawMessage `json:"capabilities"`
	Pricing          ModelPricing    `json:"pricing"`
	CreatedAt        time.Time       `json:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
}

type UserDocument struct {
	Namespace string          `json:"namespace"`
	Value     json.RawMessage `json:"value"`
	Revision  int64           `json:"revision"`
	UpdatedAt time.Time       `json:"updated_at"`
}

type UserBlob struct {
	Key         string    `json:"key"`
	ContentType string    `json:"content_type"`
	Data        []byte    `json:"-"`
	Size        int64     `json:"size"`
	Revision    int64     `json:"revision"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type UsageLog struct {
	ID                       string    `json:"id"`
	UserID                   string    `json:"-"`
	ModelID                  string    `json:"model_id,omitempty"`
	CharacterID              string    `json:"character_id,omitempty"`
	CharacterName            string    `json:"character_name,omitempty"`
	Provider                 string    `json:"provider"`
	UpstreamModel            string    `json:"model"`
	RequestID                string    `json:"request_id"`
	InputTokens              int64     `json:"input_tokens"`
	OutputTokens             int64     `json:"output_tokens"`
	ReasoningTokens          int64     `json:"reasoning_tokens"`
	CacheReadInputTokens     int64     `json:"cache_read_input_tokens"`
	CacheCreationInputTokens int64     `json:"cache_creation_input_tokens"`
	DurationMS               int64     `json:"duration_ms"`
	FirstTokenMS             *int64    `json:"first_token_ms,omitempty"`
	ErrorCode                string    `json:"error_code,omitempty"`
	BillingReservationID     string    `json:"-"`
	CostMicrousd             int64     `json:"cost_microusd,string"`
	ChargedMicrousd          int64     `json:"charged_microusd,string"`
	CreatedAt                time.Time `json:"created_at"`
}

type BootstrapState struct {
	Initialized              bool `json:"initialized"`
	RegistrationEnabled      bool `json:"registration_enabled"`
	EmailVerificationEnabled bool `json:"email_verification_enabled"`
}

type Page[T any] struct {
	Items []T `json:"items"`
	Total int `json:"total"`
}

var AllowedDocumentNamespaces = map[string]bool{
	"characters_record":   true,
	"character_dialogues": true,
	"world_book":          true,
	"regex_scripts":       true,
	"preset_data":         true,
	"preferences":         true,
}
