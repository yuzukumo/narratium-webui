package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/yuzukumo/narratium-webui/backend/internal/domain"
)

const chatRunSelect = `
	SELECT id, user_id, COALESCE(model_id::text, ''), character_id, character_name, node_id,
	       parent_node_id, user_message, model_name, provider, request_id,
	       COALESCE(billing_reservation_id::text, ''), status, response_text,
	       provider_response_id, finish_reason, input_tokens, output_tokens,
	       total_tokens, reasoning_tokens, cache_read_input_tokens,
	       cache_creation_input_tokens, duration_ms, first_token_ms,
	       cost_microusd, charged_microusd, balance_microusd, reserved_microusd,
	       available_balance_microusd, unbilled_microusd, error_code, error_message,
	       cancel_requested, acknowledged_at, revision, created_at, started_at,
	       finished_at, updated_at
	FROM chat_runs`

func (p *Postgres) CreateChatRun(ctx context.Context, run domain.ChatRun) error {
	if run.Status == "" {
		run.Status = domain.ChatRunStatusRunning
	}
	_, err := p.pool.Exec(ctx, `
		INSERT INTO chat_runs (
			id, user_id, model_id, character_id, character_name, node_id, parent_node_id,
			user_message, model_name, provider, request_id, status
		) VALUES ($1, $2, NULLIF($3, '')::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		run.ID, run.UserID, run.ModelID, run.CharacterID, run.CharacterName,
		run.NodeID, run.ParentNodeID, run.UserMessage, run.ModelName, run.Provider,
		run.RequestID, run.Status)
	if isUniqueViolation(err) {
		return ErrConflict
	}
	return err
}

func (p *Postgres) AttachChatRunReservation(ctx context.Context, runID, reservationID string) error {
	result, err := p.pool.Exec(ctx, `
		UPDATE chat_runs
		SET billing_reservation_id = $2, updated_at = now(), revision = revision + 1
		WHERE id = $1`, runID, reservationID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (p *Postgres) ChatRunByID(ctx context.Context, userID, runID string) (domain.ChatRun, error) {
	return scanChatRun(p.pool.QueryRow(ctx, chatRunSelect+`
		WHERE id = $1 AND ($2 = '' OR user_id = $2::uuid)`, runID, userID))
}

func (p *Postgres) ListPendingChatRuns(ctx context.Context, userID, characterID string) ([]domain.ChatRun, error) {
	rows, err := p.pool.Query(ctx, chatRunSelect+`
		WHERE user_id = $1 AND character_id = $2 AND acknowledged_at IS NULL
		ORDER BY created_at ASC, id ASC`, userID, characterID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.ChatRun, 0)
	for rows.Next() {
		item, err := scanChatRun(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (p *Postgres) UpdateChatRunProgress(ctx context.Context, runID, responseText string, firstTokenMS *int64) error {
	result, err := p.pool.Exec(ctx, `
		UPDATE chat_runs
		SET response_text = $2,
		    first_token_ms = COALESCE(first_token_ms, $3),
		    updated_at = now(), revision = revision + 1
		WHERE id = $1 AND status IN ('queued', 'running')`, runID, responseText, firstTokenMS)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (p *Postgres) FinishChatRun(ctx context.Context, runID string, update domain.ChatRunUpdate) (domain.ChatRun, error) {
	result, err := p.pool.Exec(ctx, `
		UPDATE chat_runs
		SET status = $2, response_text = $3, provider_response_id = $4,
		    finish_reason = $5, input_tokens = $6, output_tokens = $7,
		    total_tokens = $8, reasoning_tokens = $9, cache_read_input_tokens = $10,
		    cache_creation_input_tokens = $11, duration_ms = $12, first_token_ms = $13,
		    cost_microusd = $14, charged_microusd = $15, balance_microusd = $16,
		    reserved_microusd = $17, available_balance_microusd = $18,
		    unbilled_microusd = $19, error_code = $20, error_message = $21,
		    finished_at = now(), updated_at = now(), revision = revision + 1
		WHERE id = $1 AND status IN ('queued', 'running')`,
		runID, update.Status, update.ResponseText, update.ProviderResponseID,
		update.FinishReason, update.Usage.InputTokens, update.Usage.OutputTokens,
		update.Usage.TotalTokens, update.Usage.ReasoningTokens,
		update.Usage.CacheReadInputTokens, update.Usage.CacheCreationInputTokens,
		update.Usage.DurationMS, update.Usage.FirstTokenMS, update.Billing.CostMicrousd,
		update.Billing.ChargedMicrousd, update.Billing.BalanceMicrousd,
		update.Billing.ReservedMicrousd, update.Billing.AvailableBalanceMicrousd,
		update.Billing.UnbilledMicrousd, update.ErrorCode, update.ErrorMessage)
	if err != nil {
		return domain.ChatRun{}, err
	}
	if result.RowsAffected() == 0 {
		return p.ChatRunByID(ctx, "", runID)
	}
	return p.ChatRunByID(ctx, "", runID)
}

func (p *Postgres) RequestChatRunCancel(ctx context.Context, userID, runID string) (domain.ChatRun, error) {
	result, err := p.pool.Exec(ctx, `
		UPDATE chat_runs
		SET cancel_requested = true, updated_at = now(), revision = revision + 1
		WHERE id = $1 AND user_id = $2 AND status IN ('queued', 'running')`, runID, userID)
	if err != nil {
		return domain.ChatRun{}, err
	}
	if result.RowsAffected() == 0 {
		return p.ChatRunByID(ctx, userID, runID)
	}
	return p.ChatRunByID(ctx, userID, runID)
}

func (p *Postgres) AcknowledgeChatRun(ctx context.Context, userID, runID string) error {
	result, err := p.pool.Exec(ctx, `
		UPDATE chat_runs
		SET acknowledged_at = COALESCE(acknowledged_at, now()), updated_at = now(), revision = revision + 1
		WHERE id = $1 AND user_id = $2`, runID, userID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (p *Postgres) RecoverChatRuns(ctx context.Context) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `
		UPDATE billing_reservations
		SET status = 'released', settled_at = now()
		WHERE status = 'active' AND id IN (
			SELECT billing_reservation_id FROM chat_runs
			WHERE status IN ('queued', 'running') AND billing_reservation_id IS NOT NULL
		)`); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE chat_runs
		SET status = 'failed', error_code = 'server_restart',
		    error_message = 'The generation was interrupted by a server restart.',
		    finished_at = now(), updated_at = now(), revision = revision + 1
		WHERE status IN ('queued', 'running')`); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func scanChatRun(row pgx.Row) (domain.ChatRun, error) {
	var run domain.ChatRun
	var firstToken pgtype.Int8
	var acknowledged, finished pgtype.Timestamptz
	var started time.Time
	err := row.Scan(
		&run.ID, &run.UserID, &run.ModelID, &run.CharacterID, &run.CharacterName, &run.NodeID,
		&run.ParentNodeID, &run.UserMessage, &run.ModelName, &run.Provider,
		&run.RequestID, &run.BillingReservationID, &run.Status, &run.ResponseText,
		&run.ProviderResponseID, &run.FinishReason, &run.Usage.InputTokens,
		&run.Usage.OutputTokens, &run.Usage.TotalTokens, &run.Usage.ReasoningTokens,
		&run.Usage.CacheReadInputTokens, &run.Usage.CacheCreationInputTokens,
		&run.Usage.DurationMS, &firstToken, &run.Billing.CostMicrousd,
		&run.Billing.ChargedMicrousd, &run.Billing.BalanceMicrousd,
		&run.Billing.ReservedMicrousd, &run.Billing.AvailableBalanceMicrousd,
		&run.Billing.UnbilledMicrousd, &run.ErrorCode, &run.ErrorMessage,
		&run.CancelRequested, &acknowledged, &run.Revision, &run.CreatedAt,
		&started, &finished, &run.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return run, ErrNotFound
	}
	if err != nil {
		return run, err
	}
	if firstToken.Valid {
		value := firstToken.Int64
		run.Usage.FirstTokenMS = &value
	}
	if acknowledged.Valid {
		value := acknowledged.Time
		run.AcknowledgedAt = &value
		run.Acknowledged = true
	}
	if !started.IsZero() {
		run.StartedAt = &started
	}
	if finished.Valid {
		value := finished.Time
		run.FinishedAt = &value
	}
	return run, nil
}

func (p *Postgres) validateChatRunText(value string) error {
	if strings.ContainsRune(value, '\x00') {
		return errors.New("chat run text contains a NUL byte")
	}
	return nil
}
