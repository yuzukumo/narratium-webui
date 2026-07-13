package store

import (
	"context"
	"errors"
	"math"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/yuzukumo/narratium-webui/backend/internal/domain"
)

func (p *Postgres) AdjustUserBalance(
	ctx context.Context,
	userID, actorUserID string,
	deltaMicrousd int64,
	note string,
) (domain.User, domain.BalanceLedgerEntry, error) {
	return p.adjustUserBalance(ctx, userID, actorUserID, deltaMicrousd, note, domain.LedgerKindAdjustment)
}

func (p *Postgres) AdjustUserQuota(
	ctx context.Context,
	userID, actorUserID, mode string,
	amountMicrousd int64,
	note string,
) (domain.User, domain.BalanceLedgerEntry, error) {
	if amountMicrousd < 0 {
		return domain.User{}, domain.BalanceLedgerEntry{}, ErrConflict
	}
	kind := ""
	delta := int64(0)
	switch mode {
	case domain.BalanceAdjustmentAdd:
		if amountMicrousd == 0 || amountMicrousd > math.MaxInt64 {
			return domain.User{}, domain.BalanceLedgerEntry{}, ErrConflict
		}
		delta = amountMicrousd
		kind = domain.LedgerKindQuotaAdd
	case domain.BalanceAdjustmentSubtract:
		if amountMicrousd == 0 {
			return domain.User{}, domain.BalanceLedgerEntry{}, ErrConflict
		}
		delta = -amountMicrousd
		kind = domain.LedgerKindQuotaSubtract
	case domain.BalanceAdjustmentOverride:
		kind = domain.LedgerKindQuotaOverride
	default:
		return domain.User{}, domain.BalanceLedgerEntry{}, ErrConflict
	}

	if mode == domain.BalanceAdjustmentOverride {
		return p.overrideUserBalance(ctx, userID, actorUserID, amountMicrousd, note, kind)
	}
	return p.adjustUserBalance(ctx, userID, actorUserID, delta, note, kind)
}

func (p *Postgres) adjustUserBalance(
	ctx context.Context,
	userID, actorUserID string,
	deltaMicrousd int64,
	note, ledgerKind string,
) (domain.User, domain.BalanceLedgerEntry, error) {
	if deltaMicrousd == 0 {
		return domain.User{}, domain.BalanceLedgerEntry{}, ErrConflict
	}
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return domain.User{}, domain.BalanceLedgerEntry{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	balance, err := lockBillingUser(ctx, tx, userID)
	if err != nil {
		return domain.User{}, domain.BalanceLedgerEntry{}, err
	}
	if err := releaseExpiredReservations(ctx, tx, userID); err != nil {
		return domain.User{}, domain.BalanceLedgerEntry{}, err
	}
	reserved, err := activeReservedBalance(ctx, tx, userID, "")
	if err != nil {
		return domain.User{}, domain.BalanceLedgerEntry{}, err
	}
	if deltaMicrousd > 0 && balance > math.MaxInt64-deltaMicrousd {
		return domain.User{}, domain.BalanceLedgerEntry{}, ErrConflict
	}
	nextBalance := balance + deltaMicrousd
	if nextBalance < reserved || nextBalance < 0 {
		return domain.User{}, domain.BalanceLedgerEntry{}, ErrInsufficientBalance
	}
	if _, err := tx.Exec(ctx, `
		UPDATE users SET balance_microusd = $2, updated_at = now() WHERE id = $1`,
		userID, nextBalance); err != nil {
		return domain.User{}, domain.BalanceLedgerEntry{}, err
	}

	entry := domain.BalanceLedgerEntry{
		ID: uuid.NewString(), UserID: userID, ActorUserID: actorUserID,
		Kind: ledgerKind, AmountMicrousd: deltaMicrousd,
		BalanceAfterMicrousd: nextBalance, Note: strings.TrimSpace(note),
	}
	if err := tx.QueryRow(ctx, `
		INSERT INTO balance_ledger (
			id, user_id, actor_user_id, kind, amount_microusd, balance_after_microusd, note
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING created_at`,
		entry.ID, entry.UserID, nullableString(entry.ActorUserID), entry.Kind,
		entry.AmountMicrousd, entry.BalanceAfterMicrousd, entry.Note,
	).Scan(&entry.CreatedAt); err != nil {
		return domain.User{}, domain.BalanceLedgerEntry{}, err
	}
	user, err := scanUser(tx.QueryRow(ctx, userSelect+" WHERE u.id = $1", userID))
	if err != nil {
		return domain.User{}, domain.BalanceLedgerEntry{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.User{}, domain.BalanceLedgerEntry{}, err
	}
	return user, entry, nil
}

func (p *Postgres) overrideUserBalance(
	ctx context.Context,
	userID, actorUserID string,
	targetMicrousd int64,
	note, ledgerKind string,
) (domain.User, domain.BalanceLedgerEntry, error) {
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return domain.User{}, domain.BalanceLedgerEntry{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	balance, err := lockBillingUser(ctx, tx, userID)
	if err != nil {
		return domain.User{}, domain.BalanceLedgerEntry{}, err
	}
	if err := releaseExpiredReservations(ctx, tx, userID); err != nil {
		return domain.User{}, domain.BalanceLedgerEntry{}, err
	}
	reserved, err := activeReservedBalance(ctx, tx, userID, "")
	if err != nil {
		return domain.User{}, domain.BalanceLedgerEntry{}, err
	}
	if targetMicrousd < reserved || targetMicrousd < 0 {
		return domain.User{}, domain.BalanceLedgerEntry{}, ErrInsufficientBalance
	}
	if _, err := tx.Exec(ctx, `
		UPDATE users SET balance_microusd = $2, updated_at = now() WHERE id = $1`,
		userID, targetMicrousd); err != nil {
		return domain.User{}, domain.BalanceLedgerEntry{}, err
	}

	entry := domain.BalanceLedgerEntry{
		ID: uuid.NewString(), UserID: userID, ActorUserID: actorUserID,
		Kind: ledgerKind, AmountMicrousd: targetMicrousd - balance,
		BalanceAfterMicrousd: targetMicrousd, Note: strings.TrimSpace(note),
	}
	if err := tx.QueryRow(ctx, `
		INSERT INTO balance_ledger (
			id, user_id, actor_user_id, kind, amount_microusd, balance_after_microusd, note
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING created_at`,
		entry.ID, entry.UserID, nullableString(entry.ActorUserID), entry.Kind,
		entry.AmountMicrousd, entry.BalanceAfterMicrousd, entry.Note,
	).Scan(&entry.CreatedAt); err != nil {
		return domain.User{}, domain.BalanceLedgerEntry{}, err
	}
	user, err := scanUser(tx.QueryRow(ctx, userSelect+" WHERE u.id = $1", userID))
	if err != nil {
		return domain.User{}, domain.BalanceLedgerEntry{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.User{}, domain.BalanceLedgerEntry{}, err
	}
	return user, entry, nil
}

func (p *Postgres) ListBalanceLedger(ctx context.Context, userID string, limit, offset int) (domain.Page[domain.BalanceLedgerEntry], error) {
	var result domain.Page[domain.BalanceLedgerEntry]
	if err := p.pool.QueryRow(ctx, "SELECT count(*) FROM balance_ledger WHERE user_id = $1", userID).Scan(&result.Total); err != nil {
		return result, err
	}
	rows, err := p.pool.Query(ctx, `
		SELECT id, user_id, COALESCE(actor_user_id::text, ''), COALESCE(model_id::text, ''),
		       COALESCE(usage_log_id::text, ''), request_id, kind, amount_microusd,
		       balance_after_microusd, note, created_at
		FROM balance_ledger
		WHERE user_id = $1
		ORDER BY created_at DESC, id DESC
		LIMIT $2 OFFSET $3`, userID, limit, offset)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var entry domain.BalanceLedgerEntry
		if err := rows.Scan(
			&entry.ID, &entry.UserID, &entry.ActorUserID, &entry.ModelID,
			&entry.UsageLogID, &entry.RequestID, &entry.Kind, &entry.AmountMicrousd,
			&entry.BalanceAfterMicrousd, &entry.Note, &entry.CreatedAt,
		); err != nil {
			return result, err
		}
		result.Items = append(result.Items, entry)
	}
	return result, rows.Err()
}

func (p *Postgres) ReserveBalance(ctx context.Context, reservation domain.BillingReservation) (domain.BillingReservation, error) {
	if reservation.ID == "" {
		reservation.ID = uuid.NewString()
	}
	if reservation.EstimatedCostMicrousd < 0 {
		return domain.BillingReservation{}, ErrConflict
	}
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return domain.BillingReservation{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	balance, err := lockBillingUser(ctx, tx, reservation.UserID)
	if err != nil {
		return domain.BillingReservation{}, err
	}
	if err := releaseExpiredReservations(ctx, tx, reservation.UserID); err != nil {
		return domain.BillingReservation{}, err
	}
	reserved, err := activeReservedBalance(ctx, tx, reservation.UserID, "")
	if err != nil {
		return domain.BillingReservation{}, err
	}
	if reservation.EstimatedCostMicrousd > max(balance-reserved, 0) {
		return domain.BillingReservation{}, ErrInsufficientBalance
	}
	reservation.Status = "active"
	err = tx.QueryRow(ctx, `
		INSERT INTO billing_reservations (
			id, user_id, model_id, request_id, estimated_cost_microusd, status, expires_at
		) VALUES ($1, $2, $3, $4, $5, 'active', $6)
		RETURNING created_at`,
		reservation.ID, reservation.UserID, nullableString(reservation.ModelID), reservation.RequestID,
		reservation.EstimatedCostMicrousd, reservation.ExpiresAt,
	).Scan(&reservation.CreatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return domain.BillingReservation{}, ErrConflict
		}
		return domain.BillingReservation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.BillingReservation{}, err
	}
	return reservation, nil
}

func (p *Postgres) FinalizeBilling(
	ctx context.Context,
	reservationID string,
	usage domain.UsageLog,
	actualCostMicrousd int64,
) (domain.BillingSettlement, error) {
	if actualCostMicrousd < 0 {
		return domain.BillingSettlement{}, ErrConflict
	}
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return domain.BillingSettlement{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var reservationUserID string
	err = tx.QueryRow(ctx, `SELECT user_id FROM billing_reservations WHERE id = $1`, reservationID).Scan(&reservationUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.BillingSettlement{}, ErrNotFound
	}
	if err != nil {
		return domain.BillingSettlement{}, err
	}
	balance, err := lockBillingUser(ctx, tx, reservationUserID)
	if err != nil {
		return domain.BillingSettlement{}, err
	}

	var reservation domain.BillingReservation
	err = tx.QueryRow(ctx, `
			SELECT id, user_id, COALESCE(model_id::text, ''), request_id,
		       estimated_cost_microusd, actual_cost_microusd, charged_microusd,
		       COALESCE(balance_after_microusd, 0), status, expires_at, created_at,
		       COALESCE(settled_at, created_at)
		FROM billing_reservations WHERE id = $1 FOR UPDATE`, reservationID,
	).Scan(
		&reservation.ID, &reservation.UserID, &reservation.ModelID, &reservation.RequestID,
		&reservation.EstimatedCostMicrousd, &reservation.ActualCostMicrousd,
		&reservation.ChargedMicrousd, &reservation.BalanceAfterMicrousd,
		&reservation.Status, &reservation.ExpiresAt, &reservation.CreatedAt, &reservation.SettledAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.BillingSettlement{}, ErrNotFound
	}
	if err != nil {
		return domain.BillingSettlement{}, err
	}
	if reservation.UserID != reservationUserID {
		return domain.BillingSettlement{}, ErrConflict
	}
	if reservation.Status == "settled" {
		return domain.BillingSettlement{
			CostMicrousd: reservation.ActualCostMicrousd, ChargedMicrousd: reservation.ChargedMicrousd,
			UnbilledMicrousd:         max(reservation.ActualCostMicrousd-reservation.ChargedMicrousd, 0),
			BalanceMicrousd:          reservation.BalanceAfterMicrousd,
			AvailableBalanceMicrousd: reservation.BalanceAfterMicrousd,
		}, nil
	}
	if reservation.Status != "active" {
		return domain.BillingSettlement{}, ErrReservationClosed
	}

	if err := releaseExpiredReservationsExcept(ctx, tx, reservation.UserID, reservation.ID); err != nil {
		return domain.BillingSettlement{}, err
	}
	otherReserved, err := activeReservedBalance(ctx, tx, reservation.UserID, reservation.ID)
	if err != nil {
		return domain.BillingSettlement{}, err
	}
	chargeable := max(balance-otherReserved, 0)
	charged := min(actualCostMicrousd, chargeable)
	balanceAfter := balance - charged
	if _, err := tx.Exec(ctx, `
		UPDATE users SET balance_microusd = $2, updated_at = now() WHERE id = $1`,
		reservation.UserID, balanceAfter); err != nil {
		return domain.BillingSettlement{}, err
	}

	if usage.ID == "" {
		usage.ID = uuid.NewString()
	}
	usage.UserID = reservation.UserID
	if usage.ModelID == "" {
		usage.ModelID = reservation.ModelID
	}
	if usage.RequestID == "" {
		usage.RequestID = reservation.RequestID
	}
	usage.BillingReservationID = reservation.ID
	usage.CostMicrousd = actualCostMicrousd
	usage.ChargedMicrousd = charged
	if err := insertUsage(ctx, tx, usage); err != nil {
		return domain.BillingSettlement{}, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE billing_reservations
		SET actual_cost_microusd = $2, charged_microusd = $3, balance_after_microusd = $4,
		    status = 'settled', settled_at = now()
		WHERE id = $1`, reservation.ID, actualCostMicrousd, charged, balanceAfter); err != nil {
		return domain.BillingSettlement{}, err
	}
	if charged > 0 {
		if _, err := tx.Exec(ctx, `
			INSERT INTO balance_ledger (
				id, user_id, model_id, usage_log_id, request_id, kind,
				amount_microusd, balance_after_microusd, note
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '')`,
			uuid.NewString(), reservation.UserID, nullableString(reservation.ModelID), usage.ID,
			reservation.RequestID, domain.LedgerKindUsageCharge, -charged, balanceAfter,
		); err != nil {
			return domain.BillingSettlement{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.BillingSettlement{}, err
	}
	return domain.BillingSettlement{
		CostMicrousd: actualCostMicrousd, ChargedMicrousd: charged,
		UnbilledMicrousd: max(actualCostMicrousd-charged, 0),
		BalanceMicrousd:  balanceAfter, ReservedMicrousd: otherReserved,
		AvailableBalanceMicrousd: max(balanceAfter-otherReserved, 0),
	}, nil
}

func (p *Postgres) ReleaseBalanceReservation(ctx context.Context, reservationID string) error {
	_, err := p.pool.Exec(ctx, `
		UPDATE billing_reservations
		SET status = 'released', settled_at = now()
		WHERE id = $1 AND status = 'active'`, reservationID)
	return err
}

func releaseExpiredReservations(ctx context.Context, tx pgx.Tx, userID string) error {
	_, err := tx.Exec(ctx, `
		UPDATE billing_reservations
		SET status = 'released', settled_at = now()
		WHERE user_id = $1 AND status = 'active' AND expires_at <= now()`, userID)
	return err
}

func releaseExpiredReservationsExcept(ctx context.Context, tx pgx.Tx, userID, reservationID string) error {
	_, err := tx.Exec(ctx, `
		UPDATE billing_reservations
		SET status = 'released', settled_at = now()
		WHERE user_id = $1 AND id <> $2 AND status = 'active' AND expires_at <= now()`,
		userID, reservationID)
	return err
}

func activeReservedBalance(ctx context.Context, tx pgx.Tx, userID, excludedReservationID string) (int64, error) {
	var reserved int64
	err := tx.QueryRow(ctx, `
		SELECT COALESCE(sum(estimated_cost_microusd), 0)::bigint
		FROM billing_reservations
		WHERE user_id = $1 AND status = 'active' AND expires_at > now()
		  AND ($2 = '' OR id::text <> $2)`, userID, excludedReservationID).Scan(&reserved)
	return reserved, err
}

func lockBillingUser(ctx context.Context, tx pgx.Tx, userID string) (int64, error) {
	var balance int64
	err := tx.QueryRow(ctx, `
		SELECT balance_microusd FROM users WHERE id = $1 FOR UPDATE`, userID,
	).Scan(&balance)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	return balance, err
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}
