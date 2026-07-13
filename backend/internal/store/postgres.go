package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/yuzukumo/narratium-webui/backend/internal/domain"
	"github.com/yuzukumo/narratium-webui/backend/migrations"
)

type Postgres struct {
	pool *pgxpool.Pool
}

func Open(ctx context.Context, databaseURL string) (*Postgres, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database URL: %w", err)
	}
	config.MaxConns = 20
	config.MinConns = 2
	config.MaxConnLifetime = time.Hour
	config.MaxConnIdleTime = 15 * time.Minute
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return &Postgres{pool: pool}, nil
}

func (p *Postgres) Close() {
	p.pool.Close()
}

func (p *Postgres) Health(ctx context.Context) error {
	return p.pool.Ping(ctx)
}

func (p *Postgres) Migrate(ctx context.Context) error {
	connection, err := p.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire migration connection: %w", err)
	}
	defer func() {
		unlockCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = connection.Exec(unlockCtx, "SELECT pg_advisory_unlock(hashtext('narratium:schema-migrations'))")
		connection.Release()
	}()
	if _, err := connection.Exec(ctx, "SELECT pg_advisory_lock(hashtext('narratium:schema-migrations'))"); err != nil {
		return fmt.Errorf("lock migrations: %w", err)
	}

	if _, err := connection.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`); err != nil {
		return fmt.Errorf("create migration table: %w", err)
	}

	entries, err := fs.ReadDir(migrations.FS, ".")
	if err != nil {
		return fmt.Errorf("read migrations: %w", err)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		var applied bool
		if err := connection.QueryRow(ctx,
			"SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)",
			entry.Name(),
		).Scan(&applied); err != nil {
			return fmt.Errorf("check migration %s: %w", entry.Name(), err)
		}
		if applied {
			continue
		}
		body, err := migrations.FS.ReadFile(entry.Name())
		if err != nil {
			return fmt.Errorf("read migration %s: %w", entry.Name(), err)
		}
		tx, err := connection.BeginTx(ctx, pgx.TxOptions{})
		if err != nil {
			return fmt.Errorf("begin migration %s: %w", entry.Name(), err)
		}
		if _, err = tx.Exec(ctx, string(body)); err == nil {
			_, err = tx.Exec(ctx, "INSERT INTO schema_migrations (version) VALUES ($1)", entry.Name())
		}
		if err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("apply migration %s: %w", entry.Name(), err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit migration %s: %w", entry.Name(), err)
		}
	}
	return nil
}

func (p *Postgres) Bootstrap(ctx context.Context) (domain.BootstrapState, error) {
	var state domain.BootstrapState
	err := p.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM users),
		       COALESCE((SELECT (value #>> '{}')::boolean FROM settings WHERE key = 'registration_enabled'), true),
		       COALESCE((SELECT (value #>> '{}')::boolean FROM settings WHERE key = 'email_verification_enabled'), false)`,
	).Scan(&state.Initialized, &state.RegistrationEnabled, &state.EmailVerificationEnabled)
	return state, err
}

func (p *Postgres) Register(ctx context.Context, name, email, passwordHash string) (domain.User, error) {
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return domain.User{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext('narratium:first-user'))"); err != nil {
		return domain.User{}, err
	}
	var count int
	var registrationEnabled bool
	if err := tx.QueryRow(ctx, `
		SELECT (SELECT count(*) FROM users),
		       COALESCE((SELECT (value #>> '{}')::boolean FROM settings WHERE key = 'registration_enabled'), true)`,
	).Scan(&count, &registrationEnabled); err != nil {
		return domain.User{}, err
	}
	if count > 0 && !registrationEnabled {
		return domain.User{}, ErrRegistrationDisabled
	}
	role := domain.RoleUser
	if count == 0 {
		role = domain.RoleAdmin
	}
	user := domain.User{
		ID: uuid.NewString(), Name: name, Email: email, PasswordHash: passwordHash,
		Role: role, Status: domain.StatusActive, TokenVersion: 1,
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO users (id, name, email, password_hash, role, status, token_version)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		user.ID, user.Name, user.Email, user.PasswordHash, user.Role, user.Status, user.TokenVersion,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return domain.User{}, ErrConflict
		}
		return domain.User{}, err
	}
	user, err = scanUser(tx.QueryRow(ctx, userSelect+" WHERE u.id = $1", user.ID))
	if err != nil {
		return domain.User{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.User{}, err
	}
	return user, nil
}

const userSelect = `
	SELECT u.id, u.name, u.email, u.password_hash, u.role, u.status,
	       u.token_version, u.balance_microusd,
	       COALESCE((
	           SELECT sum(r.estimated_cost_microusd)
	           FROM billing_reservations r
	           WHERE r.user_id = u.id AND r.status = 'active' AND r.expires_at > now()
	       ), 0),
	       u.created_at, u.updated_at
	FROM users u`

func scanUser(row pgx.Row) (domain.User, error) {
	var user domain.User
	err := row.Scan(&user.ID, &user.Name, &user.Email, &user.PasswordHash, &user.Role, &user.Status,
		&user.TokenVersion, &user.BalanceMicrousd, &user.ReservedMicrousd,
		&user.CreatedAt, &user.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.User{}, ErrNotFound
	}
	user.AvailableBalanceMicrousd = max(user.BalanceMicrousd-user.ReservedMicrousd, 0)
	return user, err
}

func (p *Postgres) UserByID(ctx context.Context, id string) (domain.User, error) {
	return scanUser(p.pool.QueryRow(ctx, userSelect+" WHERE u.id = $1", id))
}

func (p *Postgres) UserByEmail(ctx context.Context, email string) (domain.User, error) {
	return scanUser(p.pool.QueryRow(ctx, userSelect+" WHERE lower(u.email) = lower($1)", email))
}

func (p *Postgres) RevokeSessions(ctx context.Context, userID string, tokenVersion int64) error {
	command, err := p.pool.Exec(ctx, `
		UPDATE users SET token_version = token_version + 1, updated_at = now()
		WHERE id = $1 AND token_version = $2`, userID, tokenVersion)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return ErrConflict
	}
	return nil
}

func (p *Postgres) ListUsers(ctx context.Context, limit, offset int) (domain.Page[domain.User], error) {
	var result domain.Page[domain.User]
	if err := p.pool.QueryRow(ctx, "SELECT count(*) FROM users").Scan(&result.Total); err != nil {
		return result, err
	}
	rows, err := p.pool.Query(ctx, userSelect+" ORDER BY u.created_at ASC LIMIT $1 OFFSET $2", limit, offset)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		user, err := scanUser(rows)
		if err != nil {
			return result, err
		}
		result.Items = append(result.Items, user)
	}
	return result, rows.Err()
}

func (p *Postgres) UpdateUser(ctx context.Context, id, name, email, role, status string) (domain.User, error) {
	// The advisory lock serializes admin transitions; read committed lets a
	// waiter observe the transition that committed before it acquired the lock.
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return domain.User{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext('narratium:admin-users'))"); err != nil {
		return domain.User{}, err
	}
	current, err := scanUser(tx.QueryRow(ctx, `
		SELECT id, name, email, password_hash, role, status,
		       token_version, balance_microusd, 0::bigint, created_at, updated_at
		FROM users WHERE id = $1 FOR UPDATE`, id))
	if err != nil {
		return domain.User{}, err
	}
	removesActiveAdmin := current.Role == domain.RoleAdmin && current.Status == domain.StatusActive &&
		(role != domain.RoleAdmin || status != domain.StatusActive)
	if removesActiveAdmin {
		var adminCount int
		if err := tx.QueryRow(ctx, "SELECT count(*) FROM users WHERE role = 'admin' AND status = 'active'").Scan(&adminCount); err != nil {
			return domain.User{}, err
		}
		if adminCount <= 1 {
			return domain.User{}, ErrLastAdmin
		}
	}
	_, err = tx.Exec(ctx, `
		UPDATE users
		SET name = $2, email = $3, role = $4, status = $5,
		    token_version = token_version + CASE WHEN role <> $4 OR status <> $5 THEN 1 ELSE 0 END,
		    updated_at = now()
		WHERE id = $1`, id, name, email, role, status)
	if err != nil {
		if isUniqueViolation(err) {
			return domain.User{}, ErrConflict
		}
		return domain.User{}, err
	}
	updated, err := scanUser(tx.QueryRow(ctx, userSelect+" WHERE u.id = $1", id))
	if err != nil {
		return domain.User{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.User{}, err
	}
	return updated, nil
}

func (p *Postgres) UpdateUserPassword(ctx context.Context, id, passwordHash string) (domain.User, error) {
	command, err := p.pool.Exec(ctx, `
		UPDATE users
		SET password_hash = $2, token_version = token_version + 1, updated_at = now()
		WHERE id = $1`, id, passwordHash)
	if err != nil {
		return domain.User{}, err
	}
	if command.RowsAffected() == 0 {
		return domain.User{}, ErrNotFound
	}
	return p.UserByID(ctx, id)
}

func (p *Postgres) RegistrationEnabled(ctx context.Context) (bool, error) {
	var enabled bool
	err := p.pool.QueryRow(ctx, `
		SELECT COALESCE((SELECT (value #>> '{}')::boolean FROM settings WHERE key = 'registration_enabled'), true)`,
	).Scan(&enabled)
	return enabled, err
}

func (p *Postgres) SetRegistrationEnabled(ctx context.Context, enabled bool) error {
	value, _ := json.Marshal(enabled)
	_, err := p.pool.Exec(ctx, `
		INSERT INTO settings (key, value) VALUES ('registration_enabled', $1)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`, value)
	return err
}

func (p *Postgres) EmailVerificationEnabled(ctx context.Context) (bool, error) {
	var enabled bool
	err := p.pool.QueryRow(ctx, `
		SELECT COALESCE((SELECT (value #>> '{}')::boolean FROM settings WHERE key = 'email_verification_enabled'), false)`,
	).Scan(&enabled)
	return enabled, err
}

func (p *Postgres) SetEmailVerificationEnabled(ctx context.Context, enabled bool) error {
	value, _ := json.Marshal(enabled)
	_, err := p.pool.Exec(ctx, `
		INSERT INTO settings (key, value) VALUES ('email_verification_enabled', $1)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`, value)
	return err
}

func (p *Postgres) SaveEmailVerificationCode(ctx context.Context, email, codeHash string, expiresAt time.Time) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO email_verification_codes (email, code_hash, attempts, expires_at)
		VALUES ($1, $2, 0, $3)
		ON CONFLICT (email) DO UPDATE
		SET code_hash = excluded.code_hash, attempts = 0, expires_at = excluded.expires_at, updated_at = now()`,
		email, codeHash, expiresAt)
	return err
}

func (p *Postgres) ConsumeEmailVerificationCode(ctx context.Context, email, codeHash string, now time.Time) error {
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var storedHash string
	var attempts int
	var expiresAt time.Time
	err = tx.QueryRow(ctx, `
		SELECT code_hash, attempts, expires_at
		FROM email_verification_codes WHERE email = $1 FOR UPDATE`, email).
		Scan(&storedHash, &attempts, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidVerification
	}
	if err != nil {
		return err
	}
	if !now.Before(expiresAt) {
		_, _ = tx.Exec(ctx, "DELETE FROM email_verification_codes WHERE email = $1", email)
		return ErrVerificationExpired
	}
	if attempts >= 5 {
		return ErrVerificationLocked
	}
	if storedHash != codeHash {
		if _, err := tx.Exec(ctx, `UPDATE email_verification_codes SET attempts = attempts + 1, updated_at = now() WHERE email = $1`, email); err != nil {
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		return ErrInvalidVerification
	}
	if _, err := tx.Exec(ctx, "DELETE FROM email_verification_codes WHERE email = $1", email); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func scanProvider(row pgx.Row) (domain.ProviderConfig, error) {
	var item domain.ProviderConfig
	err := row.Scan(&item.ID, &item.ChannelID, &item.Name, &item.Provider, &item.APIFormat, &item.PromptCacheKeyEnabled, &item.BaseURL, &item.APIKeyCiphertext,
		&item.Enabled, &item.CreatedAt, &item.UpdatedAt, &item.Models)
	if errors.Is(err, pgx.ErrNoRows) {
		return item, ErrNotFound
	}
	item.HasAPIKey = item.APIKeyCiphertext != ""
	return item, err
}

const providerSelect = `
	SELECT p.id, p.channel_id, p.name, p.provider, p.api_format, p.prompt_cache_key_enabled,
	       p.base_url, p.api_key_ciphertext, p.enabled, p.created_at, p.updated_at,
	       ARRAY(
	           SELECT m.external_id
	           FROM models m
	           WHERE m.provider_config_id = p.id
	           ORDER BY m.external_id ASC
	       )
	FROM provider_configs p`

func (p *Postgres) ListProviders(ctx context.Context) ([]domain.ProviderConfig, error) {
	rows, err := p.pool.Query(ctx, providerSelect+" ORDER BY p.channel_id ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []domain.ProviderConfig
	for rows.Next() {
		item, err := scanProvider(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (p *Postgres) ProviderByID(ctx context.Context, id string) (domain.ProviderConfig, error) {
	return scanProvider(p.pool.QueryRow(ctx, providerSelect+" WHERE p.id = $1", id))
}

func (p *Postgres) CreateProvider(ctx context.Context, item domain.ProviderConfig) (domain.ProviderConfig, error) {
	if item.ID == "" {
		item.ID = uuid.NewString()
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return domain.ProviderConfig{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(ctx, `
		INSERT INTO provider_configs (id, name, provider, api_format, prompt_cache_key_enabled, base_url, api_key_ciphertext, enabled)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, item.ID, item.Name, item.Provider, item.APIFormat, item.PromptCacheKeyEnabled, item.BaseURL, item.APIKeyCiphertext, item.Enabled)
	if isUniqueViolation(err) {
		return domain.ProviderConfig{}, ErrConflict
	}
	if err != nil {
		return domain.ProviderConfig{}, err
	}
	if err := replaceProviderModels(ctx, tx, item.ID, item.Models); err != nil {
		return domain.ProviderConfig{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.ProviderConfig{}, err
	}
	return p.ProviderByID(ctx, item.ID)
}

func (p *Postgres) UpdateProvider(ctx context.Context, item domain.ProviderConfig) (domain.ProviderConfig, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return domain.ProviderConfig{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	result, err := tx.Exec(ctx, `
		UPDATE provider_configs SET
			name = $2, provider = $3, api_format = $4, prompt_cache_key_enabled = $5,
			base_url = $6, api_key_ciphertext = $7, enabled = $8, updated_at = now()
		WHERE id = $1`, item.ID, item.Name, item.Provider, item.APIFormat, item.PromptCacheKeyEnabled, item.BaseURL, item.APIKeyCiphertext, item.Enabled)
	if err != nil {
		return domain.ProviderConfig{}, err
	}
	if result.RowsAffected() == 0 {
		return domain.ProviderConfig{}, ErrNotFound
	}
	if err := replaceProviderModels(ctx, tx, item.ID, item.Models); err != nil {
		return domain.ProviderConfig{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.ProviderConfig{}, err
	}
	return p.ProviderByID(ctx, item.ID)
}

func (p *Postgres) DeleteProvider(ctx context.Context, id string) (domain.ProviderConfig, error) {
	return scanProvider(p.pool.QueryRow(ctx, `
		DELETE FROM provider_configs WHERE id = $1
		RETURNING id, channel_id, name, provider, api_format, prompt_cache_key_enabled, base_url,
		          api_key_ciphertext, enabled, created_at, updated_at, ARRAY[]::text[]`, id))
}

func replaceProviderModels(ctx context.Context, tx pgx.Tx, providerID string, modelIDs []string) error {
	if _, err := tx.Exec(ctx, `
		DELETE FROM models
		WHERE provider_config_id = $1
		  AND NOT (external_id = ANY($2::text[]))`, providerID, modelIDs); err != nil {
		return err
	}
	for _, modelID := range modelIDs {
		if _, err := tx.Exec(ctx, `
				INSERT INTO models (id, provider_config_id, external_id, capabilities)
				VALUES ($1, $2, $3, $4)
				ON CONFLICT (provider_config_id, external_id) DO UPDATE SET
					updated_at = now()`, uuid.NewString(), providerID, modelID, json.RawMessage(`{}`)); err != nil {
			return err
		}
	}
	return nil
}

func scanModel(row pgx.Row) (domain.Model, error) {
	var item domain.Model
	err := row.Scan(&item.ID, &item.ProviderConfigID, &item.Provider, &item.ProviderName,
		&item.ExternalID, &item.Capabilities,
		&item.Pricing.InputMicrousdPerMillion, &item.Pricing.OutputMicrousdPerMillion,
		&item.Pricing.CacheReadMicrousdPerMillion, &item.Pricing.CacheCreationMicrousdPerMillion,
		&item.Pricing.PriceMultiplier,
		&item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return item, ErrNotFound
	}
	return item, err
}

const modelSelect = `
	SELECT m.id, m.provider_config_id, p.provider, p.name, m.external_id,
		       m.capabilities,
		       m.input_price_microusd_per_million, m.output_price_microusd_per_million,
		       m.cache_read_price_microusd_per_million, m.cache_creation_price_microusd_per_million,
		       m.price_multiplier,
		       m.created_at, m.updated_at
	FROM models m JOIN provider_configs p ON p.id = m.provider_config_id`

func (p *Postgres) ListModels(ctx context.Context, availableOnly bool) ([]domain.Model, error) {
	query := modelSelect
	if availableOnly {
		query += " WHERE p.enabled = true AND p.api_key_ciphertext <> ''"
	}
	query += " ORDER BY p.channel_id ASC, m.external_id ASC"
	rows, err := p.pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []domain.Model
	for rows.Next() {
		item, err := scanModel(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (p *Postgres) ModelByID(ctx context.Context, id string) (domain.Model, error) {
	return scanModel(p.pool.QueryRow(ctx, modelSelect+
		" WHERE m.id = $1 AND p.enabled = true AND p.api_key_ciphertext <> ''", id))
}

func (p *Postgres) UpdateModel(ctx context.Context, item domain.Model) (domain.Model, error) {
	result, err := p.pool.Exec(ctx, `
		UPDATE models
		SET capabilities = $2,
		    input_price_microusd_per_million = $3,
		    output_price_microusd_per_million = $4,
		    cache_read_price_microusd_per_million = $5,
		    cache_creation_price_microusd_per_million = $6,
		    price_multiplier = $7,
		    updated_at = now()
		WHERE id = $1`, item.ID, item.Capabilities,
		item.Pricing.InputMicrousdPerMillion, item.Pricing.OutputMicrousdPerMillion,
		item.Pricing.CacheReadMicrousdPerMillion, item.Pricing.CacheCreationMicrousdPerMillion,
		item.Pricing.NormalizedMultiplier())
	if err != nil {
		return domain.Model{}, err
	}
	if result.RowsAffected() == 0 {
		return domain.Model{}, ErrNotFound
	}
	return p.ModelByID(ctx, item.ID)
}

func (p *Postgres) GetDocument(ctx context.Context, userID, namespace string) (domain.UserDocument, error) {
	var item domain.UserDocument
	err := p.pool.QueryRow(ctx, `
		SELECT namespace, value, revision, updated_at FROM user_documents
		WHERE user_id = $1 AND namespace = $2`, userID, namespace,
	).Scan(&item.Namespace, &item.Value, &item.Revision, &item.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return item, ErrNotFound
	}
	return item, err
}

func (p *Postgres) PutDocument(ctx context.Context, userID, namespace string, value json.RawMessage, expected *int64) (domain.UserDocument, error) {
	var item domain.UserDocument
	var row pgx.Row
	if expected == nil {
		row = p.pool.QueryRow(ctx, `
			INSERT INTO user_documents (user_id, namespace, value)
			VALUES ($1, $2, $3)
			ON CONFLICT (user_id, namespace) DO UPDATE SET
				value = excluded.value, revision = user_documents.revision + 1, updated_at = now()
			RETURNING namespace, value, revision, updated_at`, userID, namespace, value)
	} else if *expected == 0 {
		row = p.pool.QueryRow(ctx, `
			INSERT INTO user_documents (user_id, namespace, value)
			VALUES ($1, $2, $3)
			ON CONFLICT (user_id, namespace) DO NOTHING
			RETURNING namespace, value, revision, updated_at`, userID, namespace, value)
	} else {
		row = p.pool.QueryRow(ctx, `
			UPDATE user_documents SET value = $3, revision = revision + 1, updated_at = now()
			WHERE user_id = $1 AND namespace = $2 AND revision = $4
			RETURNING namespace, value, revision, updated_at`, userID, namespace, value, *expected)
	}
	err := row.Scan(&item.Namespace, &item.Value, &item.Revision, &item.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return item, ErrConflict
	}
	return item, err
}

func (p *Postgres) GetBlob(ctx context.Context, userID, key string) (domain.UserBlob, error) {
	var item domain.UserBlob
	err := p.pool.QueryRow(ctx, `
		SELECT key, content_type, data, octet_length(data), revision, updated_at FROM user_blobs
		WHERE user_id = $1 AND key = $2`, userID, key,
	).Scan(&item.Key, &item.ContentType, &item.Data, &item.Size, &item.Revision, &item.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return item, ErrNotFound
	}
	return item, err
}

func (p *Postgres) ListBlobs(ctx context.Context, userID string, limit, offset int) (domain.Page[domain.UserBlob], error) {
	var result domain.Page[domain.UserBlob]
	if err := p.pool.QueryRow(ctx, "SELECT count(*) FROM user_blobs WHERE user_id = $1", userID).Scan(&result.Total); err != nil {
		return result, err
	}
	rows, err := p.pool.Query(ctx, `
		SELECT key, content_type, octet_length(data), revision, updated_at FROM user_blobs
		WHERE user_id = $1 ORDER BY key ASC LIMIT $2 OFFSET $3`, userID, limit, offset)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var item domain.UserBlob
		if err := rows.Scan(&item.Key, &item.ContentType, &item.Size, &item.Revision, &item.UpdatedAt); err != nil {
			return result, err
		}
		result.Items = append(result.Items, item)
	}
	return result, rows.Err()
}

func (p *Postgres) PutBlob(
	ctx context.Context,
	userID, key, contentType string,
	data []byte,
	expectedRevision int64,
	quota BlobQuota,
) (domain.UserBlob, error) {
	var item domain.UserBlob
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return item, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := lockBlobOwner(ctx, tx, userID); err != nil {
		return item, err
	}

	var currentRevision, currentSize int64
	err = tx.QueryRow(ctx, `
		SELECT revision, octet_length(data) FROM user_blobs
		WHERE user_id = $1 AND key = $2`, userID, key,
	).Scan(&currentRevision, &currentSize)
	exists := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return item, err
	}
	if expectedRevision == 0 {
		if exists {
			return item, ErrConflict
		}
	} else if !exists || currentRevision != expectedRevision {
		return item, ErrConflict
	}

	var currentCount, currentTotalBytes int64
	if err := tx.QueryRow(ctx, `
		SELECT count(*), COALESCE(sum(octet_length(data)), 0)
		FROM user_blobs WHERE user_id = $1`, userID,
	).Scan(&currentCount, &currentTotalBytes); err != nil {
		return item, err
	}
	projectedCount := currentCount
	if !exists {
		projectedCount++
	}
	if quota.MaxCount > 0 && projectedCount > int64(quota.MaxCount) {
		return item, ErrBlobCountQuota
	}
	projectedTotalBytes := currentTotalBytes - currentSize + int64(len(data))
	if quota.MaxTotalBytes > 0 && projectedTotalBytes > quota.MaxTotalBytes {
		return item, ErrBlobTotalBytesQuota
	}

	if exists {
		err = tx.QueryRow(ctx, `
			UPDATE user_blobs SET
				content_type = $3, data = $4, revision = revision + 1, updated_at = now()
			WHERE user_id = $1 AND key = $2 AND revision = $5
			RETURNING key, content_type, data, octet_length(data), revision, updated_at`,
			userID, key, contentType, data, expectedRevision,
		).Scan(&item.Key, &item.ContentType, &item.Data, &item.Size, &item.Revision, &item.UpdatedAt)
	} else {
		err = tx.QueryRow(ctx, `
			INSERT INTO user_blobs (user_id, key, content_type, data)
			VALUES ($1, $2, $3, $4)
			RETURNING key, content_type, data, octet_length(data), revision, updated_at`,
			userID, key, contentType, data,
		).Scan(&item.Key, &item.ContentType, &item.Data, &item.Size, &item.Revision, &item.UpdatedAt)
	}
	if errors.Is(err, pgx.ErrNoRows) || isUniqueViolation(err) {
		return domain.UserBlob{}, ErrConflict
	}
	if err != nil {
		return item, err
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.UserBlob{}, err
	}
	return item, nil
}

func (p *Postgres) DeleteBlob(ctx context.Context, userID, key string, expectedRevision int64) error {
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := lockBlobOwner(ctx, tx, userID); err != nil {
		return err
	}
	command, err := tx.Exec(ctx, `
		DELETE FROM user_blobs
		WHERE user_id = $1 AND key = $2 AND revision = $3`, userID, key, expectedRevision)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return ErrConflict
	}
	return tx.Commit(ctx)
}

func lockBlobOwner(ctx context.Context, tx pgx.Tx, userID string) error {
	var exists int
	err := tx.QueryRow(ctx, "SELECT 1 FROM users WHERE id = $1 FOR UPDATE", userID).Scan(&exists)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func (p *Postgres) InsertUsage(ctx context.Context, usage domain.UsageLog) error {
	if usage.ID == "" {
		usage.ID = uuid.NewString()
	}
	return insertUsage(ctx, p.pool, usage)
}

type usageExecer interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func insertUsage(ctx context.Context, executor usageExecer, usage domain.UsageLog) error {
	var modelID any
	if usage.ModelID != "" {
		modelID = usage.ModelID
	}
	var reservationID any
	if usage.BillingReservationID != "" {
		reservationID = usage.BillingReservationID
	}
	_, err := executor.Exec(ctx, `
		INSERT INTO usage_logs (
			id, user_id, model_id, character_id, character_name, provider, upstream_model, request_id,
			input_tokens, output_tokens, reasoning_tokens,
			cache_read_input_tokens, cache_creation_input_tokens, duration_ms, first_token_ms, error_code,
			billing_reservation_id, cost_microusd, charged_microusd
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
		usage.ID, usage.UserID, modelID, usage.CharacterID, usage.CharacterName,
		usage.Provider, usage.UpstreamModel, usage.RequestID,
		usage.InputTokens, usage.OutputTokens, usage.ReasoningTokens, usage.CacheReadInputTokens,
		usage.CacheCreationInputTokens, usage.DurationMS, usage.FirstTokenMS, usage.ErrorCode,
		reservationID, usage.CostMicrousd, usage.ChargedMicrousd)
	return err
}

func (p *Postgres) ListUsageLogs(ctx context.Context, userID string, limit, offset int) (domain.Page[domain.UsageLog], error) {
	var result domain.Page[domain.UsageLog]
	if err := p.pool.QueryRow(ctx, "SELECT count(*) FROM usage_logs WHERE user_id = $1", userID).Scan(&result.Total); err != nil {
		return result, err
	}
	rows, err := p.pool.Query(ctx, `
		SELECT id, COALESCE(model_id::text, ''), character_id, character_name,
		       provider, upstream_model, request_id, input_tokens, output_tokens,
		       reasoning_tokens, cache_read_input_tokens, cache_creation_input_tokens,
		       duration_ms, first_token_ms, error_code, cost_microusd,
		       charged_microusd, created_at
		FROM usage_logs
		WHERE user_id = $1
		ORDER BY created_at DESC, id DESC
		LIMIT $2 OFFSET $3`, userID, limit, offset)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var item domain.UsageLog
		var firstTokenMS pgtype.Int8
		if err := rows.Scan(
			&item.ID, &item.ModelID, &item.CharacterID, &item.CharacterName,
			&item.Provider, &item.UpstreamModel, &item.RequestID,
			&item.InputTokens, &item.OutputTokens, &item.ReasoningTokens,
			&item.CacheReadInputTokens, &item.CacheCreationInputTokens,
			&item.DurationMS, &firstTokenMS, &item.ErrorCode,
			&item.CostMicrousd, &item.ChargedMicrousd, &item.CreatedAt,
		); err != nil {
			return result, err
		}
		if firstTokenMS.Valid {
			item.FirstTokenMS = &firstTokenMS.Int64
		}
		result.Items = append(result.Items, item)
	}
	return result, rows.Err()
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
