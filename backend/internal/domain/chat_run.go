package domain

import "time"

const (
	ChatRunStatusQueued    = "queued"
	ChatRunStatusRunning   = "running"
	ChatRunStatusCompleted = "completed"
	ChatRunStatusFailed    = "failed"
	ChatRunStatusCanceled  = "canceled"
)

type ChatRunUsage struct {
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

type ChatRun struct {
	ID                   string            `json:"id"`
	UserID               string            `json:"user_id"`
	CharacterID          string            `json:"character_id"`
	CharacterName        string            `json:"character_name"`
	NodeID               string            `json:"node_id"`
	ParentNodeID         string            `json:"parent_node_id"`
	UserMessage          string            `json:"user_message"`
	ModelID              string            `json:"model_id"`
	ModelName            string            `json:"model_name"`
	Provider             string            `json:"provider"`
	RequestID            string            `json:"request_id"`
	BillingReservationID string            `json:"billing_reservation_id,omitempty"`
	Status               string            `json:"status"`
	ResponseText         string            `json:"response_text"`
	ProviderResponseID   string            `json:"provider_response_id,omitempty"`
	FinishReason         string            `json:"finish_reason,omitempty"`
	Usage                ChatRunUsage      `json:"usage"`
	Billing              BillingSettlement `json:"billing"`
	ErrorCode            string            `json:"error_code,omitempty"`
	ErrorMessage         string            `json:"error_message,omitempty"`
	CancelRequested      bool              `json:"cancel_requested"`
	Acknowledged         bool              `json:"acknowledged"`
	Revision             int64             `json:"revision"`
	CreatedAt            time.Time         `json:"created_at"`
	StartedAt            *time.Time        `json:"started_at,omitempty"`
	FinishedAt           *time.Time        `json:"finished_at,omitempty"`
	AcknowledgedAt       *time.Time        `json:"acknowledged_at,omitempty"`
	UpdatedAt            time.Time         `json:"updated_at"`
}

type ChatRunUpdate struct {
	Status             string
	ResponseText       string
	ProviderResponseID string
	FinishReason       string
	Usage              ChatRunUsage
	Billing            BillingSettlement
	ErrorCode          string
	ErrorMessage       string
}
