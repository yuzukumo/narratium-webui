package store

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/yuzukumo/narratium-webui/backend/internal/domain"
	"github.com/yuzukumo/narratium-webui/backend/migrations"
)

const testDatabaseURLEnv = "TEST_DATABASE_URL"

func newPostgresIntegrationStore(t *testing.T) *Postgres {
	t.Helper()

	databaseURL := strings.TrimSpace(os.Getenv(testDatabaseURLEnv))
	if databaseURL == "" {
		t.Skipf("skipping PostgreSQL integration test: %s is not set", testDatabaseURLEnv)
	}

	setupCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	rootConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatalf("parse %s: %v", testDatabaseURLEnv, err)
	}
	rootConfig.MinConns = 0
	rootConfig.MaxConns = 2
	rootPool, err := pgxpool.NewWithConfig(setupCtx, rootConfig)
	if err != nil {
		t.Fatalf("open database from %s: %v", testDatabaseURLEnv, err)
	}
	t.Cleanup(rootPool.Close)
	if err := rootPool.Ping(setupCtx); err != nil {
		t.Fatalf("connect to database from %s: %v", testDatabaseURLEnv, err)
	}

	schema := "narratium_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	quotedSchema := pgx.Identifier{schema}.Sanitize()
	if _, err := rootPool.Exec(setupCtx, "CREATE SCHEMA "+quotedSchema); err != nil {
		t.Fatalf("create isolated PostgreSQL schema (the %s role needs CREATE on the database): %v", testDatabaseURLEnv, err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cleanupCancel()
		if _, err := rootPool.Exec(cleanupCtx, "DROP SCHEMA IF EXISTS "+quotedSchema+" CASCADE"); err != nil {
			t.Errorf("drop integration test schema %s: %v", schema, err)
		}
	})

	testConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatalf("parse %s for isolated pool: %v", testDatabaseURLEnv, err)
	}
	if testConfig.ConnConfig.RuntimeParams == nil {
		testConfig.ConnConfig.RuntimeParams = make(map[string]string)
	}
	testConfig.ConnConfig.RuntimeParams["search_path"] = quotedSchema
	testConfig.MinConns = 0
	testConfig.MaxConns = 20
	testPool, err := pgxpool.NewWithConfig(setupCtx, testConfig)
	if err != nil {
		t.Fatalf("open isolated PostgreSQL pool: %v", err)
	}
	t.Cleanup(testPool.Close)
	if err := testPool.Ping(setupCtx); err != nil {
		t.Fatalf("connect to isolated PostgreSQL schema: %v", err)
	}

	var currentSchema string
	if err := testPool.QueryRow(setupCtx, "SELECT current_schema()").Scan(&currentSchema); err != nil {
		t.Fatalf("read current PostgreSQL schema: %v", err)
	}
	if currentSchema != schema {
		t.Fatalf("isolated pool uses schema %q, want %q", currentSchema, schema)
	}

	return &Postgres{pool: testPool}
}

func newMigratedPostgresIntegrationStore(t *testing.T) (*Postgres, context.Context) {
	t.Helper()
	repository := newPostgresIntegrationStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	t.Cleanup(cancel)
	if err := repository.Migrate(ctx); err != nil {
		t.Fatalf("migrate isolated PostgreSQL schema: %v", err)
	}
	return repository, ctx
}

func applyEmbeddedMigration(t *testing.T, repository *Postgres, ctx context.Context, name string) {
	t.Helper()
	body, err := migrations.FS.ReadFile(name)
	if err != nil {
		t.Fatalf("read migration %s: %v", name, err)
	}
	tx, err := repository.pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin migration %s: %v", name, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, string(body)); err != nil {
		t.Fatalf("apply migration %s: %v", name, err)
	}
	if _, err := tx.Exec(ctx, "INSERT INTO schema_migrations (version) VALUES ($1)", name); err != nil {
		t.Fatalf("record migration %s: %v", name, err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit migration %s: %v", name, err)
	}
}

func TestPostgresConcurrentMigrationsAreSerialized(t *testing.T) {
	repository := newPostgresIntegrationStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	const runners = 8
	start := make(chan struct{})
	errorsByRunner := make(chan error, runners)
	var workers sync.WaitGroup
	workers.Add(runners)
	for range runners {
		go func() {
			defer workers.Done()
			<-start
			errorsByRunner <- repository.Migrate(ctx)
		}()
	}
	close(start)
	workers.Wait()
	close(errorsByRunner)
	for err := range errorsByRunner {
		if err != nil {
			t.Fatalf("concurrent migration failed: %v", err)
		}
	}

	entries, err := fs.ReadDir(migrations.FS, ".")
	if err != nil {
		t.Fatalf("read embedded migrations: %v", err)
	}
	wantCount := 0
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			wantCount++
		}
	}
	var gotCount int
	if err := repository.pool.QueryRow(ctx, "SELECT count(*) FROM schema_migrations").Scan(&gotCount); err != nil {
		t.Fatalf("count applied migrations: %v", err)
	}
	if gotCount != wantCount {
		t.Fatalf("applied migrations = %d, want %d", gotCount, wantCount)
	}
}

func TestPostgresMigrateUpgradesLegacyProviderSchema(t *testing.T) {
	repository := newPostgresIntegrationStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	applyEmbeddedMigration(t, repository, ctx, "0001_initial.sql")
	applyEmbeddedMigration(t, repository, ctx, "0002_usage_reasoning_tokens.sql")

	type providerExpectation struct {
		id            string
		provider      string
		wantFormat    string
		wantPromptKey bool
	}
	legacyProviders := []providerExpectation{
		{id: uuid.NewString(), provider: "openai", wantFormat: domain.ProviderAPIFormatResponses, wantPromptKey: true},
		{id: uuid.NewString(), provider: "anthropic", wantFormat: domain.ProviderAPIFormatMessages},
		{id: uuid.NewString(), provider: "gemini", wantFormat: domain.ProviderAPIFormatGenerateContent},
	}
	for _, item := range legacyProviders {
		if _, err := repository.pool.Exec(ctx, `
			INSERT INTO provider_configs (id, name, provider, base_url)
			VALUES ($1, $2, $3, $4)`,
			item.id, "Legacy "+item.provider, item.provider, "https://legacy.example"); err != nil {
			t.Fatalf("insert legacy %s provider: %v", item.provider, err)
		}
	}

	if err := repository.Migrate(ctx); err != nil {
		t.Fatalf("upgrade legacy provider schema: %v", err)
	}
	for _, item := range legacyProviders {
		var format string
		var promptKey bool
		if err := repository.pool.QueryRow(ctx, `
			SELECT api_format, prompt_cache_key_enabled
			FROM provider_configs WHERE id = $1`, item.id).Scan(&format, &promptKey); err != nil {
			t.Fatalf("load migrated %s provider: %v", item.provider, err)
		}
		if format != item.wantFormat || promptKey != item.wantPromptKey {
			t.Errorf("migrated %s provider format=%q prompt_cache_key=%v, want %q/%v",
				item.provider, format, promptKey, item.wantFormat, item.wantPromptKey)
		}
	}

	var staticDefaults int
	if err := repository.pool.QueryRow(ctx, `
		SELECT count(*)
		FROM information_schema.columns
		WHERE table_schema = current_schema()
		  AND table_name = 'provider_configs'
		  AND column_name IN ('api_format', 'prompt_cache_key_enabled')
		  AND column_default IS NOT NULL`).Scan(&staticDefaults); err != nil {
		t.Fatalf("inspect provider column defaults: %v", err)
	}
	if staticDefaults != 0 {
		t.Fatalf("provider configuration columns retain %d static defaults", staticDefaults)
	}

	providerID := uuid.NewString()
	var format string
	var promptKey bool
	if err := repository.pool.QueryRow(ctx, `
		INSERT INTO provider_configs (id, name, provider, base_url)
		VALUES ($1, 'Legacy writer', 'openai', 'https://legacy-writer.example')
		RETURNING api_format, prompt_cache_key_enabled`, providerID).Scan(&format, &promptKey); err != nil {
		t.Fatalf("legacy provider insert after upgrade: %v", err)
	}
	if format != domain.ProviderAPIFormatResponses || !promptKey {
		t.Fatalf("legacy OpenAI defaults = %q/%v, want responses/true", format, promptKey)
	}

	if err := repository.pool.QueryRow(ctx, `
		UPDATE provider_configs SET provider = 'anthropic' WHERE id = $1
		RETURNING api_format, prompt_cache_key_enabled`, providerID).Scan(&format, &promptKey); err != nil {
		t.Fatalf("change provider type using legacy update: %v", err)
	}
	if format != domain.ProviderAPIFormatMessages || promptKey {
		t.Fatalf("changed Anthropic defaults = %q/%v, want messages/false", format, promptKey)
	}

	if err := repository.pool.QueryRow(ctx, `
		UPDATE provider_configs
		SET provider = 'openai', api_format = 'chat_completions', prompt_cache_key_enabled = false
		WHERE id = $1
		RETURNING api_format, prompt_cache_key_enabled`, providerID).Scan(&format, &promptKey); err != nil {
		t.Fatalf("change provider type with explicit format: %v", err)
	}
	if format != domain.ProviderAPIFormatChatCompletions || promptKey {
		t.Fatalf("explicit OpenAI format = %q/%v, want chat_completions/false", format, promptKey)
	}
}

func TestPostgresMigrateExecutesEmbeddedMultiStatementSQL(t *testing.T) {
	repository := newPostgresIntegrationStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	if err := repository.Migrate(ctx); err != nil {
		t.Fatalf("first migration run: %v", err)
	}

	// These objects come from statements near the beginning, middle, and end of
	// the embedded migration, so this fails if only part of the SQL file runs.
	objects := []string{
		"users",
		"settings",
		"provider_configs",
		"models",
		"user_documents",
		"user_blobs",
		"usage_logs",
		"usage_logs_user_created_idx",
	}
	for _, object := range objects {
		var exists bool
		if err := repository.pool.QueryRow(ctx, "SELECT to_regclass($1) IS NOT NULL", object).Scan(&exists); err != nil {
			t.Fatalf("look up migrated object %q: %v", object, err)
		}
		if !exists {
			t.Errorf("migrated object %q does not exist", object)
		}
	}

	var registrationEnabled bool
	if err := repository.pool.QueryRow(ctx, `
		SELECT (value #>> '{}')::boolean
		FROM settings
		WHERE key = 'registration_enabled'`,
	).Scan(&registrationEnabled); err != nil {
		t.Fatalf("read setting seeded by migration: %v", err)
	}
	if !registrationEnabled {
		t.Error("registration_enabled seed is false, want true")
	}

	if err := repository.Migrate(ctx); err != nil {
		t.Fatalf("idempotent migration run: %v", err)
	}

	entries, err := fs.ReadDir(migrations.FS, ".")
	if err != nil {
		t.Fatalf("read embedded migrations: %v", err)
	}
	var wantVersions []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			wantVersions = append(wantVersions, entry.Name())
		}
	}

	rows, err := repository.pool.Query(ctx, "SELECT version FROM schema_migrations ORDER BY version")
	if err != nil {
		t.Fatalf("list applied migrations: %v", err)
	}
	defer rows.Close()
	var gotVersions []string
	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			t.Fatalf("scan applied migration: %v", err)
		}
		gotVersions = append(gotVersions, version)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate applied migrations: %v", err)
	}
	if !reflect.DeepEqual(gotVersions, wantVersions) {
		t.Fatalf("applied migrations = %v, want %v", gotVersions, wantVersions)
	}
}

func TestPostgresConcurrentFirstRegistrationCreatesExactlyOneAdmin(t *testing.T) {
	repository, ctx := newMigratedPostgresIntegrationStore(t)

	const registrationCount = 16
	type result struct {
		user domain.User
		err  error
	}
	start := make(chan struct{})
	results := make(chan result, registrationCount)
	var workers sync.WaitGroup
	workers.Add(registrationCount)
	for i := 0; i < registrationCount; i++ {
		name := fmt.Sprintf("concurrent-user-%02d", i)
		go func() {
			defer workers.Done()
			<-start
			user, err := repository.Register(ctx, name, name+"@example.com", "test-password-hash")
			results <- result{user: user, err: err}
		}()
	}
	close(start)
	workers.Wait()
	close(results)

	adminCount := 0
	userCount := 0
	for result := range results {
		if result.err != nil {
			t.Fatalf("concurrent registration failed: %v", result.err)
		}
		switch result.user.Role {
		case domain.RoleAdmin:
			adminCount++
		case domain.RoleUser:
			userCount++
		default:
			t.Errorf("registered user %q has unexpected role %q", result.user.Name, result.user.Role)
		}
	}
	if adminCount != 1 || userCount != registrationCount-1 {
		t.Fatalf("registered roles: admins=%d users=%d, want admins=1 users=%d", adminCount, userCount, registrationCount-1)
	}

	var storedUsers, storedAdmins int
	if err := repository.pool.QueryRow(ctx, `
		SELECT count(*), count(*) FILTER (WHERE role = 'admin')
		FROM users`,
	).Scan(&storedUsers, &storedAdmins); err != nil {
		t.Fatalf("count stored registration roles: %v", err)
	}
	if storedUsers != registrationCount || storedAdmins != 1 {
		t.Fatalf("stored roles: users=%d admins=%d, want users=%d admins=1", storedUsers, storedAdmins, registrationCount)
	}
}

func TestPostgresDocumentCompareAndSwapConflicts(t *testing.T) {
	repository, ctx := newMigratedPostgresIntegrationStore(t)
	user, err := repository.Register(ctx, "cas-user", "cas-user"+"@example.com", "test-password-hash")
	if err != nil {
		t.Fatalf("register CAS user: %v", err)
	}

	zero := int64(0)
	created, err := repository.PutDocument(ctx, user.ID, "characters_record", json.RawMessage(`{"writer":"initial"}`), &zero)
	if err != nil {
		t.Fatalf("create document at revision zero: %v", err)
	}
	if created.Revision != 1 {
		t.Fatalf("created revision = %d, want 1", created.Revision)
	}
	if _, err := repository.PutDocument(ctx, user.ID, "characters_record", json.RawMessage(`{"writer":"duplicate"}`), &zero); !errors.Is(err, ErrConflict) {
		t.Fatalf("second revision-zero create error = %v, want %v", err, ErrConflict)
	}

	type result struct {
		value json.RawMessage
		doc   domain.UserDocument
		err   error
	}
	values := []json.RawMessage{
		json.RawMessage(`{"writer":"one"}`),
		json.RawMessage(`{"writer":"two"}`),
	}
	start := make(chan struct{})
	results := make(chan result, len(values))
	var workers sync.WaitGroup
	workers.Add(len(values))
	for _, value := range values {
		value := value
		go func() {
			defer workers.Done()
			<-start
			doc, err := repository.PutDocument(ctx, user.ID, "characters_record", value, &created.Revision)
			results <- result{value: value, doc: doc, err: err}
		}()
	}
	close(start)
	workers.Wait()
	close(results)

	successes := 0
	conflicts := 0
	var winner json.RawMessage
	for result := range results {
		switch {
		case result.err == nil:
			successes++
			winner = result.value
			if result.doc.Revision != 2 {
				t.Errorf("winning CAS revision = %d, want 2", result.doc.Revision)
			}
		case errors.Is(result.err, ErrConflict):
			conflicts++
		default:
			t.Fatalf("CAS update failed with unexpected error: %v", result.err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("CAS results: successes=%d conflicts=%d, want one of each", successes, conflicts)
	}

	stored, err := repository.GetDocument(ctx, user.ID, "characters_record")
	if err != nil {
		t.Fatalf("get document after CAS race: %v", err)
	}
	if stored.Revision != 2 {
		t.Fatalf("stored revision = %d, want 2", stored.Revision)
	}
	requireJSONEqual(t, winner, stored.Value)

	if _, err := repository.PutDocument(ctx, user.ID, "characters_record", json.RawMessage(`{"writer":"stale"}`), &created.Revision); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale CAS error = %v, want %v", err, ErrConflict)
	}
	afterConflict, err := repository.GetDocument(ctx, user.ID, "characters_record")
	if err != nil {
		t.Fatalf("get document after stale CAS: %v", err)
	}
	if afterConflict.Revision != stored.Revision {
		t.Fatalf("revision after stale CAS = %d, want %d", afterConflict.Revision, stored.Revision)
	}
	requireJSONEqual(t, winner, afterConflict.Value)
}

func TestPostgresBlobCompareAndSwapAndPagination(t *testing.T) {
	repository, ctx := newMigratedPostgresIntegrationStore(t)
	user, err := repository.Register(ctx, "blob-cas-user", "blob-cas-user"+"@example.com", "test-password-hash")
	if err != nil {
		t.Fatalf("register blob CAS user: %v", err)
	}
	quota := BlobQuota{MaxCount: 10, MaxTotalBytes: 1 << 20}

	alpha, err := repository.PutBlob(ctx, user.ID, "alpha", "text/plain", []byte("one"), 0, quota)
	if err != nil {
		t.Fatalf("create alpha blob: %v", err)
	}
	if alpha.Revision != 1 || alpha.Size != 3 {
		t.Fatalf("created alpha revision=%d size=%d, want revision=1 size=3", alpha.Revision, alpha.Size)
	}
	beta, err := repository.PutBlob(ctx, user.ID, "beta", "text/plain", []byte("12345"), 0, quota)
	if err != nil {
		t.Fatalf("create beta blob: %v", err)
	}
	if beta.Size != 5 {
		t.Fatalf("created beta size=%d, want 5", beta.Size)
	}

	page, err := repository.ListBlobs(ctx, user.ID, 1, 1)
	if err != nil {
		t.Fatalf("list second blob page: %v", err)
	}
	if page.Total != 2 || len(page.Items) != 1 || page.Items[0].Key != "beta" || page.Items[0].Size != 5 {
		t.Fatalf("second blob page = %+v, want total=2 and beta metadata", page)
	}
	if page.Items[0].Data != nil {
		t.Fatal("blob list unexpectedly returned blob data")
	}
	if _, err := repository.PutBlob(ctx, user.ID, "alpha", "text/plain", []byte("duplicate"), 0, quota); !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate revision-zero blob create error = %v, want %v", err, ErrConflict)
	}

	type result struct {
		blob domain.UserBlob
		err  error
	}
	start := make(chan struct{})
	results := make(chan result, 2)
	var workers sync.WaitGroup
	for _, value := range [][]byte{[]byte("writer-one"), []byte("writer-two")} {
		value := value
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			blob, err := repository.PutBlob(ctx, user.ID, "alpha", "text/plain", value, alpha.Revision, quota)
			results <- result{blob: blob, err: err}
		}()
	}
	close(start)
	workers.Wait()
	close(results)

	successes := 0
	conflicts := 0
	var winningRevision int64
	for result := range results {
		switch {
		case result.err == nil:
			successes++
			winningRevision = result.blob.Revision
		case errors.Is(result.err, ErrConflict):
			conflicts++
		default:
			t.Fatalf("blob CAS update failed with unexpected error: %v", result.err)
		}
	}
	if successes != 1 || conflicts != 1 || winningRevision != 2 {
		t.Fatalf("blob CAS results: successes=%d conflicts=%d revision=%d, want 1, 1, 2", successes, conflicts, winningRevision)
	}
	if err := repository.DeleteBlob(ctx, user.ID, "alpha", alpha.Revision); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale blob delete error = %v, want %v", err, ErrConflict)
	}
	if err := repository.DeleteBlob(ctx, user.ID, "alpha", winningRevision); err != nil {
		t.Fatalf("delete blob at current revision: %v", err)
	}
	if err := repository.DeleteBlob(ctx, user.ID, "alpha", winningRevision); !errors.Is(err, ErrConflict) {
		t.Fatalf("repeat blob delete error = %v, want %v", err, ErrConflict)
	}
}

func TestPostgresBlobQuotasAreAtomicAndReplacementUsesNetBytes(t *testing.T) {
	repository, ctx := newMigratedPostgresIntegrationStore(t)
	countUser, err := repository.Register(ctx, "blob-count-quota-user", "blob-count-quota-user"+"@example.com", "test-password-hash")
	if err != nil {
		t.Fatalf("register blob count quota user: %v", err)
	}
	countQuota := BlobQuota{MaxCount: 1, MaxTotalBytes: 1 << 20}

	type quotaResult struct{ err error }
	start := make(chan struct{})
	results := make(chan quotaResult, 2)
	var workers sync.WaitGroup
	for _, key := range []string{"first", "second"} {
		key := key
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			_, err := repository.PutBlob(ctx, countUser.ID, key, "text/plain", []byte(key), 0, countQuota)
			results <- quotaResult{err: err}
		}()
	}
	close(start)
	workers.Wait()
	close(results)

	successes := 0
	quotaErrors := 0
	for result := range results {
		switch {
		case result.err == nil:
			successes++
		case errors.Is(result.err, ErrBlobCountQuota):
			quotaErrors++
		default:
			t.Fatalf("concurrent quota write failed with unexpected error: %v", result.err)
		}
	}
	if successes != 1 || quotaErrors != 1 {
		t.Fatalf("concurrent count quota results: successes=%d quota_errors=%d, want one each", successes, quotaErrors)
	}
	countPage, err := repository.ListBlobs(ctx, countUser.ID, 10, 0)
	if err != nil {
		t.Fatalf("list count quota blobs: %v", err)
	}
	if countPage.Total != 1 {
		t.Fatalf("stored blobs after count quota race = %d, want 1", countPage.Total)
	}

	bytesUser, err := repository.Register(ctx, "blob-bytes-quota-user", "blob-bytes-quota-user"+"@example.com", "test-password-hash")
	if err != nil {
		t.Fatalf("register blob bytes quota user: %v", err)
	}
	bytesQuota := BlobQuota{MaxCount: 10, MaxTotalBytes: 8}
	large, err := repository.PutBlob(ctx, bytesUser.ID, "large", "text/plain", []byte("123456"), 0, bytesQuota)
	if err != nil {
		t.Fatalf("create blob below total byte quota: %v", err)
	}
	if _, err := repository.PutBlob(ctx, bytesUser.ID, "extra", "text/plain", []byte("abc"), 0, bytesQuota); !errors.Is(err, ErrBlobTotalBytesQuota) {
		t.Fatalf("total byte quota error = %v, want %v", err, ErrBlobTotalBytesQuota)
	}
	shrunk, err := repository.PutBlob(ctx, bytesUser.ID, "large", "text/plain", []byte("12"), large.Revision, bytesQuota)
	if err != nil {
		t.Fatalf("shrink existing blob under total byte quota: %v", err)
	}
	if shrunk.Size != 2 || shrunk.Revision != 2 {
		t.Fatalf("shrunk blob revision=%d size=%d, want revision=2 size=2", shrunk.Revision, shrunk.Size)
	}
	if _, err := repository.PutBlob(ctx, bytesUser.ID, "extra", "text/plain", []byte("abc"), 0, bytesQuota); err != nil {
		t.Fatalf("create blob after replacement freed quota: %v", err)
	}
}

func TestPostgresUserDataIsCrossUserIsolated(t *testing.T) {
	repository, ctx := newMigratedPostgresIntegrationStore(t)
	alice, err := repository.Register(ctx, "isolation-alice", "isolation-alice"+"@example.com", "test-password-hash")
	if err != nil {
		t.Fatalf("register Alice: %v", err)
	}
	bob, err := repository.Register(ctx, "isolation-bob", "isolation-bob"+"@example.com", "test-password-hash")
	if err != nil {
		t.Fatalf("register Bob: %v", err)
	}

	aliceDocument := json.RawMessage(`{"owner":"alice"}`)
	bobDocument := json.RawMessage(`{"owner":"bob"}`)
	if _, err := repository.PutDocument(ctx, alice.ID, "preferences", aliceDocument, nil); err != nil {
		t.Fatalf("put Alice document: %v", err)
	}
	if _, err := repository.GetDocument(ctx, bob.ID, "preferences"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Bob reading Alice-only document error = %v, want %v", err, ErrNotFound)
	}
	if _, err := repository.PutDocument(ctx, bob.ID, "preferences", bobDocument, nil); err != nil {
		t.Fatalf("put Bob document with same namespace: %v", err)
	}
	aliceStored, err := repository.GetDocument(ctx, alice.ID, "preferences")
	if err != nil {
		t.Fatalf("get Alice document: %v", err)
	}
	bobStored, err := repository.GetDocument(ctx, bob.ID, "preferences")
	if err != nil {
		t.Fatalf("get Bob document: %v", err)
	}
	requireJSONEqual(t, aliceDocument, aliceStored.Value)
	requireJSONEqual(t, bobDocument, bobStored.Value)

	quota := BlobQuota{MaxCount: 10, MaxTotalBytes: 1 << 20}
	aliceCreated, err := repository.PutBlob(ctx, alice.ID, "shared-key", "text/plain", []byte("alice data"), 0, quota)
	if err != nil {
		t.Fatalf("put Alice blob: %v", err)
	}
	if _, err := repository.GetBlob(ctx, bob.ID, "shared-key"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Bob reading Alice-only blob error = %v, want %v", err, ErrNotFound)
	}
	if _, err := repository.PutBlob(ctx, bob.ID, "shared-key", "text/plain", []byte("bob data"), 0, quota); err != nil {
		t.Fatalf("put Bob blob with same key: %v", err)
	}
	aliceBlob, err := repository.GetBlob(ctx, alice.ID, "shared-key")
	if err != nil {
		t.Fatalf("get Alice blob: %v", err)
	}
	bobBlob, err := repository.GetBlob(ctx, bob.ID, "shared-key")
	if err != nil {
		t.Fatalf("get Bob blob: %v", err)
	}
	if !bytes.Equal(aliceBlob.Data, []byte("alice data")) || !bytes.Equal(bobBlob.Data, []byte("bob data")) {
		t.Fatalf("cross-user blob values: Alice=%q Bob=%q", aliceBlob.Data, bobBlob.Data)
	}
	aliceBlobs, err := repository.ListBlobs(ctx, alice.ID, 10, 0)
	if err != nil {
		t.Fatalf("list Alice blobs: %v", err)
	}
	bobBlobs, err := repository.ListBlobs(ctx, bob.ID, 10, 0)
	if err != nil {
		t.Fatalf("list Bob blobs: %v", err)
	}
	if aliceBlobs.Total != 1 || bobBlobs.Total != 1 || len(aliceBlobs.Items) != 1 || len(bobBlobs.Items) != 1 ||
		aliceBlobs.Items[0].Key != "shared-key" || bobBlobs.Items[0].Key != "shared-key" {
		t.Fatalf("cross-user blob lists: Alice=%v Bob=%v", aliceBlobs, bobBlobs)
	}

	if err := repository.DeleteBlob(ctx, alice.ID, "shared-key", aliceCreated.Revision); err != nil {
		t.Fatalf("delete Alice blob: %v", err)
	}
	if _, err := repository.GetBlob(ctx, alice.ID, "shared-key"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("read deleted Alice blob error = %v, want %v", err, ErrNotFound)
	}
	bobBlob, err = repository.GetBlob(ctx, bob.ID, "shared-key")
	if err != nil {
		t.Fatalf("Alice deletion affected Bob blob: %v", err)
	}
	if !bytes.Equal(bobBlob.Data, []byte("bob data")) {
		t.Fatalf("Bob blob after Alice deletion = %q, want %q", bobBlob.Data, "bob data")
	}
}

func TestPostgresProtectsLastActiveAdmin(t *testing.T) {
	repository, ctx := newMigratedPostgresIntegrationStore(t)
	admin, err := repository.Register(ctx, "primary-admin", "primary-admin"+"@example.com", "test-password-hash")
	if err != nil {
		t.Fatalf("register first admin: %v", err)
	}
	if admin.Role != domain.RoleAdmin {
		t.Fatalf("first user role = %q, want %q", admin.Role, domain.RoleAdmin)
	}

	if _, err := repository.UpdateUser(ctx, admin.ID, admin.Name, admin.Email, domain.RoleUser, domain.StatusActive); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("demote sole active admin error = %v, want %v", err, ErrLastAdmin)
	}
	if _, err := repository.UpdateUser(ctx, admin.ID, admin.Name, admin.Email, domain.RoleAdmin, domain.StatusDisabled); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("disable sole active admin error = %v, want %v", err, ErrLastAdmin)
	}
	unchanged, err := repository.UserByID(ctx, admin.ID)
	if err != nil {
		t.Fatalf("reload protected admin: %v", err)
	}
	if unchanged.Role != domain.RoleAdmin || unchanged.Status != domain.StatusActive || unchanged.TokenVersion != admin.TokenVersion {
		t.Fatalf("protected admin changed: role=%q status=%q token_version=%d", unchanged.Role, unchanged.Status, unchanged.TokenVersion)
	}

	backup, err := repository.Register(ctx, "backup-admin", "backup-admin"+"@example.com", "test-password-hash")
	if err != nil {
		t.Fatalf("register backup user: %v", err)
	}
	backup, err = repository.UpdateUser(ctx, backup.ID, backup.Name, backup.Email, domain.RoleAdmin, domain.StatusActive)
	if err != nil {
		t.Fatalf("promote backup admin: %v", err)
	}
	admin, err = repository.UpdateUser(ctx, admin.ID, admin.Name, admin.Email, domain.RoleUser, domain.StatusActive)
	if err != nil {
		t.Fatalf("demote admin while backup is active: %v", err)
	}
	if _, err := repository.UpdateUser(ctx, backup.ID, backup.Name, backup.Email, domain.RoleUser, domain.StatusActive); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("demote remaining active admin error = %v, want %v", err, ErrLastAdmin)
	}
	if _, err := repository.UpdateUser(ctx, backup.ID, backup.Name, backup.Email, domain.RoleAdmin, domain.StatusDisabled); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("disable remaining active admin error = %v, want %v", err, ErrLastAdmin)
	}

	admin, err = repository.UpdateUser(ctx, admin.ID, admin.Name, admin.Email, domain.RoleAdmin, domain.StatusActive)
	if err != nil {
		t.Fatalf("restore primary admin for concurrent test: %v", err)
	}
	type result struct {
		user domain.User
		err  error
	}
	start := make(chan struct{})
	results := make(chan result, 2)
	var workers sync.WaitGroup
	for _, id := range []string{admin.ID, backup.ID} {
		id := id
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			current, err := repository.UserByID(ctx, id)
			if err != nil {
				results <- result{err: err}
				return
			}
			user, err := repository.UpdateUser(ctx, id, current.Name, current.Email, domain.RoleUser, domain.StatusActive)
			results <- result{user: user, err: err}
		}()
	}
	close(start)
	workers.Wait()
	close(results)

	successes := 0
	lastAdminErrors := 0
	for result := range results {
		switch {
		case result.err == nil:
			successes++
		case errors.Is(result.err, ErrLastAdmin):
			lastAdminErrors++
		default:
			t.Fatalf("concurrent admin demotion failed with unexpected error: %v", result.err)
		}
	}
	if successes != 1 || lastAdminErrors != 1 {
		t.Fatalf("concurrent admin demotions: successes=%d last-admin-errors=%d, want one of each", successes, lastAdminErrors)
	}

	var activeAdmins int
	if err := repository.pool.QueryRow(ctx, `
		SELECT count(*)
		FROM users
		WHERE role = 'admin' AND status = 'active'`,
	).Scan(&activeAdmins); err != nil {
		t.Fatalf("count active admins: %v", err)
	}
	if activeAdmins != 1 {
		t.Fatalf("active admins after concurrent demotions = %d, want 1", activeAdmins)
	}
}

func createBillingTestModel(t *testing.T, repository *Postgres, ctx context.Context) domain.Model {
	t.Helper()
	providerConfig, err := repository.CreateProvider(ctx, domain.ProviderConfig{
		Name: "Billing provider", Provider: "openai", APIFormat: domain.ProviderAPIFormatResponses,
		BaseURL: "https://billing.example", APIKeyCiphertext: "encrypted-test-key",
		Models: []string{"billing-model"}, Enabled: true,
	})
	if err != nil {
		t.Fatalf("create billing provider: %v", err)
	}
	models, err := repository.ListModels(ctx, false)
	if err != nil {
		t.Fatalf("list billing models: %v", err)
	}
	for _, model := range models {
		if model.ProviderConfigID == providerConfig.ID && model.ExternalID == "billing-model" {
			return model
		}
	}
	t.Fatal("billing model not found")
	return domain.Model{}
}

func TestPostgresUpdatesUserIdentityAndPassword(t *testing.T) {
	repository, ctx := newMigratedPostgresIntegrationStore(t)
	admin, err := repository.Register(ctx, "identity-admin", "identity-admin"+"@example.com", "admin-password-hash")
	if err != nil {
		t.Fatalf("register admin: %v", err)
	}
	admin, err = repository.UpdateUser(ctx, admin.ID, admin.Name, "owner@example.com", admin.Role, admin.Status)
	if err != nil {
		t.Fatalf("set admin email: %v", err)
	}
	user, err := repository.Register(ctx, "identity-user", "identity-user"+"@example.com", "old-password-hash")
	if err != nil {
		t.Fatalf("register user: %v", err)
	}

	updated, err := repository.UpdateUser(ctx, user.ID, "renamed-user", "reader@example.com", user.Role, user.Status)
	if err != nil {
		t.Fatalf("update user identity: %v", err)
	}
	if updated.Name != "renamed-user" || updated.Email != "reader@example.com" {
		t.Fatalf("updated user identity = %q/%q", updated.Name, updated.Email)
	}
	if renamed, err := repository.UpdateUser(ctx, user.ID, strings.ToUpper(admin.Name), updated.Email, user.Role, user.Status); err != nil || renamed.Name != strings.ToUpper(admin.Name) {
		t.Fatalf("duplicate name should be allowed: user=%+v error=%v", renamed, err)
	}
	if _, err := repository.UpdateUser(ctx, user.ID, updated.Name, "OWNER@example.com", user.Role, user.Status); !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate email error = %v, want %v", err, ErrConflict)
	}

	reset, err := repository.UpdateUserPassword(ctx, user.ID, "replacement-password-hash")
	if err != nil {
		t.Fatalf("reset password: %v", err)
	}
	if reset.PasswordHash != "replacement-password-hash" || reset.TokenVersion != user.TokenVersion+1 {
		t.Fatalf("password reset hash/version = %q/%d", reset.PasswordHash, reset.TokenVersion)
	}
}

func TestPostgresDisabledProviderModelsAreUnavailable(t *testing.T) {
	repository, ctx := newMigratedPostgresIntegrationStore(t)
	model := createBillingTestModel(t, repository, ctx)
	if _, err := repository.ModelByID(ctx, model.ID); err != nil {
		t.Fatalf("load enabled provider model: %v", err)
	}

	providerConfig, err := repository.ProviderByID(ctx, model.ProviderConfigID)
	if err != nil {
		t.Fatalf("load provider: %v", err)
	}
	providerConfig.Enabled = false
	if _, err := repository.UpdateProvider(ctx, providerConfig); err != nil {
		t.Fatalf("disable provider: %v", err)
	}
	if _, err := repository.ModelByID(ctx, model.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("disabled provider model error = %v, want %v", err, ErrNotFound)
	}
	enabledModels, err := repository.ListModels(ctx, true)
	if err != nil {
		t.Fatalf("list enabled models: %v", err)
	}
	if len(enabledModels) != 0 {
		t.Fatalf("enabled model count = %d, want 0", len(enabledModels))
	}
	allModels, err := repository.ListModels(ctx, false)
	if err != nil || len(allModels) != 1 {
		t.Fatalf("all model count = %d error = %v, want preserved model", len(allModels), err)
	}
}

func TestPostgresBillingReservationAndSettlementAreAtomic(t *testing.T) {
	repository, ctx := newMigratedPostgresIntegrationStore(t)
	admin, err := repository.Register(ctx, "billing-admin", "billing-admin"+"@example.com", "password-hash")
	if err != nil {
		t.Fatalf("register admin: %v", err)
	}
	user, err := repository.Register(ctx, "billing-user", "billing-user"+"@example.com", "password-hash")
	if err != nil {
		t.Fatalf("register user: %v", err)
	}
	model := createBillingTestModel(t, repository, ctx)
	if _, _, err := repository.AdjustUserBalance(ctx, user.ID, admin.ID, 100, "initial credit"); err != nil {
		t.Fatalf("credit user: %v", err)
	}

	type reservationResult struct {
		reservation domain.BillingReservation
		err         error
	}
	start := make(chan struct{})
	results := make(chan reservationResult, 2)
	var workers sync.WaitGroup
	for _, requestID := range []string{"concurrent-a", "concurrent-b"} {
		requestID := requestID
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			reservation, err := repository.ReserveBalance(ctx, domain.BillingReservation{
				UserID: user.ID, ModelID: model.ID, RequestID: requestID,
				EstimatedCostMicrousd: 60, ExpiresAt: time.Now().Add(time.Minute),
			})
			results <- reservationResult{reservation: reservation, err: err}
		}()
	}
	close(start)
	workers.Wait()
	close(results)

	var winner domain.BillingReservation
	successes, insufficient := 0, 0
	for result := range results {
		switch {
		case result.err == nil:
			successes++
			winner = result.reservation
		case errors.Is(result.err, ErrInsufficientBalance):
			insufficient++
		default:
			t.Fatalf("reserve balance: %v", result.err)
		}
	}
	if successes != 1 || insufficient != 1 {
		t.Fatalf("reservation results: successes=%d insufficient=%d", successes, insufficient)
	}
	reservedUser, err := repository.UserByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("load reserved user: %v", err)
	}
	if reservedUser.ReservedMicrousd != 60 || reservedUser.AvailableBalanceMicrousd != 40 {
		t.Fatalf("reserved/available = %d/%d, want 60/40", reservedUser.ReservedMicrousd, reservedUser.AvailableBalanceMicrousd)
	}
	if _, _, err := repository.AdjustUserBalance(ctx, user.ID, admin.ID, -41, "too much"); !errors.Is(err, ErrInsufficientBalance) {
		t.Fatalf("reserved balance deduction error = %v, want %v", err, ErrInsufficientBalance)
	}
	if _, _, err := repository.AdjustUserBalance(ctx, user.ID, admin.ID, -40, "use available funds"); err != nil {
		t.Fatalf("deduct available balance: %v", err)
	}

	usage := domain.UsageLog{
		ModelID: model.ID, Provider: "openai", UpstreamModel: model.ExternalID,
		RequestID: winner.RequestID, InputTokens: 10, OutputTokens: 5, DurationMS: 100,
	}
	settlement, err := repository.FinalizeBilling(ctx, winner.ID, usage, 25)
	if err != nil {
		t.Fatalf("finalize billing: %v", err)
	}
	if settlement.ChargedMicrousd != 25 || settlement.BalanceMicrousd != 35 || settlement.AvailableBalanceMicrousd != 35 {
		t.Fatalf("settlement = %+v, want charge 25 and balance 35", settlement)
	}
	repeated, err := repository.FinalizeBilling(ctx, winner.ID, domain.UsageLog{RequestID: "must-not-insert"}, 99)
	if err != nil {
		t.Fatalf("repeat settlement: %v", err)
	}
	if repeated.CostMicrousd != settlement.CostMicrousd || repeated.ChargedMicrousd != settlement.ChargedMicrousd || repeated.BalanceMicrousd != settlement.BalanceMicrousd {
		t.Fatalf("repeat settlement = %+v, want original %+v", repeated, settlement)
	}

	var usageCount, chargeCount int
	if err := repository.pool.QueryRow(ctx, "SELECT count(*) FROM usage_logs WHERE billing_reservation_id = $1", winner.ID).Scan(&usageCount); err != nil {
		t.Fatalf("count usage rows: %v", err)
	}
	if err := repository.pool.QueryRow(ctx, "SELECT count(*) FROM balance_ledger WHERE usage_log_id IS NOT NULL AND user_id = $1", user.ID).Scan(&chargeCount); err != nil {
		t.Fatalf("count charge rows: %v", err)
	}
	if usageCount != 1 || chargeCount != 1 {
		t.Fatalf("usage/charge rows = %d/%d, want 1/1", usageCount, chargeCount)
	}
}

func TestPostgresQuotaAdjustmentModesRespectActiveReservations(t *testing.T) {
	repository, ctx := newMigratedPostgresIntegrationStore(t)
	admin, err := repository.Register(ctx, "quota-admin", "quota-admin"+"@example.com", "password-hash")
	if err != nil {
		t.Fatalf("register admin: %v", err)
	}
	user, err := repository.Register(ctx, "quota-user", "quota-user"+"@example.com", "password-hash")
	if err != nil {
		t.Fatalf("register user: %v", err)
	}
	model := createBillingTestModel(t, repository, ctx)
	user, added, err := repository.AdjustUserQuota(
		ctx, user.ID, admin.ID, domain.BalanceAdjustmentAdd, 100, "initial quota",
	)
	if err != nil || user.BalanceMicrousd != 100 || added.Kind != domain.LedgerKindQuotaAdd {
		t.Fatalf("add quota user=%+v entry=%+v err=%v", user, added, err)
	}
	reservation, err := repository.ReserveBalance(ctx, domain.BillingReservation{
		UserID: user.ID, ModelID: model.ID, RequestID: "quota-reservation",
		EstimatedCostMicrousd: 40, ExpiresAt: time.Now().Add(time.Minute),
	})
	if err != nil {
		t.Fatalf("reserve quota: %v", err)
	}
	if _, _, err := repository.AdjustUserQuota(
		ctx, user.ID, admin.ID, domain.BalanceAdjustmentSubtract, 61, "below reservation",
	); !errors.Is(err, ErrInsufficientBalance) {
		t.Fatalf("subtract below reservation error = %v, want %v", err, ErrInsufficientBalance)
	}
	user, subtracted, err := repository.AdjustUserQuota(
		ctx, user.ID, admin.ID, domain.BalanceAdjustmentSubtract, 60, "use available quota",
	)
	if err != nil || user.BalanceMicrousd != 40 || subtracted.Kind != domain.LedgerKindQuotaSubtract {
		t.Fatalf("subtract quota user=%+v entry=%+v err=%v", user, subtracted, err)
	}
	user, overwritten, err := repository.AdjustUserQuota(
		ctx, user.ID, admin.ID, domain.BalanceAdjustmentOverride, 40, "same quota",
	)
	if err != nil || user.BalanceMicrousd != 40 || overwritten.AmountMicrousd != 0 || overwritten.Kind != domain.LedgerKindQuotaOverride {
		t.Fatalf("override quota user=%+v entry=%+v err=%v", user, overwritten, err)
	}
	if err := repository.ReleaseBalanceReservation(ctx, reservation.ID); err != nil {
		t.Fatalf("release reservation: %v", err)
	}
	user, _, err = repository.AdjustUserQuota(
		ctx, user.ID, admin.ID, domain.BalanceAdjustmentOverride, 0, "clear quota",
	)
	if err != nil || user.BalanceMicrousd != 0 {
		t.Fatalf("clear quota user=%+v err=%v", user, err)
	}
}

func TestPostgresModelPriceMultiplierPreservesTrailingZeros(t *testing.T) {
	repository, ctx := newMigratedPostgresIntegrationStore(t)
	model := createBillingTestModel(t, repository, ctx)
	model.Pricing = domain.ModelPricing{
		InputMicrousdPerMillion: 2_000_000,
		PriceMultiplier:         "1.2300",
	}
	updated, err := repository.UpdateModel(ctx, model)
	if err != nil {
		t.Fatalf("update model pricing: %v", err)
	}
	if updated.Pricing.PriceMultiplier != "1.2300" {
		t.Fatalf("stored multiplier = %q, want 1.2300", updated.Pricing.PriceMultiplier)
	}
	if got := domain.CalculateUsageCost("openai", updated.Pricing, domain.UsageLog{InputTokens: 500_000}); got != 1_230_000 {
		t.Fatalf("multiplied model cost = %d microusd, want 1230000", got)
	}
}

func TestPostgresChatRunLifecyclePersistsReconnectState(t *testing.T) {
	repository, ctx := newMigratedPostgresIntegrationStore(t)
	admin, err := repository.Register(ctx, "run-admin", "run-admin"+"@example.com", "password-hash")
	if err != nil {
		t.Fatalf("register admin: %v", err)
	}
	user, err := repository.Register(ctx, "run-user", "run-user"+"@example.com", "password-hash")
	if err != nil {
		t.Fatalf("register user: %v", err)
	}
	model := createBillingTestModel(t, repository, ctx)
	if _, _, err := repository.AdjustUserQuota(
		ctx, user.ID, admin.ID, domain.BalanceAdjustmentAdd, 100, "run quota",
	); err != nil {
		t.Fatalf("add run quota: %v", err)
	}
	runID := uuid.NewString()
	reservation, err := repository.ReserveBalance(ctx, domain.BillingReservation{
		ID: runID, UserID: user.ID, ModelID: model.ID, RequestID: runID,
		EstimatedCostMicrousd: 20, ExpiresAt: time.Now().Add(time.Minute),
	})
	if err != nil {
		t.Fatalf("reserve run quota: %v", err)
	}
	run := domain.ChatRun{
		ID: runID, UserID: user.ID, CharacterID: "character-1", NodeID: "node-1",
		ParentNodeID: "root", UserMessage: "hello", ModelID: model.ID,
		ModelName: model.ExternalID, Provider: "openai", RequestID: runID,
		Status: domain.ChatRunStatusRunning,
	}
	if err := repository.CreateChatRun(ctx, run); err != nil {
		t.Fatalf("create chat run: %v", err)
	}
	if err := repository.AttachChatRunReservation(ctx, runID, reservation.ID); err != nil {
		t.Fatalf("attach chat run reservation: %v", err)
	}
	firstTokenMS := int64(25)
	if err := repository.UpdateChatRunProgress(ctx, runID, "partial", &firstTokenMS); err != nil {
		t.Fatalf("persist chat run progress: %v", err)
	}
	settlement, err := repository.FinalizeBilling(ctx, reservation.ID, domain.UsageLog{
		ModelID: model.ID, Provider: "openai", UpstreamModel: model.ExternalID,
		RequestID: runID, InputTokens: 4, OutputTokens: 2, DurationMS: 50,
	}, 5)
	if err != nil {
		t.Fatalf("settle chat run: %v", err)
	}
	completed, err := repository.FinishChatRun(ctx, runID, domain.ChatRunUpdate{
		Status: domain.ChatRunStatusCompleted, ResponseText: "complete",
		ProviderResponseID: "response-1", FinishReason: "completed",
		Usage: domain.ChatRunUsage{
			CostMicrousd: 5, InputTokens: 4, OutputTokens: 2, TotalTokens: 6,
			DurationMS: 50, FirstTokenMS: &firstTokenMS,
		},
		Billing: settlement,
	})
	if err != nil {
		t.Fatalf("finish chat run: %v", err)
	}
	if completed.Status != domain.ChatRunStatusCompleted || completed.ResponseText != "complete" ||
		completed.BillingReservationID != reservation.ID || completed.Usage.FirstTokenMS == nil ||
		*completed.Usage.FirstTokenMS != firstTokenMS || completed.Billing.ChargedMicrousd != 5 {
		t.Fatalf("completed chat run = %+v", completed)
	}
	pending, err := repository.ListPendingChatRuns(ctx, user.ID, "character-1")
	if err != nil || len(pending) != 1 || pending[0].ID != runID {
		t.Fatalf("pending chat runs=%+v err=%v", pending, err)
	}
	if err := repository.AcknowledgeChatRun(ctx, user.ID, runID); err != nil {
		t.Fatalf("acknowledge chat run: %v", err)
	}
	pending, err = repository.ListPendingChatRuns(ctx, user.ID, "character-1")
	if err != nil || len(pending) != 0 {
		t.Fatalf("pending chat runs after acknowledgement=%+v err=%v", pending, err)
	}
}

func TestPostgresFailedBillingSettlementRestoresAvailableBalance(t *testing.T) {
	repository, ctx := newMigratedPostgresIntegrationStore(t)
	admin, err := repository.Register(ctx, "failed-billing-admin", "failed-billing-admin"+"@example.com", "password-hash")
	if err != nil {
		t.Fatalf("register admin: %v", err)
	}
	user, err := repository.Register(ctx, "failed-billing-user", "failed-billing-user"+"@example.com", "password-hash")
	if err != nil {
		t.Fatalf("register user: %v", err)
	}
	model := createBillingTestModel(t, repository, ctx)
	if _, _, err := repository.AdjustUserBalance(ctx, user.ID, admin.ID, 90, "initial credit"); err != nil {
		t.Fatalf("credit user: %v", err)
	}
	reservation, err := repository.ReserveBalance(ctx, domain.BillingReservation{
		UserID: user.ID, ModelID: model.ID, RequestID: "failed-request",
		EstimatedCostMicrousd: 70, ExpiresAt: time.Now().Add(time.Minute),
	})
	if err != nil {
		t.Fatalf("reserve failed request: %v", err)
	}
	if _, err := repository.FinalizeBilling(ctx, reservation.ID, domain.UsageLog{
		ModelID: model.ID, Provider: "openai", UpstreamModel: model.ExternalID,
		RequestID: reservation.RequestID, ErrorCode: "provider_error", DurationMS: 20,
	}, 0); err != nil {
		t.Fatalf("settle failed request: %v", err)
	}
	settledUser, err := repository.UserByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("load settled user: %v", err)
	}
	if settledUser.BalanceMicrousd != 90 || settledUser.ReservedMicrousd != 0 || settledUser.AvailableBalanceMicrousd != 90 {
		t.Fatalf("failed request balance = %+v", settledUser)
	}
	var errorCode string
	if err := repository.pool.QueryRow(ctx, "SELECT error_code FROM usage_logs WHERE billing_reservation_id = $1", reservation.ID).Scan(&errorCode); err != nil {
		t.Fatalf("load failed usage: %v", err)
	}
	if errorCode != "provider_error" {
		t.Fatalf("failed usage error code = %q", errorCode)
	}
}

func TestPostgresConcurrentBillingSettlementsSerializePerUser(t *testing.T) {
	repository, ctx := newMigratedPostgresIntegrationStore(t)
	admin, err := repository.Register(ctx, "settlement-admin", "settlement-admin"+"@example.com", "password-hash")
	if err != nil {
		t.Fatalf("register admin: %v", err)
	}
	user, err := repository.Register(ctx, "settlement-user", "settlement-user"+"@example.com", "password-hash")
	if err != nil {
		t.Fatalf("register user: %v", err)
	}
	model := createBillingTestModel(t, repository, ctx)
	if _, _, err := repository.AdjustUserBalance(ctx, user.ID, admin.ID, 120, "initial credit"); err != nil {
		t.Fatalf("credit user: %v", err)
	}
	reservations := make([]domain.BillingReservation, 0, 2)
	for _, requestID := range []string{"settle-a", "settle-b"} {
		reservation, err := repository.ReserveBalance(ctx, domain.BillingReservation{
			UserID: user.ID, ModelID: model.ID, RequestID: requestID,
			EstimatedCostMicrousd: 60, ExpiresAt: time.Now().Add(time.Minute),
		})
		if err != nil {
			t.Fatalf("reserve %s: %v", requestID, err)
		}
		reservations = append(reservations, reservation)
	}

	start := make(chan struct{})
	errorsBySettlement := make(chan error, len(reservations))
	var workers sync.WaitGroup
	for _, reservation := range reservations {
		reservation := reservation
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			_, err := repository.FinalizeBilling(ctx, reservation.ID, domain.UsageLog{
				ModelID: model.ID, Provider: "openai", UpstreamModel: model.ExternalID,
				RequestID: reservation.RequestID, DurationMS: 50,
			}, 50)
			errorsBySettlement <- err
		}()
	}
	close(start)
	workers.Wait()
	close(errorsBySettlement)
	for err := range errorsBySettlement {
		if err != nil {
			t.Fatalf("concurrent settlement: %v", err)
		}
	}
	settledUser, err := repository.UserByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("load settled user: %v", err)
	}
	if settledUser.BalanceMicrousd != 20 || settledUser.ReservedMicrousd != 0 || settledUser.AvailableBalanceMicrousd != 20 {
		t.Fatalf("concurrent settlement balance = %+v", settledUser)
	}
}

func TestPostgresProviderModelUpdatePreservesCustomCapabilities(t *testing.T) {
	repository, ctx := newMigratedPostgresIntegrationStore(t)
	providerConfig, err := repository.CreateProvider(ctx, domain.ProviderConfig{
		Name: "Capability test", Provider: "openai", APIFormat: domain.ProviderAPIFormatResponses,
		PromptCacheKeyEnabled: true, BaseURL: "https://api.example.com",
		Models: []string{"gpt-5.5"}, Enabled: true,
	})
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}

	if _, err := repository.pool.Exec(ctx, `
		UPDATE models
		SET capabilities = capabilities || '{"custom_label":"preferred","output_token_limit":1}'::jsonb
		WHERE provider_config_id = $1 AND external_id = 'gpt-5.5'`, providerConfig.ID); err != nil {
		t.Fatalf("add custom model capabilities: %v", err)
	}

	providerConfig.Models = []string{"gpt-5.5", "gpt-5-mini"}
	if _, err := repository.UpdateProvider(ctx, providerConfig); err != nil {
		t.Fatalf("update provider models: %v", err)
	}
	models, err := repository.ListModels(ctx, false)
	if err != nil {
		t.Fatalf("list provider models: %v", err)
	}

	var preserved *domain.Model
	for i := range models {
		if models[i].ProviderConfigID == providerConfig.ID && models[i].ExternalID == "gpt-5.5" {
			preserved = &models[i]
			break
		}
	}
	if preserved == nil {
		t.Fatal("preserved GPT-5.5 model not found")
	}
	var capabilities map[string]any
	if err := json.Unmarshal(preserved.Capabilities, &capabilities); err != nil {
		t.Fatalf("decode preserved capabilities: %v", err)
	}
	if capabilities["custom_label"] != "preferred" || capabilities["output_token_limit"] != float64(1) {
		t.Fatalf("preserved capabilities=%v", capabilities)
	}
}

func TestPostgresStartsWithEmptyProviderCatalog(t *testing.T) {
	repository, ctx := newMigratedPostgresIntegrationStore(t)
	providers, err := repository.ListProviders(ctx)
	if err != nil || len(providers) != 0 {
		t.Fatalf("default providers=%d err=%v, want 0", len(providers), err)
	}

	create := func(name string) domain.ProviderConfig {
		t.Helper()
		item, err := repository.CreateProvider(ctx, domain.ProviderConfig{
			Name: name, Provider: "openai", APIFormat: domain.ProviderAPIFormatResponses,
			BaseURL: "https://example.test", Models: []string{name + "-model"}, Enabled: true,
		})
		if err != nil {
			t.Fatalf("create provider %s: %v", name, err)
		}
		return item
	}

	first := create("First")
	second := create("Second")
	if first.ChannelID != 1 || second.ChannelID != 2 {
		t.Fatalf("channel IDs = %d, %d; want 1, 2", first.ChannelID, second.ChannelID)
	}
	ordered, err := repository.ListProviders(ctx)
	if err != nil || len(ordered) != 2 || ordered[0].ChannelID != first.ChannelID || ordered[1].ChannelID != second.ChannelID {
		t.Fatalf("provider order=%v err=%v, want channel IDs [1 2]", ordered, err)
	}
	if _, err := repository.DeleteProvider(ctx, first.ID); err != nil {
		t.Fatalf("delete first provider: %v", err)
	}
	third := create("Third")
	if third.ChannelID <= second.ChannelID {
		t.Fatalf("channel ID reused after deletion: %d <= %d", third.ChannelID, second.ChannelID)
	}
}

func TestPostgresProviderCRUD(t *testing.T) {
	repository, ctx := newMigratedPostgresIntegrationStore(t)

	saved, err := repository.CreateProvider(ctx, domain.ProviderConfig{
		Name: "Local GLM", Provider: "openai", APIFormat: domain.ProviderAPIFormatChatCompletions,
		PromptCacheKeyEnabled: false, BaseURL: "https://local.example",
		Models: []string{"glm-5.2", "gpt-5.5"}, Enabled: true,
	})
	if err != nil {
		t.Fatalf("save provider: %v", err)
	}
	if saved.APIFormat != domain.ProviderAPIFormatChatCompletions {
		t.Fatalf("saved API format = %q", saved.APIFormat)
	}
	if !reflect.DeepEqual(saved.Models, []string{"glm-5.2", "gpt-5.5"}) {
		t.Fatalf("saved models = %v", saved.Models)
	}

	loaded, err := repository.ProviderByID(ctx, saved.ID)
	if err != nil {
		t.Fatalf("load provider: %v", err)
	}
	if loaded.APIFormat != domain.ProviderAPIFormatChatCompletions {
		t.Fatalf("loaded API format = %q", loaded.APIFormat)
	}
	if _, err := repository.CreateProvider(ctx, loaded); !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate provider create error = %v, want %v", err, ErrConflict)
	}

	loaded.Provider = "anthropic"
	loaded.APIFormat = domain.ProviderAPIFormatMessages
	loaded.PromptCacheKeyEnabled = false
	loaded.Models = []string{"claude-sonnet-4-5", "gpt-5.5"}
	loaded, err = repository.UpdateProvider(ctx, loaded)
	if err != nil {
		t.Fatalf("change provider type: %v", err)
	}
	if loaded.Provider != "anthropic" || loaded.APIFormat != domain.ProviderAPIFormatMessages {
		t.Fatalf("changed provider = %q/%q", loaded.Provider, loaded.APIFormat)
	}
	if !reflect.DeepEqual(loaded.Models, []string{"claude-sonnet-4-5", "gpt-5.5"}) {
		t.Fatalf("updated models = %v", loaded.Models)
	}
	if _, err := repository.pool.Exec(ctx, `
		INSERT INTO models (id, provider_config_id, external_id)
		VALUES ($1, $2, 'custom-model')`, uuid.NewString(), loaded.ID); err != nil {
		t.Fatalf("insert provider model: %v", err)
	}

	deleted, err := repository.DeleteProvider(ctx, loaded.ID)
	if err != nil {
		t.Fatalf("delete provider: %v", err)
	}
	if deleted.ID != loaded.ID {
		t.Fatalf("deleted provider ID = %q, want %q", deleted.ID, loaded.ID)
	}
	var modelCount int
	if err := repository.pool.QueryRow(ctx, "SELECT count(*) FROM models WHERE provider_config_id = $1", loaded.ID).Scan(&modelCount); err != nil {
		t.Fatalf("count models after provider delete: %v", err)
	}
	if modelCount != 0 {
		t.Fatalf("models after provider delete = %d, want 0", modelCount)
	}
	if _, err := repository.UpdateProvider(ctx, loaded); !errors.Is(err, ErrNotFound) {
		t.Fatalf("update deleted provider error = %v, want %v", err, ErrNotFound)
	}
}

func TestPostgresListUsageLogsFiltersAndPaginatesWithCharacterSnapshot(t *testing.T) {
	repository, ctx := newMigratedPostgresIntegrationStore(t)
	user, err := repository.Register(ctx, "usage-owner", "usage-owner"+"@example.com", "password-hash")
	if err != nil {
		t.Fatalf("register usage owner: %v", err)
	}
	other, err := repository.Register(ctx, "usage-other", "usage-other"+"@example.com", "password-hash")
	if err != nil {
		t.Fatalf("register other user: %v", err)
	}
	firstTokenMS := int64(640)
	if err := repository.InsertUsage(ctx, domain.UsageLog{
		ID: uuid.NewString(), UserID: user.ID, CharacterID: "character-old",
		CharacterName: "Older Story", Provider: "anthropic", UpstreamModel: "claude-fable-5",
		RequestID: "request-old", InputTokens: 50, OutputTokens: 20, DurationMS: 1500,
	}); err != nil {
		t.Fatalf("insert older usage: %v", err)
	}
	if err := repository.InsertUsage(ctx, domain.UsageLog{
		ID: uuid.NewString(), UserID: other.ID, CharacterID: "private-character",
		CharacterName: "Private Story", Provider: "google", UpstreamModel: "gemini-3.1-pro-preview",
		RequestID: "request-private", InputTokens: 999,
	}); err != nil {
		t.Fatalf("insert private usage: %v", err)
	}
	if err := repository.InsertUsage(ctx, domain.UsageLog{
		ID: uuid.NewString(), UserID: user.ID, CharacterID: "character-new",
		CharacterName: "Where Stars Are Tombs", Provider: "openai", UpstreamModel: "gpt-5.6",
		RequestID: "request-new", InputTokens: 1200, OutputTokens: 340, ReasoningTokens: 80,
		CacheReadInputTokens: 700, CacheCreationInputTokens: 220, DurationMS: 4321,
		FirstTokenMS: &firstTokenMS, CostMicrousd: 123456, ChargedMicrousd: 117283,
	}); err != nil {
		t.Fatalf("insert newer usage: %v", err)
	}

	firstPage, err := repository.ListUsageLogs(ctx, user.ID, 1, 0)
	if err != nil {
		t.Fatalf("list first usage page: %v", err)
	}
	if firstPage.Total != 2 || len(firstPage.Items) != 1 {
		t.Fatalf("first page=%+v, want one of two own records", firstPage)
	}
	got := firstPage.Items[0]
	if got.UserID != "" || got.CharacterID != "character-new" ||
		got.CharacterName != "Where Stars Are Tombs" || got.UpstreamModel != "gpt-5.6" ||
		got.InputTokens != 1200 || got.OutputTokens != 340 || got.ReasoningTokens != 80 ||
		got.CacheReadInputTokens != 700 || got.CacheCreationInputTokens != 220 ||
		got.FirstTokenMS == nil || *got.FirstTokenMS != firstTokenMS || got.DurationMS != 4321 ||
		got.CostMicrousd != 123456 || got.ChargedMicrousd != 117283 {
		t.Fatalf("newer usage=%+v", got)
	}

	secondPage, err := repository.ListUsageLogs(ctx, user.ID, 1, 1)
	if err != nil {
		t.Fatalf("list second usage page: %v", err)
	}
	if secondPage.Total != 2 || len(secondPage.Items) != 1 || secondPage.Items[0].CharacterID != "character-old" ||
		secondPage.Items[0].FirstTokenMS != nil {
		t.Fatalf("second page=%+v", secondPage)
	}
}

func requireJSONEqual(t *testing.T, want, got json.RawMessage) {
	t.Helper()
	var wantValue any
	if err := json.Unmarshal(want, &wantValue); err != nil {
		t.Fatalf("decode expected JSON %q: %v", want, err)
	}
	var gotValue any
	if err := json.Unmarshal(got, &gotValue); err != nil {
		t.Fatalf("decode actual JSON %q: %v", got, err)
	}
	if !reflect.DeepEqual(gotValue, wantValue) {
		t.Fatalf("JSON value = %s, want %s", got, want)
	}
}
