package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yuzukumo/narratium-webui/backend/internal/auth"
	"github.com/yuzukumo/narratium-webui/backend/internal/config"
	"github.com/yuzukumo/narratium-webui/backend/internal/domain"
	"github.com/yuzukumo/narratium-webui/backend/internal/secure"
	"github.com/yuzukumo/narratium-webui/backend/internal/store"
)

type testRepository struct {
	store.Repository
	mu                sync.Mutex
	users             map[string]domain.User
	providers         map[string]domain.ProviderConfig
	models            map[string]domain.Model
	documents         map[string]domain.UserDocument
	reservations      map[string]domain.BillingReservation
	chatRuns          map[string]domain.ChatRun
	ledger            map[string][]domain.BalanceLedgerEntry
	lastDocumentUID   string
	usage             []domain.UsageLog
	bootstrapState    *domain.BootstrapState
	verificationCodes map[string]struct {
		hash      string
		expiresAt time.Time
		attempts  int
	}
}

func newTestRepository() *testRepository {
	return &testRepository{
		users: make(map[string]domain.User), providers: make(map[string]domain.ProviderConfig),
		models: make(map[string]domain.Model), documents: make(map[string]domain.UserDocument),
		reservations: make(map[string]domain.BillingReservation), chatRuns: make(map[string]domain.ChatRun),
		ledger: make(map[string][]domain.BalanceLedgerEntry),
		verificationCodes: make(map[string]struct {
			hash      string
			expiresAt time.Time
			attempts  int
		}),
	}
}

func (r *testRepository) Health(context.Context) error { return nil }

func (r *testRepository) Bootstrap(context.Context) (domain.BootstrapState, error) {
	if r.bootstrapState != nil {
		return *r.bootstrapState, nil
	}
	return domain.BootstrapState{Initialized: len(r.users) > 0, RegistrationEnabled: true, EmailVerificationEnabled: false}, nil
}

func (r *testRepository) Register(_ context.Context, name, email, passwordHash string) (domain.User, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, user := range r.users {
		if strings.EqualFold(user.Email, email) {
			return domain.User{}, store.ErrConflict
		}
	}
	role := domain.RoleUser
	if len(r.users) == 0 {
		role = domain.RoleAdmin
	}
	user := domain.User{
		ID: uuid.NewString(), Name: name, Email: email, PasswordHash: passwordHash,
		Role: role, Status: domain.StatusActive, TokenVersion: 1,
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	r.users[user.ID] = user
	return user, nil
}

func (r *testRepository) UserByID(_ context.Context, id string) (domain.User, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	user, ok := r.users[id]
	if !ok {
		return domain.User{}, store.ErrNotFound
	}
	return r.userWithBalance(user), nil
}

func (r *testRepository) UserByEmail(_ context.Context, email string) (domain.User, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, user := range r.users {
		if strings.EqualFold(user.Email, email) {
			return r.userWithBalance(user), nil
		}
	}
	return domain.User{}, store.ErrNotFound
}

func (r *testRepository) ListUsers(_ context.Context, limit, offset int) (domain.Page[domain.User], error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	items := make([]domain.User, 0, len(r.users))
	for _, user := range r.users {
		items = append(items, r.userWithBalance(user))
	}
	if offset >= len(items) {
		return domain.Page[domain.User]{Items: []domain.User{}, Total: len(items)}, nil
	}
	end := min(offset+limit, len(items))
	return domain.Page[domain.User]{Items: items[offset:end], Total: len(items)}, nil
}

func (r *testRepository) UpdateUser(_ context.Context, id, name, email, role, status string) (domain.User, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	user, ok := r.users[id]
	if !ok {
		return domain.User{}, store.ErrNotFound
	}
	for otherID, other := range r.users {
		if otherID != id && email != "" && strings.EqualFold(other.Email, email) {
			return domain.User{}, store.ErrConflict
		}
	}
	removesLastAdmin := user.Role == domain.RoleAdmin && user.Status == domain.StatusActive &&
		(role != domain.RoleAdmin || status != domain.StatusActive)
	if removesLastAdmin {
		activeAdmins := 0
		for _, other := range r.users {
			if other.Role == domain.RoleAdmin && other.Status == domain.StatusActive {
				activeAdmins++
			}
		}
		if activeAdmins <= 1 {
			return domain.User{}, store.ErrLastAdmin
		}
	}
	if user.Role != role || user.Status != status {
		user.TokenVersion++
	}
	user.Name, user.Email, user.Role, user.Status = name, email, role, status
	r.users[id] = user
	return r.userWithBalance(user), nil
}

func (r *testRepository) RegistrationEnabled(context.Context) (bool, error) {
	state, _ := r.Bootstrap(context.Background())
	return state.RegistrationEnabled, nil
}

func (r *testRepository) SetRegistrationEnabled(_ context.Context, enabled bool) error {
	if r.bootstrapState == nil {
		r.bootstrapState = &domain.BootstrapState{Initialized: len(r.users) > 0, RegistrationEnabled: enabled}
	} else {
		r.bootstrapState.RegistrationEnabled = enabled
	}
	return nil
}

func (r *testRepository) EmailVerificationEnabled(context.Context) (bool, error) {
	state, _ := r.Bootstrap(context.Background())
	return state.EmailVerificationEnabled, nil
}

func (r *testRepository) SetEmailVerificationEnabled(_ context.Context, enabled bool) error {
	if r.bootstrapState == nil {
		r.bootstrapState = &domain.BootstrapState{Initialized: len(r.users) > 0, RegistrationEnabled: true}
	}
	r.bootstrapState.EmailVerificationEnabled = enabled
	return nil
}

func (r *testRepository) SaveEmailVerificationCode(_ context.Context, email, hash string, expiresAt time.Time) error {
	r.verificationCodes[email] = struct {
		hash      string
		expiresAt time.Time
		attempts  int
	}{hash: hash, expiresAt: expiresAt}
	return nil
}

func (r *testRepository) ConsumeEmailVerificationCode(_ context.Context, email, hash string, now time.Time) error {
	code, ok := r.verificationCodes[email]
	if !ok {
		return store.ErrInvalidVerification
	}
	if !now.Before(code.expiresAt) {
		delete(r.verificationCodes, email)
		return store.ErrVerificationExpired
	}
	if code.attempts >= 5 {
		return store.ErrVerificationLocked
	}
	if code.hash != hash {
		code.attempts++
		r.verificationCodes[email] = code
		return store.ErrInvalidVerification
	}
	delete(r.verificationCodes, email)
	return nil
}

func (r *testRepository) UpdateUserPassword(_ context.Context, id, passwordHash string) (domain.User, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	user, ok := r.users[id]
	if !ok {
		return domain.User{}, store.ErrNotFound
	}
	user.PasswordHash = passwordHash
	user.TokenVersion++
	r.users[id] = user
	return r.userWithBalance(user), nil
}

func (r *testRepository) AdjustUserBalance(_ context.Context, userID, actorUserID string, delta int64, note string) (domain.User, domain.BalanceLedgerEntry, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	user, ok := r.users[userID]
	if !ok {
		return domain.User{}, domain.BalanceLedgerEntry{}, store.ErrNotFound
	}
	reserved := r.reservedForUser(userID, "")
	if delta < 0 && (user.BalanceMicrousd < -delta || user.BalanceMicrousd+delta < reserved) {
		return domain.User{}, domain.BalanceLedgerEntry{}, store.ErrInsufficientBalance
	}
	user.BalanceMicrousd += delta
	r.users[userID] = user
	entry := domain.BalanceLedgerEntry{
		ID: "ledger-adjustment", UserID: userID, ActorUserID: actorUserID,
		Kind: domain.LedgerKindAdjustment, AmountMicrousd: delta,
		BalanceAfterMicrousd: user.BalanceMicrousd, Note: note, CreatedAt: time.Now(),
	}
	r.ledger[userID] = append([]domain.BalanceLedgerEntry{entry}, r.ledger[userID]...)
	return r.userWithBalance(user), entry, nil
}

func (r *testRepository) AdjustUserQuota(_ context.Context, userID, actorUserID, mode string, amount int64, note string) (domain.User, domain.BalanceLedgerEntry, error) {
	delta := amount
	kind := domain.LedgerKindQuotaAdd
	if mode == domain.BalanceAdjustmentSubtract {
		delta = -amount
		kind = domain.LedgerKindQuotaSubtract
	} else if mode == domain.BalanceAdjustmentOverride {
		kind = domain.LedgerKindQuotaOverride
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	user, ok := r.users[userID]
	if !ok {
		return domain.User{}, domain.BalanceLedgerEntry{}, store.ErrNotFound
	}
	if mode == domain.BalanceAdjustmentOverride {
		delta = amount - user.BalanceMicrousd
	}
	reserved := r.reservedForUser(userID, "")
	if user.BalanceMicrousd+delta < reserved || user.BalanceMicrousd+delta < 0 ||
		(delta == 0 && mode != domain.BalanceAdjustmentOverride) {
		return domain.User{}, domain.BalanceLedgerEntry{}, store.ErrInsufficientBalance
	}
	user.BalanceMicrousd += delta
	r.users[userID] = user
	entry := domain.BalanceLedgerEntry{
		ID: "ledger-quota", UserID: userID, ActorUserID: actorUserID,
		Kind: kind, AmountMicrousd: delta,
		BalanceAfterMicrousd: user.BalanceMicrousd, Note: note, CreatedAt: time.Now(),
	}
	r.ledger[userID] = append([]domain.BalanceLedgerEntry{entry}, r.ledger[userID]...)
	return r.userWithBalance(user), entry, nil
}

func (r *testRepository) ListBalanceLedger(_ context.Context, userID string, limit, offset int) (domain.Page[domain.BalanceLedgerEntry], error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	items := r.ledger[userID]
	if offset >= len(items) {
		return domain.Page[domain.BalanceLedgerEntry]{Items: []domain.BalanceLedgerEntry{}, Total: len(items)}, nil
	}
	end := min(offset+limit, len(items))
	return domain.Page[domain.BalanceLedgerEntry]{Items: append([]domain.BalanceLedgerEntry(nil), items[offset:end]...), Total: len(items)}, nil
}

func (r *testRepository) ReserveBalance(_ context.Context, reservation domain.BillingReservation) (domain.BillingReservation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	user, ok := r.users[reservation.UserID]
	if !ok {
		return domain.BillingReservation{}, store.ErrNotFound
	}
	if reservation.EstimatedCostMicrousd > user.BalanceMicrousd-r.reservedForUser(reservation.UserID, "") {
		return domain.BillingReservation{}, store.ErrInsufficientBalance
	}
	for _, existing := range r.reservations {
		if existing.UserID == reservation.UserID && existing.RequestID == reservation.RequestID {
			return domain.BillingReservation{}, store.ErrConflict
		}
	}
	if reservation.ID == "" {
		reservation.ID = "reservation-" + reservation.RequestID
	}
	reservation.Status = "active"
	reservation.CreatedAt = time.Now()
	r.reservations[reservation.ID] = reservation
	return reservation, nil
}

func (r *testRepository) FinalizeBilling(_ context.Context, reservationID string, usage domain.UsageLog, cost int64) (domain.BillingSettlement, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	reservation, ok := r.reservations[reservationID]
	if !ok {
		return domain.BillingSettlement{}, store.ErrNotFound
	}
	if reservation.Status != "active" {
		return domain.BillingSettlement{}, store.ErrReservationClosed
	}
	user := r.users[reservation.UserID]
	otherReserved := r.reservedForUser(reservation.UserID, reservationID)
	charged := min(cost, max(user.BalanceMicrousd-otherReserved, 0))
	user.BalanceMicrousd -= charged
	r.users[user.ID] = user
	reservation.Status = "settled"
	reservation.ActualCostMicrousd = cost
	reservation.ChargedMicrousd = charged
	reservation.BalanceAfterMicrousd = user.BalanceMicrousd
	r.reservations[reservationID] = reservation
	usage.UserID = user.ID
	usage.BillingReservationID = reservationID
	usage.CostMicrousd = cost
	usage.ChargedMicrousd = charged
	r.usage = append(r.usage, usage)
	return domain.BillingSettlement{
		CostMicrousd: cost, ChargedMicrousd: charged, UnbilledMicrousd: cost - charged,
		BalanceMicrousd: user.BalanceMicrousd, ReservedMicrousd: otherReserved,
		AvailableBalanceMicrousd: user.BalanceMicrousd - otherReserved,
	}, nil
}

func (r *testRepository) ReleaseBalanceReservation(_ context.Context, reservationID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	reservation, ok := r.reservations[reservationID]
	if !ok {
		return store.ErrNotFound
	}
	if reservation.Status == "active" {
		reservation.Status = "released"
		reservation.SettledAt = time.Now()
		r.reservations[reservationID] = reservation
	}
	return nil
}

func (r *testRepository) CreateChatRun(_ context.Context, run domain.ChatRun) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, existing := range r.chatRuns {
		if existing.ID == run.ID || existing.RequestID == run.RequestID ||
			(existing.UserID == run.UserID && existing.NodeID == run.NodeID) ||
			(existing.UserID == run.UserID && existing.CharacterID == run.CharacterID &&
				(existing.Status == domain.ChatRunStatusQueued || existing.Status == domain.ChatRunStatusRunning)) {
			return store.ErrConflict
		}
	}
	now := time.Now()
	if run.Status == "" {
		run.Status = domain.ChatRunStatusRunning
	}
	run.Revision = 1
	run.CreatedAt = now
	run.StartedAt = &now
	run.UpdatedAt = now
	r.chatRuns[run.ID] = run
	return nil
}

func (r *testRepository) AttachChatRunReservation(_ context.Context, runID, reservationID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	run, ok := r.chatRuns[runID]
	if !ok {
		return store.ErrNotFound
	}
	run.BillingReservationID = reservationID
	run.Revision++
	run.UpdatedAt = time.Now()
	r.chatRuns[runID] = run
	return nil
}

func (r *testRepository) ChatRunByID(_ context.Context, userID, runID string) (domain.ChatRun, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	run, ok := r.chatRuns[runID]
	if !ok || (userID != "" && run.UserID != userID) {
		return domain.ChatRun{}, store.ErrNotFound
	}
	return run, nil
}

func (r *testRepository) ListPendingChatRuns(_ context.Context, userID, characterID string) ([]domain.ChatRun, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	items := make([]domain.ChatRun, 0)
	for _, run := range r.chatRuns {
		if run.UserID == userID && run.CharacterID == characterID && !run.Acknowledged {
			items = append(items, run)
		}
	}
	return items, nil
}

func (r *testRepository) UpdateChatRunProgress(_ context.Context, runID, responseText string, firstTokenMS *int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	run, ok := r.chatRuns[runID]
	if !ok || (run.Status != domain.ChatRunStatusQueued && run.Status != domain.ChatRunStatusRunning) {
		return store.ErrNotFound
	}
	run.ResponseText = responseText
	if run.Usage.FirstTokenMS == nil && firstTokenMS != nil {
		value := *firstTokenMS
		run.Usage.FirstTokenMS = &value
	}
	run.Revision++
	run.UpdatedAt = time.Now()
	r.chatRuns[runID] = run
	return nil
}

func (r *testRepository) FinishChatRun(_ context.Context, runID string, update domain.ChatRunUpdate) (domain.ChatRun, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	run, ok := r.chatRuns[runID]
	if !ok {
		return domain.ChatRun{}, store.ErrNotFound
	}
	if run.Status != domain.ChatRunStatusQueued && run.Status != domain.ChatRunStatusRunning {
		return run, nil
	}
	now := time.Now()
	run.Status = update.Status
	run.ResponseText = update.ResponseText
	run.ProviderResponseID = update.ProviderResponseID
	run.FinishReason = update.FinishReason
	run.Usage = update.Usage
	run.Billing = update.Billing
	run.ErrorCode = update.ErrorCode
	run.ErrorMessage = update.ErrorMessage
	run.FinishedAt = &now
	run.UpdatedAt = now
	run.Revision++
	r.chatRuns[runID] = run
	return run, nil
}

func (r *testRepository) RequestChatRunCancel(_ context.Context, userID, runID string) (domain.ChatRun, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	run, ok := r.chatRuns[runID]
	if !ok || run.UserID != userID {
		return domain.ChatRun{}, store.ErrNotFound
	}
	if run.Status == domain.ChatRunStatusQueued || run.Status == domain.ChatRunStatusRunning {
		run.CancelRequested = true
		run.Revision++
		run.UpdatedAt = time.Now()
		r.chatRuns[runID] = run
	}
	return run, nil
}

func (r *testRepository) AcknowledgeChatRun(_ context.Context, userID, runID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	run, ok := r.chatRuns[runID]
	if !ok || run.UserID != userID {
		return store.ErrNotFound
	}
	now := time.Now()
	run.Acknowledged = true
	run.AcknowledgedAt = &now
	run.UpdatedAt = now
	run.Revision++
	r.chatRuns[runID] = run
	return nil
}

func (r *testRepository) RecoverChatRuns(_ context.Context) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, run := range r.chatRuns {
		if run.Status == domain.ChatRunStatusQueued || run.Status == domain.ChatRunStatusRunning {
			now := time.Now()
			run.Status = domain.ChatRunStatusFailed
			run.ErrorCode = "server_restart"
			run.FinishedAt = &now
			run.UpdatedAt = now
			run.Revision++
			r.chatRuns[id] = run
		}
	}
	return nil
}

func (r *testRepository) reservedForUser(userID, excludedID string) int64 {
	var reserved int64
	for id, reservation := range r.reservations {
		if id != excludedID && reservation.UserID == userID && reservation.Status == "active" && reservation.ExpiresAt.After(time.Now()) {
			reserved += reservation.EstimatedCostMicrousd
		}
	}
	return reserved
}

func (r *testRepository) userWithBalance(user domain.User) domain.User {
	user.ReservedMicrousd = r.reservedForUser(user.ID, "")
	user.AvailableBalanceMicrousd = max(user.BalanceMicrousd-user.ReservedMicrousd, 0)
	return user
}

func (r *testRepository) RevokeSessions(_ context.Context, id string, tokenVersion int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	user, ok := r.users[id]
	if !ok || user.TokenVersion != tokenVersion {
		return store.ErrConflict
	}
	user.TokenVersion++
	r.users[id] = user
	return nil
}

func (r *testRepository) ListProviders(context.Context) ([]domain.ProviderConfig, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	items := make([]domain.ProviderConfig, 0, len(r.providers))
	for _, item := range r.providers {
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].ChannelID == items[j].ChannelID {
			return items[i].ID < items[j].ID
		}
		return items[i].ChannelID < items[j].ChannelID
	})
	return items, nil
}

func (r *testRepository) ProviderByID(_ context.Context, id string) (domain.ProviderConfig, error) {
	item, ok := r.providers[id]
	if !ok {
		return domain.ProviderConfig{}, store.ErrNotFound
	}
	return item, nil
}

func (r *testRepository) CreateProvider(_ context.Context, item domain.ProviderConfig) (domain.ProviderConfig, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if item.ID == "" {
		item.ID = "provider-created"
	}
	if _, exists := r.providers[item.ID]; exists {
		return domain.ProviderConfig{}, store.ErrConflict
	}
	if item.ChannelID == 0 {
		for _, existing := range r.providers {
			if existing.ChannelID >= item.ChannelID {
				item.ChannelID = existing.ChannelID + 1
			}
		}
		if item.ChannelID == 0 {
			item.ChannelID = 1
		}
	}
	r.providers[item.ID] = item
	r.replaceProviderModels(item)
	return item, nil
}

func (r *testRepository) UpdateProvider(_ context.Context, item domain.ProviderConfig) (domain.ProviderConfig, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.providers[item.ID]; !exists {
		return domain.ProviderConfig{}, store.ErrNotFound
	}
	r.providers[item.ID] = item
	r.replaceProviderModels(item)
	return item, nil
}

func (r *testRepository) replaceProviderModels(provider domain.ProviderConfig) {
	wanted := make(map[string]struct{}, len(provider.Models))
	for _, externalID := range provider.Models {
		modelID := provider.ID + ":" + externalID
		wanted[modelID] = struct{}{}
		model, exists := r.models[modelID]
		if !exists {
			model = domain.Model{
				ID: modelID, ProviderConfigID: provider.ID,
				ExternalID: externalID, Capabilities: json.RawMessage(`{}`),
			}
		}
		model.Provider = provider.Provider
		model.ProviderName = provider.Name
		r.models[modelID] = model
	}
	for modelID, model := range r.models {
		if model.ProviderConfigID == provider.ID {
			if _, exists := wanted[modelID]; !exists {
				delete(r.models, modelID)
			}
		}
	}
}

func (r *testRepository) DeleteProvider(_ context.Context, id string) (domain.ProviderConfig, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	item, exists := r.providers[id]
	if !exists {
		return domain.ProviderConfig{}, store.ErrNotFound
	}
	delete(r.providers, id)
	for modelID, model := range r.models {
		if model.ProviderConfigID == id {
			delete(r.models, modelID)
		}
	}
	return item, nil
}

func (r *testRepository) ListModels(_ context.Context, availableOnly bool) ([]domain.Model, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var items []domain.Model
	for _, item := range r.models {
		if availableOnly {
			provider, ok := r.providers[item.ProviderConfigID]
			if !ok || !provider.Enabled || provider.APIKeyCiphertext == "" {
				continue
			}
		}
		items = append(items, item)
	}
	return items, nil
}

func (r *testRepository) ModelByID(_ context.Context, id string) (domain.Model, error) {
	item, ok := r.models[id]
	if !ok {
		return domain.Model{}, store.ErrNotFound
	}
	return item, nil
}

func (r *testRepository) UpdateModel(_ context.Context, item domain.Model) (domain.Model, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.models[item.ID]; !ok {
		return domain.Model{}, store.ErrNotFound
	}
	r.models[item.ID] = item
	return item, nil
}

func (r *testRepository) GetDocument(_ context.Context, userID, namespace string) (domain.UserDocument, error) {
	r.mu.Lock()
	r.lastDocumentUID = userID
	r.mu.Unlock()
	item, ok := r.documents[userID+":"+namespace]
	if !ok {
		return domain.UserDocument{}, store.ErrNotFound
	}
	return item, nil
}

func (r *testRepository) InsertUsage(_ context.Context, usage domain.UsageLog) error {
	r.mu.Lock()
	r.usage = append(r.usage, usage)
	r.mu.Unlock()
	return nil
}

func (r *testRepository) ListUsageLogs(_ context.Context, userID string, limit, offset int) (domain.Page[domain.UsageLog], error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	items := make([]domain.UsageLog, 0, len(r.usage))
	for index := len(r.usage) - 1; index >= 0; index-- {
		if r.usage[index].UserID == userID {
			items = append(items, r.usage[index])
		}
	}
	result := domain.Page[domain.UsageLog]{Total: len(items), Items: []domain.UsageLog{}}
	if offset >= len(items) {
		return result, nil
	}
	end := min(offset+limit, len(items))
	result.Items = append(result.Items, items[offset:end]...)
	return result, nil
}

type testServer struct {
	router  http.Handler
	auth    *auth.Service
	cryptor *secure.Cryptor
	cfg     config.Config
	client  *http.Client
	api     *API
}

func newHTTPTestServer(t *testing.T, repository store.Repository, mutate func(*config.Config)) testServer {
	t.Helper()
	cfg := config.Config{
		CookieName: "session", SessionTTL: time.Hour,
		JWTSecret:     []byte("01234567890123456789012345678901"),
		EncryptionKey: bytes.Repeat([]byte{0x42}, 32), StaticDir: t.TempDir(),
		MaxJSONBodyBytes: 1 << 20, MaxBlobBytes: 1 << 20, UpstreamTimeout: 5 * time.Second,
		AllowPrivateProviderHosts: true, AllowInsecureProviderHTTP: true,
	}
	if mutate != nil {
		mutate(&cfg)
	}
	cryptor, err := secure.NewCryptor(cfg.EncryptionKey)
	if err != nil {
		t.Fatal(err)
	}
	authService := auth.New(cfg.JWTSecret, cfg.SessionTTL)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	api := New(cfg, repository, authService, cryptor, logger)
	return testServer{router: api.Router(), auth: authService, cryptor: cryptor, cfg: cfg, client: api.client, api: api}
}

func (server testServer) cookie(t *testing.T, user domain.User) *http.Cookie {
	t.Helper()
	raw, _, err := server.auth.Issue(user)
	if err != nil {
		t.Fatal(err)
	}
	return &http.Cookie{Name: server.cfg.CookieName, Value: raw}
}

func TestAuthRejectsRevokedTokenVersion(t *testing.T) {
	repository := newTestRepository()
	original := domain.User{ID: "user-1", Name: "user", Role: domain.RoleUser, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[original.ID] = original
	server := newHTTPTestServer(t, repository, nil)
	cookie := server.cookie(t, original)
	updated := original
	updated.TokenVersion = 2
	repository.users[original.ID] = updated

	request := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAccountBindingRejectsDifferentSessionUser(t *testing.T) {
	repository := newTestRepository()
	user := domain.User{ID: "user-1", Name: "user", Role: domain.RoleUser, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[user.ID] = user
	server := newHTTPTestServer(t, repository, nil)

	request := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	request.AddCookie(server.cookie(t, user))
	request.Header.Set(accountBindingHeader, "a-different-user")
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), `"code":"account_changed"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestLogoutRevokesServerSession(t *testing.T) {
	repository := newTestRepository()
	user := domain.User{ID: "user-1", Name: "user", Role: domain.RoleUser, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[user.ID] = user
	server := newHTTPTestServer(t, repository, nil)
	cookie := server.cookie(t, user)

	logout := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	logout.AddCookie(cookie)
	logout.Header.Set(accountBindingHeader, user.ID)
	logoutResponse := httptest.NewRecorder()
	server.router.ServeHTTP(logoutResponse, logout)
	if logoutResponse.Code != http.StatusNoContent {
		t.Fatalf("logout status=%d body=%s", logoutResponse.Code, logoutResponse.Body.String())
	}

	me := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	me.AddCookie(cookie)
	meResponse := httptest.NewRecorder()
	server.router.ServeHTTP(meResponse, me)
	if meResponse.Code != http.StatusUnauthorized {
		t.Fatalf("old session status=%d body=%s", meResponse.Code, meResponse.Body.String())
	}
}

func TestFirstAdminRegistersWithoutBootstrapSecret(t *testing.T) {
	server := newHTTPTestServer(t, newTestRepository(), nil)
	body := `{"name":"first-admin","email":"first-admin@example.com","password":"a-secure-password"}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)
	if response.Code != http.StatusCreated || !strings.Contains(response.Body.String(), `"role":"admin"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestCORSPreflightAllowsBlobRevisionHeader(t *testing.T) {
	server := newHTTPTestServer(t, newTestRepository(), func(cfg *config.Config) {
		cfg.AllowedOrigins = []string{"https://app.example.com"}
	})
	request := httptest.NewRequest(http.MethodOptions, "/api/v1/blobs/image.png", nil)
	request.Header.Set("Origin", "https://app.example.com")
	request.Header.Set("Access-Control-Request-Method", http.MethodPut)
	request.Header.Set("Access-Control-Request-Headers", "if-match")
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Header().Get("Access-Control-Allow-Headers"), "If-Match") {
		t.Fatalf("allowed headers=%q", response.Header().Get("Access-Control-Allow-Headers"))
	}
}

func TestRegistrationPolicyCheckedBeforeCredentials(t *testing.T) {
	repository := newTestRepository()
	repository.bootstrapState = &domain.BootstrapState{Initialized: true, RegistrationEnabled: false}
	server := newHTTPTestServer(t, repository, nil)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"name":"x","password":"x"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"registration_disabled"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAdminRouteRejectsNormalUser(t *testing.T) {
	repository := newTestRepository()
	user := domain.User{ID: "user-1", Name: "user", Role: domain.RoleUser, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[user.ID] = user
	server := newHTTPTestServer(t, repository, nil)

	request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/providers", nil)
	request.AddCookie(server.cookie(t, user))
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAdminUpdatesUserAndPasswordResetRevokesOldSession(t *testing.T) {
	repository := newTestRepository()
	admin := domain.User{ID: "admin-1", Name: "admin", Role: domain.RoleAdmin, Status: domain.StatusActive, TokenVersion: 1}
	user := domain.User{ID: "user-1", Name: "reader", Role: domain.RoleUser, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[admin.ID] = admin
	repository.users[user.ID] = user
	server := newHTTPTestServer(t, repository, nil)
	oldUserCookie := server.cookie(t, user)

	profileRequest := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/users/user-1", strings.NewReader(
		`{"name":"renamed-reader","email":"reader@example.com","role":"user","status":"active"}`,
	))
	profileRequest.Header.Set("Content-Type", "application/json")
	profileRequest.AddCookie(server.cookie(t, admin))
	profileResponse := httptest.NewRecorder()
	server.router.ServeHTTP(profileResponse, profileRequest)
	if profileResponse.Code != http.StatusOK || !strings.Contains(profileResponse.Body.String(), `"email":"reader@example.com"`) {
		t.Fatalf("profile status=%d body=%s", profileResponse.Code, profileResponse.Body.String())
	}

	passwordRequest := httptest.NewRequest(http.MethodPut, "/api/v1/admin/users/user-1/password", strings.NewReader(
		`{"password":"replacement-password"}`,
	))
	passwordRequest.Header.Set("Content-Type", "application/json")
	passwordRequest.AddCookie(server.cookie(t, admin))
	passwordResponse := httptest.NewRecorder()
	server.router.ServeHTTP(passwordResponse, passwordRequest)
	if passwordResponse.Code != http.StatusOK {
		t.Fatalf("password status=%d body=%s", passwordResponse.Code, passwordResponse.Body.String())
	}
	resetUser := repository.users[user.ID]
	if resetUser.TokenVersion != 2 || resetUser.PasswordHash == "" || resetUser.PasswordHash == "replacement-password" {
		t.Fatalf("reset user version/hash = %d/%q", resetUser.TokenVersion, resetUser.PasswordHash)
	}

	meRequest := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	meRequest.AddCookie(oldUserCookie)
	meResponse := httptest.NewRecorder()
	server.router.ServeHTTP(meResponse, meRequest)
	if meResponse.Code != http.StatusUnauthorized {
		t.Fatalf("old user session status=%d body=%s", meResponse.Code, meResponse.Body.String())
	}
}

func TestAdminCannotDemoteLastActiveAdmin(t *testing.T) {
	repository := newTestRepository()
	admin := domain.User{ID: "admin-1", Name: "admin", Role: domain.RoleAdmin, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[admin.ID] = admin
	server := newHTTPTestServer(t, repository, nil)

	request := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/users/admin-1", strings.NewReader(`{"role":"user"}`))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(server.cookie(t, admin))
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), `"code":"last_admin"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if repository.users[admin.ID].Role != domain.RoleAdmin {
		t.Fatal("last active admin was demoted")
	}
}

func TestAdminAdjustsBalanceAndListsLedger(t *testing.T) {
	repository := newTestRepository()
	admin := domain.User{ID: "admin-1", Name: "admin", Role: domain.RoleAdmin, Status: domain.StatusActive, TokenVersion: 1}
	user := domain.User{ID: "user-1", Name: "reader", Role: domain.RoleUser, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[admin.ID] = admin
	repository.users[user.ID] = user
	server := newHTTPTestServer(t, repository, nil)

	adjustRequest := httptest.NewRequest(http.MethodPost, "/api/v1/admin/users/user-1/balance-adjustments", strings.NewReader(
		`{"mode":"add","amount_microusd":"1250000","note":"initial quota"}`,
	))
	adjustRequest.Header.Set("Content-Type", "application/json")
	adjustRequest.AddCookie(server.cookie(t, admin))
	adjustResponse := httptest.NewRecorder()
	server.router.ServeHTTP(adjustResponse, adjustRequest)
	if adjustResponse.Code != http.StatusCreated || !strings.Contains(adjustResponse.Body.String(), `"balance_microusd":"1250000"`) {
		t.Fatalf("adjust status=%d body=%s", adjustResponse.Code, adjustResponse.Body.String())
	}

	subtractRequest := httptest.NewRequest(http.MethodPost, "/api/v1/admin/users/user-1/balance-adjustments", strings.NewReader(
		`{"mode":"subtract","amount_microusd":"250000","note":"reduce quota"}`,
	))
	subtractRequest.Header.Set("Content-Type", "application/json")
	subtractRequest.AddCookie(server.cookie(t, admin))
	subtractResponse := httptest.NewRecorder()
	server.router.ServeHTTP(subtractResponse, subtractRequest)
	if subtractResponse.Code != http.StatusCreated || !strings.Contains(subtractResponse.Body.String(), `"balance_microusd":"1000000"`) {
		t.Fatalf("subtract status=%d body=%s", subtractResponse.Code, subtractResponse.Body.String())
	}

	overrideRequest := httptest.NewRequest(http.MethodPost, "/api/v1/admin/users/user-1/balance-adjustments", strings.NewReader(
		`{"mode":"override","amount_microusd":"2000000","note":"set quota"}`,
	))
	overrideRequest.Header.Set("Content-Type", "application/json")
	overrideRequest.AddCookie(server.cookie(t, admin))
	overrideResponse := httptest.NewRecorder()
	server.router.ServeHTTP(overrideResponse, overrideRequest)
	if overrideResponse.Code != http.StatusCreated || !strings.Contains(overrideResponse.Body.String(), `"balance_microusd":"2000000"`) {
		t.Fatalf("override status=%d body=%s", overrideResponse.Code, overrideResponse.Body.String())
	}

	deductRequest := httptest.NewRequest(http.MethodPost, "/api/v1/admin/users/user-1/balance-adjustments", strings.NewReader(
		`{"mode":"subtract","amount_microusd":"2000001","note":"too much"}`,
	))
	deductRequest.Header.Set("Content-Type", "application/json")
	deductRequest.AddCookie(server.cookie(t, admin))
	deductResponse := httptest.NewRecorder()
	server.router.ServeHTTP(deductResponse, deductRequest)
	if deductResponse.Code != http.StatusConflict || !strings.Contains(deductResponse.Body.String(), `"code":"insufficient_available_quota"`) {
		t.Fatalf("deduct status=%d body=%s", deductResponse.Code, deductResponse.Body.String())
	}

	ledgerRequest := httptest.NewRequest(http.MethodGet, "/api/v1/admin/users/user-1/balance-ledger", nil)
	ledgerRequest.AddCookie(server.cookie(t, admin))
	ledgerResponse := httptest.NewRecorder()
	server.router.ServeHTTP(ledgerResponse, ledgerRequest)
	if ledgerResponse.Code != http.StatusOK ||
		!strings.Contains(ledgerResponse.Body.String(), `"kind":"quota_add"`) ||
		!strings.Contains(ledgerResponse.Body.String(), `"kind":"quota_subtract"`) ||
		!strings.Contains(ledgerResponse.Body.String(), `"kind":"quota_override"`) {
		t.Fatalf("ledger status=%d body=%s", ledgerResponse.Code, ledgerResponse.Body.String())
	}
}

func TestUsageLogsArePrivatePaginatedAndSerializeMetrics(t *testing.T) {
	repository := newTestRepository()
	user := domain.User{ID: "user-1", Name: "reader", Role: domain.RoleUser, Status: domain.StatusActive, TokenVersion: 1}
	other := domain.User{ID: "user-2", Name: "other", Role: domain.RoleUser, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[user.ID] = user
	repository.users[other.ID] = other
	firstTokenMS := int64(875)
	repository.usage = []domain.UsageLog{
		{ID: "older", UserID: user.ID, UpstreamModel: "gpt-5.6", CreatedAt: time.Date(2026, 7, 12, 8, 0, 0, 0, time.UTC)},
		{ID: "private", UserID: other.ID, UpstreamModel: "other-model", CreatedAt: time.Date(2026, 7, 12, 8, 1, 0, 0, time.UTC)},
		{
			ID: "newer", UserID: user.ID, ModelID: "model-1", CharacterID: "character-1",
			CharacterName: "Where Stars Are Tombs", Provider: "openai", UpstreamModel: "gpt-5.6",
			RequestID: "request-1", InputTokens: 1200, OutputTokens: 340, ReasoningTokens: 80,
			CacheReadInputTokens: 700, CacheCreationInputTokens: 220, DurationMS: 4321,
			FirstTokenMS: &firstTokenMS, CostMicrousd: 123456, ChargedMicrousd: 117283,
			CreatedAt: time.Date(2026, 7, 12, 8, 2, 0, 0, time.UTC),
		},
	}
	server := newHTTPTestServer(t, repository, nil)

	request := httptest.NewRequest(http.MethodGet, "/api/v1/usage-logs?limit=1&offset=0", nil)
	request.AddCookie(server.cookie(t, user))
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var page domain.Page[domain.UsageLog]
	if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if page.Total != 2 || len(page.Items) != 1 {
		t.Fatalf("page=%+v, want one of two own records", page)
	}
	got := page.Items[0]
	if got.ID != "newer" || got.CharacterID != "character-1" || got.CharacterName != "Where Stars Are Tombs" ||
		got.UpstreamModel != "gpt-5.6" || got.InputTokens != 1200 || got.OutputTokens != 340 ||
		got.ReasoningTokens != 80 || got.CacheReadInputTokens != 700 || got.CacheCreationInputTokens != 220 ||
		got.DurationMS != 4321 || got.FirstTokenMS == nil || *got.FirstTokenMS != firstTokenMS ||
		got.CostMicrousd != 123456 || got.ChargedMicrousd != 117283 {
		t.Fatalf("serialized usage=%+v", got)
	}
	if strings.Contains(response.Body.String(), "private") || strings.Contains(response.Body.String(), "user-1") {
		t.Fatalf("response leaked private or internal user data: %s", response.Body.String())
	}

	secondRequest := httptest.NewRequest(http.MethodGet, "/api/v1/usage-logs?limit=1&offset=1", nil)
	secondRequest.AddCookie(server.cookie(t, user))
	secondResponse := httptest.NewRecorder()
	server.router.ServeHTTP(secondResponse, secondRequest)
	if secondResponse.Code != http.StatusOK || !strings.Contains(secondResponse.Body.String(), `"id":"older"`) {
		t.Fatalf("second page status=%d body=%s", secondResponse.Code, secondResponse.Body.String())
	}

	unauthenticated := httptest.NewRequest(http.MethodGet, "/api/v1/usage-logs", nil)
	unauthenticatedResponse := httptest.NewRecorder()
	server.router.ServeHTTP(unauthenticatedResponse, unauthenticated)
	if unauthenticatedResponse.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status=%d body=%s", unauthenticatedResponse.Code, unauthenticatedResponse.Body.String())
	}
}

func TestModelListEncodesEmptyItemsAsArray(t *testing.T) {
	repository := newTestRepository()
	user := domain.User{
		ID: "user-1", Name: "user", Role: domain.RoleUser,
		Status: domain.StatusActive, TokenVersion: 1,
	}
	repository.users[user.ID] = user
	server := newHTTPTestServer(t, repository, nil)

	request := httptest.NewRequest(http.MethodGet, "/api/v1/models", nil)
	request.AddCookie(server.cookie(t, user))
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("cache-control=%q, want private, no-store", response.Header().Get("Cache-Control"))
	}
	if strings.TrimSpace(response.Body.String()) != `{"items":[]}` {
		t.Fatalf("body=%s, want an empty JSON array", response.Body.String())
	}
}

func TestDocumentOwnerComesFromSession(t *testing.T) {
	repository := newTestRepository()
	user := domain.User{ID: "owner-1", Name: "owner", Role: domain.RoleUser, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[user.ID] = user
	repository.documents[user.ID+":characters_record"] = domain.UserDocument{
		Namespace: "characters_record", Value: json.RawMessage(`[{"id":"owned"}]`), Revision: 1,
	}
	server := newHTTPTestServer(t, repository, nil)

	request := httptest.NewRequest(http.MethodGet, "/api/v1/data/characters_record", nil)
	request.AddCookie(server.cookie(t, user))
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || repository.lastDocumentUID != user.ID {
		t.Fatalf("status=%d owner=%q body=%s", response.Code, repository.lastDocumentUID, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "another-user") {
		t.Fatal("cross-user data leaked")
	}
}

func TestProviderListNeverReturnsPlaintextOrCiphertext(t *testing.T) {
	repository := newTestRepository()
	admin := domain.User{ID: "admin-1", Name: "admin", Role: domain.RoleAdmin, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[admin.ID] = admin
	server := newHTTPTestServer(t, repository, nil)
	ciphertext, err := server.cryptor.Encrypt("sk-super-secret-value")
	if err != nil {
		t.Fatal(err)
	}
	repository.providers["provider-1"] = domain.ProviderConfig{
		ID: "provider-1", Name: "OpenAI", Provider: "openai", APIFormat: domain.ProviderAPIFormatResponses, BaseURL: "https://example.test",
		APIKeyCiphertext: ciphertext, Enabled: true,
	}
	repository.providers["provider-corrupt"] = domain.ProviderConfig{
		ID: "provider-corrupt", Name: "Old key", Provider: "openai", APIFormat: domain.ProviderAPIFormatResponses,
		BaseURL: "https://old-key.example", APIKeyCiphertext: "unreadable-ciphertext", Enabled: true,
	}

	request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/providers", nil)
	request.AddCookie(server.cookie(t, admin))
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)
	body := response.Body.String()
	if response.Code != http.StatusOK || strings.Contains(body, "sk-super-secret-value") ||
		strings.Contains(body, ciphertext) || strings.Contains(body, "unreadable-ciphertext") {
		t.Fatalf("status=%d body=%s", response.Code, body)
	}
	if strings.Count(body, `"has_api_key":true`) != 2 {
		t.Fatalf("masked key status missing: %s", body)
	}
}

func TestAdminCreatesOpenAIChatCompletionsProvider(t *testing.T) {
	repository := newTestRepository()
	admin := domain.User{ID: "admin-1", Name: "admin", Role: domain.RoleAdmin, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[admin.ID] = admin
	server := newHTTPTestServer(t, repository, nil)

	body := `{"name":"New API","provider":"openai","api_format":"chat_completions","base_url":"https://newapi.example/","models":["glm-5.2"," gpt-5.5 ","glm-5.2"],"api_key":"test-secret","enabled":true}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/providers", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(server.cookie(t, admin))
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	saved := repository.providers["provider-created"]
	if saved.APIFormat != domain.ProviderAPIFormatChatCompletions {
		t.Fatalf("saved API format=%q", saved.APIFormat)
	}
	if saved.BaseURL != "https://newapi.example" {
		t.Fatalf("saved base URL=%q, want normalized URL", saved.BaseURL)
	}
	if saved.PromptCacheKeyEnabled {
		t.Fatal("prompt_cache_key should be disabled for this compatibility provider")
	}
	if len(saved.Models) != 2 || saved.Models[0] != "glm-5.2" || saved.Models[1] != "gpt-5.5" {
		t.Fatalf("saved models=%v, want normalized model IDs", saved.Models)
	}
	if len(repository.models) != 2 {
		t.Fatalf("saved model records=%d, want 2", len(repository.models))
	}
	if saved.APIKeyCiphertext == "" || saved.APIKeyCiphertext == "test-secret" {
		t.Fatal("provider API key was not encrypted")
	}
	if strings.Contains(response.Body.String(), "test-secret") || strings.Contains(response.Body.String(), saved.APIKeyCiphertext) {
		t.Fatalf("provider response leaked a secret: %s", response.Body.String())
	}

	listRequest := httptest.NewRequest(http.MethodGet, "/api/v1/admin/models", nil)
	listRequest.AddCookie(server.cookie(t, admin))
	listResponse := httptest.NewRecorder()
	server.router.ServeHTTP(listResponse, listRequest)
	if listResponse.Code != http.StatusOK ||
		!strings.Contains(listResponse.Body.String(), `"external_id":"glm-5.2"`) ||
		!strings.Contains(listResponse.Body.String(), `"external_id":"gpt-5.5"`) {
		t.Fatalf("model list status=%d body=%s", listResponse.Code, listResponse.Body.String())
	}
}

func TestAdminProviderCreateRequiresModels(t *testing.T) {
	repository := newTestRepository()
	admin := domain.User{ID: "admin-1", Name: "admin", Role: domain.RoleAdmin, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[admin.ID] = admin
	server := newHTTPTestServer(t, repository, nil)

	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/providers", strings.NewReader(
		`{"name":"No models","provider":"openai","base_url":"https://api.example.com","api_key":"secret"}`,
	))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(server.cookie(t, admin))
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"invalid_request"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAdminProviderUpdateReplacesModels(t *testing.T) {
	repository := newTestRepository()
	admin := domain.User{ID: "admin-1", Name: "admin", Role: domain.RoleAdmin, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[admin.ID] = admin
	repository.providers["provider-1"] = domain.ProviderConfig{
		ID: "provider-1", Name: "Gateway", Provider: "openai", APIFormat: domain.ProviderAPIFormatResponses,
		BaseURL: "https://gateway.example", APIKeyCiphertext: "encrypted", Models: []string{"keep-model", "old-model"}, Enabled: true,
	}
	repository.replaceProviderModels(repository.providers["provider-1"])
	repository.models["provider-1:keep-model"] = domain.Model{
		ID: "provider-1:keep-model", ProviderConfigID: "provider-1", Provider: "openai",
		ProviderName: "Gateway", ExternalID: "keep-model",
		Capabilities: json.RawMessage(`{"reasoning":true}`),
	}
	server := newHTTPTestServer(t, repository, nil)

	request := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/providers/provider-1", strings.NewReader(
		`{"models":["keep-model","new-model"]}`,
	))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(server.cookie(t, admin))
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if _, exists := repository.models["provider-1:old-model"]; exists {
		t.Fatal("removed model remains in repository")
	}
	if _, exists := repository.models["provider-1:new-model"]; !exists {
		t.Fatal("new model was not created")
	}
	if string(repository.models["provider-1:keep-model"].Capabilities) != `{"reasoning":true}` {
		t.Fatal("unchanged model capabilities were discarded")
	}

	modelsRequest := httptest.NewRequest(http.MethodGet, "/api/v1/models", nil)
	modelsRequest.AddCookie(server.cookie(t, admin))
	modelsResponse := httptest.NewRecorder()
	server.router.ServeHTTP(modelsResponse, modelsRequest)
	if modelsResponse.Code != http.StatusOK || strings.Contains(modelsResponse.Body.String(), "display_name") {
		t.Fatalf("status=%d body=%s", modelsResponse.Code, modelsResponse.Body.String())
	}
	if strings.Contains(modelsResponse.Body.String(), `"external_id":"new-model"`) {
		t.Fatalf("unconfigured model was exposed to users: %s", modelsResponse.Body.String())
	}
}

func TestAdminCanListAndConfigureModels(t *testing.T) {
	repository := newTestRepository()
	admin := domain.User{ID: "admin-1", Name: "admin", Role: domain.RoleAdmin, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[admin.ID] = admin
	repository.providers["provider-1"] = domain.ProviderConfig{
		ID: "provider-1", Name: "Primary", Provider: "openai",
		APIFormat: domain.ProviderAPIFormatResponses, BaseURL: "https://gateway.example",
		APIKeyCiphertext: "encrypted", Enabled: true,
	}
	repository.models["model-1"] = domain.Model{
		ID: "model-1", ProviderConfigID: "provider-1", Provider: "openai", ProviderName: "Primary",
		ExternalID: "gpt-test", Capabilities: domain.DefaultModelCapabilities("openai").JSON(),
	}
	server := newHTTPTestServer(t, repository, nil)

	listRequest := httptest.NewRequest(http.MethodGet, "/api/v1/admin/models", nil)
	listRequest.AddCookie(server.cookie(t, admin))
	listResponse := httptest.NewRecorder()
	server.router.ServeHTTP(listResponse, listRequest)
	if listResponse.Code != http.StatusOK || !strings.Contains(listResponse.Body.String(), `"external_id":"gpt-test"`) {
		t.Fatalf("status=%d body=%s", listResponse.Code, listResponse.Body.String())
	}

	body := `{"capabilities":{"schema_version":2,"context_window":64000,"compaction_threshold":60000,"max_output_tokens":8192,"reasoning":{"enabled":true,"effort":"provider_custom"}}}`
	updateRequest := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/models/model-1", strings.NewReader(body))
	updateRequest.Header.Set("Content-Type", "application/json")
	updateRequest.AddCookie(server.cookie(t, admin))
	updateResponse := httptest.NewRecorder()
	server.router.ServeHTTP(updateResponse, updateRequest)
	if updateResponse.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", updateResponse.Code, updateResponse.Body.String())
	}
	capabilities, err := domain.ParseModelCapabilities(repository.models["model-1"].Capabilities, "openai")
	if err != nil || capabilities.ContextWindow != 64000 || capabilities.CompactionThreshold != 60000 || capabilities.Reasoning.Effort != "provider_custom" {
		t.Fatalf("capabilities=%+v err=%v", capabilities, err)
	}

	legacyRequest := httptest.NewRequest(http.MethodPost, "/api/v1/admin/providers/provider-1/models/sync", nil)
	legacyRequest.AddCookie(server.cookie(t, admin))
	legacyResponse := httptest.NewRecorder()
	server.router.ServeHTTP(legacyResponse, legacyRequest)
	if legacyResponse.Code != http.StatusNotFound {
		t.Fatalf("legacy sync status=%d, want 404", legacyResponse.Code)
	}
}

func TestAdminModelListRequiresEnabledProviderKey(t *testing.T) {
	repository := newTestRepository()
	admin := domain.User{ID: "admin-1", Name: "admin", Role: domain.RoleAdmin, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[admin.ID] = admin
	repository.providers["provider-available"] = domain.ProviderConfig{
		ID: "provider-available", Name: "Available gateway", Provider: "openai",
		APIFormat: domain.ProviderAPIFormatResponses, BaseURL: "https://gateway.example",
		APIKeyCiphertext: "encrypted", Enabled: true,
	}
	repository.providers["provider-no-key"] = domain.ProviderConfig{
		ID: "provider-no-key", Name: "Unconfigured gateway", Provider: "openai",
		APIFormat: domain.ProviderAPIFormatResponses, BaseURL: "https://gateway.example", Enabled: true,
	}
	repository.providers["provider-disabled"] = domain.ProviderConfig{
		ID: "provider-disabled", Name: "Disabled gateway", Provider: "openai",
		APIFormat: domain.ProviderAPIFormatResponses, BaseURL: "https://gateway.example",
		APIKeyCiphertext: "encrypted", Enabled: false,
	}
	repository.models["model-available"] = domain.Model{
		ID: "model-available", ProviderConfigID: "provider-available", Provider: "openai",
		ProviderName: "Available gateway", ExternalID: "available-model",
		Capabilities: json.RawMessage(`{}`),
	}
	repository.models["model-no-key"] = domain.Model{
		ID: "model-no-key", ProviderConfigID: "provider-no-key", Provider: "openai",
		ProviderName: "Unconfigured gateway", ExternalID: "no-key-model",
		Capabilities: json.RawMessage(`{}`),
	}
	repository.models["model-disabled"] = domain.Model{
		ID: "model-disabled", ProviderConfigID: "provider-disabled", Provider: "openai",
		ProviderName: "Disabled gateway", ExternalID: "disabled-model",
		Capabilities: json.RawMessage(`{}`),
	}
	server := newHTTPTestServer(t, repository, nil)

	adminRequest := httptest.NewRequest(http.MethodGet, "/api/v1/admin/models", nil)
	adminRequest.AddCookie(server.cookie(t, admin))
	adminResponse := httptest.NewRecorder()
	server.router.ServeHTTP(adminResponse, adminRequest)
	body := adminResponse.Body.String()
	if adminResponse.Code != http.StatusOK || !strings.Contains(body, `"external_id":"available-model"`) ||
		strings.Contains(body, `"external_id":"no-key-model"`) || strings.Contains(body, `"external_id":"disabled-model"`) {
		t.Fatalf("admin status=%d body=%s", adminResponse.Code, adminResponse.Body.String())
	}
}

func TestAdminModelRoutesRequireAdmin(t *testing.T) {
	repository := newTestRepository()
	user := domain.User{ID: "user-1", Name: "user", Role: domain.RoleUser, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[user.ID] = user
	repository.models["model-1"] = domain.Model{
		ID: "model-1", ProviderConfigID: "provider-1", Provider: "openai",
		ExternalID: "gpt-test", Capabilities: domain.DefaultModelCapabilities("openai").JSON(),
	}
	server := newHTTPTestServer(t, repository, nil)

	tests := []struct {
		method string
		path   string
		body   string
	}{
		{method: http.MethodGet, path: "/api/v1/admin/models"},
		{method: http.MethodPatch, path: "/api/v1/admin/models/model-1", body: `{"enabled":false}`},
	}
	for _, test := range tests {
		request := httptest.NewRequest(test.method, test.path, strings.NewReader(test.body))
		request.Header.Set("Content-Type", "application/json")
		request.AddCookie(server.cookie(t, user))
		response := httptest.NewRecorder()
		server.router.ServeHTTP(response, request)
		if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"admin_required"`) {
			t.Fatalf("%s %s status=%d body=%s", test.method, test.path, response.Code, response.Body.String())
		}
	}
}

func TestAdminRejectsInvalidModelCapabilities(t *testing.T) {
	repository := newTestRepository()
	admin := domain.User{ID: "admin-1", Name: "admin", Role: domain.RoleAdmin, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[admin.ID] = admin
	repository.models["model-1"] = domain.Model{
		ID: "model-1", ProviderConfigID: "provider-1", Provider: "openai",
		ExternalID: "gpt-test", Capabilities: domain.DefaultModelCapabilities("openai").JSON(),
	}
	server := newHTTPTestServer(t, repository, nil)

	body := `{"capabilities":{"schema_version":2,"context_window":100,"compaction_threshold":90,"max_output_tokens":200,"reasoning":{"enabled":true,"effort":"low"}}}`
	request := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/models/model-1", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(server.cookie(t, admin))
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"invalid_model_capabilities"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAdminCanChangeProviderTypeAndKeepItsSecret(t *testing.T) {
	repository := newTestRepository()
	admin := domain.User{ID: "admin-1", Name: "admin", Role: domain.RoleAdmin, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[admin.ID] = admin
	server := newHTTPTestServer(t, repository, nil)
	ciphertext, err := server.cryptor.Encrypt("openai-only-secret")
	if err != nil {
		t.Fatal(err)
	}
	repository.providers["provider-1"] = domain.ProviderConfig{
		ID: "provider-1", Name: "OpenAI", Provider: "openai",
		APIFormat: domain.ProviderAPIFormatResponses, PromptCacheKeyEnabled: true,
		BaseURL: "https://api.openai.com", APIKeyCiphertext: ciphertext, Enabled: true,
	}

	request := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/providers/provider-1", strings.NewReader(`{"provider":"anthropic"}`))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(server.cookie(t, admin))
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	saved := repository.providers["provider-1"]
	if saved.Provider != "anthropic" || saved.APIFormat != domain.ProviderAPIFormatMessages || saved.PromptCacheKeyEnabled {
		t.Fatalf("provider type defaults were not updated: %+v", saved)
	}
	if saved.BaseURL != "https://api.anthropic.com" {
		t.Fatalf("default base URL = %q, want Anthropic default", saved.BaseURL)
	}
	if saved.APIKeyCiphertext != ciphertext {
		t.Fatal("changing provider type discarded the existing API key")
	}
}

func TestAdminProviderTypeChangePreservesCustomBaseURL(t *testing.T) {
	repository := newTestRepository()
	admin := domain.User{ID: "admin-1", Name: "admin", Role: domain.RoleAdmin, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[admin.ID] = admin
	repository.providers["provider-1"] = domain.ProviderConfig{
		ID: "provider-1", Name: "Gateway", Provider: "openai", APIFormat: domain.ProviderAPIFormatResponses,
		BaseURL: "https://gateway.example", Enabled: true,
	}
	server := newHTTPTestServer(t, repository, nil)

	request := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/providers/provider-1", strings.NewReader(`{"provider":"gemini"}`))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(server.cookie(t, admin))
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	saved := repository.providers["provider-1"]
	if saved.Provider != "gemini" || saved.APIFormat != domain.ProviderAPIFormatGenerateContent || saved.BaseURL != "https://gateway.example" {
		t.Fatalf("custom provider configuration changed unexpectedly: %+v", saved)
	}
}

func TestAdminRejectsConflictingProviderKeyActions(t *testing.T) {
	repository := newTestRepository()
	admin := domain.User{ID: "admin-1", Name: "admin", Role: domain.RoleAdmin, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[admin.ID] = admin
	repository.providers["provider-1"] = domain.ProviderConfig{
		ID: "provider-1", Name: "OpenAI", Provider: "openai", APIFormat: domain.ProviderAPIFormatResponses,
		BaseURL: "https://api.openai.com", APIKeyCiphertext: "existing-ciphertext", Enabled: true,
	}
	server := newHTTPTestServer(t, repository, nil)

	request := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/providers/provider-1", strings.NewReader(`{"api_key":"replacement","clear_api_key":true}`))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(server.cookie(t, admin))
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"invalid_request"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if repository.providers["provider-1"].APIKeyCiphertext != "existing-ciphertext" {
		t.Fatal("rejected key update changed the stored credential")
	}
}

func TestAdminDeleteProviderCascadesModels(t *testing.T) {
	repository := newTestRepository()
	admin := domain.User{ID: "admin-1", Name: "admin", Role: domain.RoleAdmin, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[admin.ID] = admin
	repository.providers["provider-1"] = domain.ProviderConfig{
		ID: "provider-1", Name: "OpenAI", Provider: "openai", APIFormat: domain.ProviderAPIFormatResponses,
		BaseURL: "https://api.openai.com", Enabled: true,
	}
	repository.models["model-1"] = domain.Model{ID: "model-1", ProviderConfigID: "provider-1", ExternalID: "custom-model"}
	server := newHTTPTestServer(t, repository, nil)

	request := httptest.NewRequest(http.MethodDelete, "/api/v1/admin/providers/provider-1", nil)
	request.AddCookie(server.cookie(t, admin))
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if _, exists := repository.providers["provider-1"]; exists {
		t.Fatal("deleted provider remains in repository")
	}
	if _, exists := repository.models["model-1"]; exists {
		t.Fatal("model belonging to deleted provider remains in repository")
	}
}

func TestChatUsesConfiguredOpenAIAPIFormat(t *testing.T) {
	captured := make(chan struct {
		path string
		body string
	}, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestBody, _ := io.ReadAll(request.Body)
		captured <- struct {
			path string
			body string
		}{path: request.URL.Path, body: string(requestBody)}
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(writer, "data: {\"id\":\"chatcmpl_1\",\"model\":\"z-ai/glm-5.2\",\"choices\":[{\"delta\":{\"content\":\"NARRATIUM_OK\"},\"finish_reason\":\"stop\"}]}\n\n")
		_, _ = io.WriteString(writer, "data: {\"id\":\"chatcmpl_1\",\"model\":\"z-ai/glm-5.2\",\"choices\":[],\"usage\":{\"prompt_tokens\":15,\"completion_tokens\":7,\"total_tokens\":22}}\n\n")
		_, _ = io.WriteString(writer, "data: [DONE]\n\n")
	}))
	defer upstream.Close()

	repository := newTestRepository()
	user := domain.User{ID: "user-1", Name: "user", Role: domain.RoleUser, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[user.ID] = user
	server := newHTTPTestServer(t, repository, nil)
	ciphertext, err := server.cryptor.Encrypt("secret")
	if err != nil {
		t.Fatal(err)
	}
	repository.providers["provider-1"] = domain.ProviderConfig{
		ID: "provider-1", Name: "New API", Provider: "openai",
		APIFormat: domain.ProviderAPIFormatChatCompletions, BaseURL: upstream.URL,
		APIKeyCiphertext: ciphertext, Enabled: true,
	}
	repository.models["model-1"] = domain.Model{
		ID: "model-1", ProviderConfigID: "provider-1", Provider: "openai",
		ExternalID: "glm-5.2", Capabilities: domain.DefaultModelCapabilities("openai").JSON(),
	}

	body := `{"model_id":"model-1","system":"stable","input":"hello","max_output_tokens":64}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/chat", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(server.cookie(t, user))
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"text":"NARRATIUM_OK"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"first_token_ms":`) {
		t.Fatalf("completed event is missing first_token_ms: %s", response.Body.String())
	}
	if len(repository.usage) != 1 || repository.usage[0].FirstTokenMS == nil || *repository.usage[0].FirstTokenMS < 1 {
		t.Fatalf("successful usage did not retain TTFT: %+v", repository.usage)
	}

	upstreamRequest := <-captured
	if upstreamRequest.path != "/v1/chat/completions" {
		t.Fatalf("upstream path=%q", upstreamRequest.path)
	}
	if !strings.Contains(upstreamRequest.body, `"model":"glm-5.2"`) ||
		!strings.Contains(upstreamRequest.body, `"max_completion_tokens":64`) ||
		!strings.Contains(upstreamRequest.body, `"reasoning_effort":"medium"`) {
		t.Fatalf("unexpected upstream body: %s", upstreamRequest.body)
	}
}

func TestChatRunContinuesAfterEventSubscriberDisconnects(t *testing.T) {
	firstDeltaSent := make(chan struct{})
	continueUpstream := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		writer.WriteHeader(http.StatusOK)
		flusher := writer.(http.Flusher)
		_, _ = io.WriteString(writer, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"first\"}\n\n")
		flusher.Flush()
		close(firstDeltaSent)
		<-continueUpstream
		_, _ = io.WriteString(writer, "data: {\"type\":\"response.output_text.delta\",\"delta\":\" second\"}\n\n")
		_, _ = io.WriteString(writer, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_persisted\",\"model\":\"gpt-persisted\",\"status\":\"completed\",\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"first second\"}]}],\"usage\":{\"input_tokens\":1000000,\"output_tokens\":100000,\"total_tokens\":1100000,\"input_tokens_details\":{\"cached_tokens\":200000}}}}\n\n")
		flusher.Flush()
	}))
	defer func() {
		select {
		case <-continueUpstream:
		default:
			close(continueUpstream)
		}
		upstream.Close()
	}()

	repository := newTestRepository()
	user := domain.User{
		ID: "user-1", Name: "user", Role: domain.RoleUser, Status: domain.StatusActive,
		TokenVersion: 1, BalanceMicrousd: 20_000_000,
	}
	repository.users[user.ID] = user
	server := newHTTPTestServer(t, repository, nil)
	ciphertext, err := server.cryptor.Encrypt("secret")
	if err != nil {
		t.Fatal(err)
	}
	repository.providers["provider-1"] = domain.ProviderConfig{
		ID: "provider-1", Name: "OpenAI", Provider: "openai",
		APIFormat: domain.ProviderAPIFormatResponses, BaseURL: upstream.URL,
		APIKeyCiphertext: ciphertext, Enabled: true,
	}
	repository.models["model-1"] = domain.Model{
		ID: "model-1", ProviderConfigID: "provider-1", Provider: "openai",
		ExternalID: "gpt-persisted",
		Capabilities: domain.ModelCapabilities{
			SchemaVersion: 2, ContextWindow: 2_000_000, CompactionThreshold: 1_900_000,
			MaxOutputTokens: 4096, Reasoning: domain.ReasoningCapabilities{Enabled: true, Effort: "medium"},
		}.JSON(),
		Pricing: domain.ModelPricing{
			InputMicrousdPerMillion: 2_000_000, OutputMicrousdPerMillion: 4_000_000,
			CacheReadMicrousdPerMillion: 1_000_000, PriceMultiplier: "1.50",
		},
	}

	app := httptest.NewServer(server.router)
	defer app.Close()
	client := app.Client()
	client.Timeout = 5 * time.Second
	cookie := server.cookie(t, user)
	createRequest, err := http.NewRequest(http.MethodPost, app.URL+"/api/v1/chat/runs", strings.NewReader(
		`{"character_id":"character-1","node_id":"node-1","parent_node_id":"root","user_message":"hello","model_name":"gpt-persisted","model_id":"model-1","system":"stable","input":"hello","max_output_tokens":64}`,
	))
	if err != nil {
		t.Fatal(err)
	}
	createRequest.Header.Set("Content-Type", "application/json")
	createRequest.AddCookie(cookie)
	createResponse, err := client.Do(createRequest)
	if err != nil {
		t.Fatal(err)
	}
	var created struct {
		Run domain.ChatRun `json:"run"`
	}
	if err := json.NewDecoder(createResponse.Body).Decode(&created); err != nil {
		createResponse.Body.Close()
		t.Fatalf("decode created run: %v", err)
	}
	createResponse.Body.Close()
	if createResponse.StatusCode != http.StatusAccepted || created.Run.ID == "" || created.Run.CreatedAt.IsZero() {
		t.Fatalf("create status=%d run=%+v", createResponse.StatusCode, created.Run)
	}
	select {
	case <-firstDeltaSent:
	case <-time.After(5 * time.Second):
		t.Fatal("upstream did not start streaming")
	}

	eventsRequest, err := http.NewRequest(http.MethodGet, app.URL+"/api/v1/chat/runs/"+created.Run.ID+"/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	eventsRequest.AddCookie(cookie)
	eventsResponse, err := client.Do(eventsRequest)
	if err != nil {
		t.Fatal(err)
	}
	eventBuffer := make([]byte, 4096)
	seen := ""
	for !strings.Contains(seen, "first") {
		count, readErr := eventsResponse.Body.Read(eventBuffer)
		seen += string(eventBuffer[:count])
		if readErr != nil {
			t.Fatalf("read run events before disconnect: %v body=%s", readErr, seen)
		}
	}
	// Closing the browser-facing event stream must only end this subscription.
	eventsResponse.Body.Close()
	close(continueUpstream)

	deadline := time.Now().Add(5 * time.Second)
	var completed domain.ChatRun
	for time.Now().Before(deadline) {
		completed, err = repository.ChatRunByID(context.Background(), user.ID, created.Run.ID)
		if err == nil && completed.Status == domain.ChatRunStatusCompleted {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if completed.Status != domain.ChatRunStatusCompleted || completed.ResponseText != "first second" {
		t.Fatalf("run after subscriber disconnect = %+v", completed)
	}
	if completed.Usage.InputTokens != 800_000 || completed.Usage.CacheReadInputTokens != 200_000 ||
		completed.Billing.CostMicrousd != 3_300_000 || completed.Billing.ChargedMicrousd != 3_300_000 {
		t.Fatalf("persisted usage/billing = %+v / %+v", completed.Usage, completed.Billing)
	}

	pendingRequest, err := http.NewRequest(http.MethodGet, app.URL+"/api/v1/chat/runs?character_id=character-1", nil)
	if err != nil {
		t.Fatal(err)
	}
	pendingRequest.AddCookie(cookie)
	pendingResponse, err := client.Do(pendingRequest)
	if err != nil {
		t.Fatal(err)
	}
	pendingBody, _ := io.ReadAll(pendingResponse.Body)
	pendingResponse.Body.Close()
	if pendingResponse.StatusCode != http.StatusOK || !strings.Contains(string(pendingBody), "first second") {
		t.Fatalf("reconnect status=%d body=%s", pendingResponse.StatusCode, pendingBody)
	}

	ackRequest, err := http.NewRequest(http.MethodPost, app.URL+"/api/v1/chat/runs/"+created.Run.ID+"/ack", strings.NewReader(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	ackRequest.Header.Set("Content-Type", "application/json")
	ackRequest.AddCookie(cookie)
	ackResponse, err := client.Do(ackRequest)
	if err != nil {
		t.Fatal(err)
	}
	ackResponse.Body.Close()
	if ackResponse.StatusCode != http.StatusNoContent {
		t.Fatalf("acknowledge status=%d", ackResponse.StatusCode)
	}
}

func TestChatRunRejectsInsufficientQuotaWithExplicitError(t *testing.T) {
	upstreamHits := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		upstreamHits++
		writer.WriteHeader(http.StatusInternalServerError)
	}))
	defer upstream.Close()

	repository := newTestRepository()
	user := domain.User{ID: "user-1", Name: "user", Role: domain.RoleUser, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[user.ID] = user
	server := newHTTPTestServer(t, repository, nil)
	ciphertext, err := server.cryptor.Encrypt("secret")
	if err != nil {
		t.Fatal(err)
	}
	repository.providers["provider-1"] = domain.ProviderConfig{
		ID: "provider-1", Name: "OpenAI", Provider: "openai", APIFormat: domain.ProviderAPIFormatResponses,
		BaseURL: upstream.URL, APIKeyCiphertext: ciphertext, Enabled: true,
	}
	repository.models["model-1"] = domain.Model{
		ID: "model-1", ProviderConfigID: "provider-1", Provider: "openai", ExternalID: "gpt-test",
		Capabilities: domain.DefaultModelCapabilities("openai").JSON(),
		Pricing:      domain.ModelPricing{InputMicrousdPerMillion: 1_000_000, OutputMicrousdPerMillion: 1_000_000},
	}

	request := httptest.NewRequest(http.MethodPost, "/api/v1/chat/runs", strings.NewReader(
		`{"character_id":"character-1","node_id":"node-1","user_message":"hello","model_name":"gpt-test","model_id":"model-1","system":"stable","input":"hello","max_output_tokens":64}`,
	))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(server.cookie(t, user))
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden ||
		!strings.Contains(response.Body.String(), `"code":"insufficient_user_quota"`) ||
		!strings.Contains(response.Body.String(), `"message":"Insufficient quota."`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if upstreamHits != 0 || len(repository.chatRuns) != 0 {
		t.Fatalf("insufficient request reached upstream=%d runs=%d", upstreamHits, len(repository.chatRuns))
	}
}

func TestChatRunExplicitCancelStopsWorkerAndCleansRuntimeState(t *testing.T) {
	upstreamStarted := make(chan struct{})
	upstreamCanceled := make(chan struct{})
	releaseUpstream := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		writer.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(writer, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n")
		writer.(http.Flusher).Flush()
		close(upstreamStarted)
		select {
		case <-request.Context().Done():
			close(upstreamCanceled)
		case <-releaseUpstream:
		}
	}))
	defer func() {
		select {
		case <-releaseUpstream:
		default:
			close(releaseUpstream)
		}
		upstream.Close()
	}()

	repository := newTestRepository()
	user := domain.User{ID: "user-1", Name: "user", Role: domain.RoleUser, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[user.ID] = user
	server := newHTTPTestServer(t, repository, nil)
	ciphertext, err := server.cryptor.Encrypt("secret")
	if err != nil {
		t.Fatal(err)
	}
	repository.providers["provider-1"] = domain.ProviderConfig{
		ID: "provider-1", Name: "OpenAI", Provider: "openai", APIFormat: domain.ProviderAPIFormatResponses,
		BaseURL: upstream.URL, APIKeyCiphertext: ciphertext, Enabled: true,
	}
	repository.models["model-1"] = domain.Model{
		ID: "model-1", ProviderConfigID: "provider-1", Provider: "openai", ExternalID: "gpt-test",
		Capabilities: domain.DefaultModelCapabilities("openai").JSON(),
	}

	app := httptest.NewServer(server.router)
	defer app.Close()
	client := app.Client()
	client.Timeout = 5 * time.Second
	cookie := server.cookie(t, user)
	createRequest, err := http.NewRequest(http.MethodPost, app.URL+"/api/v1/chat/runs", strings.NewReader(
		`{"character_id":"character-1","node_id":"node-cancel","user_message":"stop","model_name":"gpt-test","model_id":"model-1","system":"stable","input":"hello","max_output_tokens":64}`,
	))
	if err != nil {
		t.Fatal(err)
	}
	createRequest.Header.Set("Content-Type", "application/json")
	createRequest.AddCookie(cookie)
	createResponse, err := client.Do(createRequest)
	if err != nil {
		t.Fatal(err)
	}
	var created struct {
		Run domain.ChatRun `json:"run"`
	}
	if err := json.NewDecoder(createResponse.Body).Decode(&created); err != nil {
		createResponse.Body.Close()
		t.Fatal(err)
	}
	createResponse.Body.Close()
	select {
	case <-upstreamStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("upstream did not start")
	}

	cancelRequest, err := http.NewRequest(http.MethodPost, app.URL+"/api/v1/chat/runs/"+created.Run.ID+"/cancel", strings.NewReader(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	cancelRequest.Header.Set("Content-Type", "application/json")
	cancelRequest.AddCookie(cookie)
	cancelResponse, err := client.Do(cancelRequest)
	if err != nil {
		t.Fatal(err)
	}
	cancelResponse.Body.Close()
	if cancelResponse.StatusCode != http.StatusOK {
		t.Fatalf("cancel status=%d", cancelResponse.StatusCode)
	}
	select {
	case <-upstreamCanceled:
	case <-time.After(5 * time.Second):
		t.Fatal("explicit stop did not cancel the upstream request")
	}

	deadline := time.Now().Add(5 * time.Second)
	var canceled domain.ChatRun
	for time.Now().Before(deadline) {
		canceled, err = repository.ChatRunByID(context.Background(), user.ID, created.Run.ID)
		server.api.runMu.Lock()
		runtimeEntries := len(server.api.runCancels) + len(server.api.runExplicitCancels)
		server.api.runMu.Unlock()
		if err == nil && canceled.Status == domain.ChatRunStatusCanceled && runtimeEntries == 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if canceled.Status != domain.ChatRunStatusCanceled || !canceled.CancelRequested || canceled.ErrorCode != "canceled" {
		t.Fatalf("canceled run = %+v", canceled)
	}

	// Canceling an already terminal run is idempotent and must not recreate an
	// in-memory cancellation marker.
	repeatRequest, _ := http.NewRequest(http.MethodPost, app.URL+"/api/v1/chat/runs/"+created.Run.ID+"/cancel", strings.NewReader(`{}`))
	repeatRequest.Header.Set("Content-Type", "application/json")
	repeatRequest.AddCookie(cookie)
	repeatResponse, err := client.Do(repeatRequest)
	if err != nil {
		t.Fatal(err)
	}
	repeatResponse.Body.Close()
	server.api.runMu.Lock()
	runtimeEntries := len(server.api.runCancels) + len(server.api.runExplicitCancels)
	server.api.runMu.Unlock()
	if repeatResponse.StatusCode != http.StatusOK || runtimeEntries != 0 {
		t.Fatalf("repeat cancel status=%d runtime entries=%d", repeatResponse.StatusCode, runtimeEntries)
	}
}

func TestChatRunEventsReturnsJSON404BeforeStartingSSE(t *testing.T) {
	repository := newTestRepository()
	user := domain.User{ID: "user-1", Name: "user", Role: domain.RoleUser, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[user.ID] = user
	server := newHTTPTestServer(t, repository, nil)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/chat/runs/missing/events", nil)
	request.AddCookie(server.cookie(t, user))
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)
	if response.Code != http.StatusNotFound ||
		!strings.Contains(response.Header().Get("Content-Type"), "application/json") ||
		!strings.Contains(response.Body.String(), `"code":"chat_run_not_found"`) {
		t.Fatalf("status=%d content-type=%q body=%s", response.Code, response.Header().Get("Content-Type"), response.Body.String())
	}
}

func TestChatRejectsClientReasoningOverride(t *testing.T) {
	repository := newTestRepository()
	user := domain.User{ID: "user-1", Name: "user", Role: domain.RoleUser, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[user.ID] = user
	server := newHTTPTestServer(t, repository, nil)
	ciphertext, err := server.cryptor.Encrypt("secret")
	if err != nil {
		t.Fatal(err)
	}
	repository.providers["provider-1"] = domain.ProviderConfig{
		ID: "provider-1", Name: "OpenAI", Provider: "openai", APIFormat: domain.ProviderAPIFormatResponses,
		BaseURL: "https://api.openai.com", APIKeyCiphertext: ciphertext, Enabled: true,
	}
	repository.models["model-1"] = domain.Model{
		ID: "model-1", ProviderConfigID: "provider-1", Provider: "openai", ExternalID: "gpt-test",
		Capabilities: domain.ModelCapabilities{
			SchemaVersion: 2, ContextWindow: 128000, CompactionThreshold: 120000, MaxOutputTokens: 4096,
			Reasoning: domain.ReasoningCapabilities{Enabled: true, Effort: "low"},
		}.JSON(),
	}

	body := `{"model_id":"model-1","system":"stable","input":"hello","max_output_tokens":64,"reasoning_effort":"high"}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/chat", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(server.cookie(t, user))
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"invalid_request"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestChatRejectsEstimatedContextOverflowBeforeProvider(t *testing.T) {
	repository := newTestRepository()
	user := domain.User{ID: "user-1", Name: "user", Role: domain.RoleUser, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[user.ID] = user
	repository.models["model-1"] = domain.Model{
		ID: "model-1", ProviderConfigID: "missing-provider", Provider: "openai", ExternalID: "gpt-test",
		Capabilities: domain.ModelCapabilities{
			SchemaVersion: 2, ContextWindow: 1024, CompactionThreshold: 960, MaxOutputTokens: 512,
			Reasoning: domain.ReasoningCapabilities{Enabled: false, Effort: ""},
		}.JSON(),
	}
	server := newHTTPTestServer(t, repository, nil)

	body := `{"model_id":"model-1","system":"` + strings.Repeat("s", 2400) + `","input":"` + strings.Repeat("i", 1600) + `","max_output_tokens":256}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/chat", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(server.cookie(t, user))
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"context_window_exceeded"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestChatWithoutGlobalOutputLimitStillEnforcesModelLimit(t *testing.T) {
	repository := newTestRepository()
	user := domain.User{ID: "user-1", Name: "user", Role: domain.RoleUser, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[user.ID] = user
	repository.models["model-1"] = domain.Model{
		ID: "model-1", ProviderConfigID: "missing-provider", Provider: "openai", ExternalID: "gpt-test",
		Capabilities: domain.ModelCapabilities{
			SchemaVersion: 2, ContextWindow: 8192, CompactionThreshold: 7800, MaxOutputTokens: 512,
			Reasoning: domain.ReasoningCapabilities{Enabled: false, Effort: ""},
		}.JSON(),
	}
	server := newHTTPTestServer(t, repository, func(cfg *config.Config) {
		cfg.MaxOutputTokens = 0
	})

	body := `{"model_id":"model-1","input":"hello","max_output_tokens":513}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/chat", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(server.cookie(t, user))
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"max_output_tokens_exceeded"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestOversizedJSONReturns413(t *testing.T) {
	repository := newTestRepository()
	server := newHTTPTestServer(t, repository, func(cfg *config.Config) { cfg.MaxJSONBodyBytes = 32 })
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"name":"someone","password":"this body is deliberately much too long"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestStaticFallbackPreservesNotFoundStatus(t *testing.T) {
	staticDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("home"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(staticDir, "404.html"), []byte("missing"), 0o600); err != nil {
		t.Fatal(err)
	}
	server := newHTTPTestServer(t, newTestRepository(), func(cfg *config.Config) {
		cfg.StaticDir = staticDir
	})

	tests := []struct {
		path string
		code int
		body string
	}{
		{path: "/", code: http.StatusOK, body: "home"},
		{path: "/does-not-exist", code: http.StatusNotFound, body: "missing"},
		{path: "/missing.js", code: http.StatusNotFound, body: "missing"},
	}
	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			response := httptest.NewRecorder()
			server.router.ServeHTTP(response, request)
			if response.Code != test.code || strings.TrimSpace(response.Body.String()) != test.body {
				t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
			}
		})
	}
}

func TestProviderClientRejectsRedirectsBeforeForwardingSecrets(t *testing.T) {
	targetHit := make(chan struct{}, 1)
	target := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		targetHit <- struct{}{}
		writer.WriteHeader(http.StatusOK)
	}))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, target.URL, http.StatusTemporaryRedirect)
	}))
	defer redirect.Close()

	server := newHTTPTestServer(t, newTestRepository(), nil)
	request, err := http.NewRequest(http.MethodPost, redirect.URL, strings.NewReader(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("x-api-key", "must-not-leak")
	response, err := server.client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusTemporaryRedirect {
		t.Fatalf("status=%d, want redirect response", response.StatusCode)
	}
	select {
	case <-targetHit:
		t.Fatal("provider client followed a redirect and reached the target host")
	default:
	}
}

func TestStreamingFailureAfter200EmitsOneTerminalError(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		writer.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(writer, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n")
		_, _ = io.WriteString(writer, "data: {\"type\":\"response.failed\",\"response\":{\"status\":\"failed\",\"error\":{\"code\":\"server_error\",\"message\":\"failed\"}}}\n\n")
	}))
	defer upstream.Close()

	repository := newTestRepository()
	user := domain.User{ID: "user-1", Name: "user", Role: domain.RoleUser, Status: domain.StatusActive, TokenVersion: 1}
	repository.users[user.ID] = user
	server := newHTTPTestServer(t, repository, nil)
	ciphertext, err := server.cryptor.Encrypt("secret")
	if err != nil {
		t.Fatal(err)
	}
	repository.providers["provider-1"] = domain.ProviderConfig{
		ID: "provider-1", Name: "OpenAI", Provider: "openai", APIFormat: domain.ProviderAPIFormatResponses, BaseURL: upstream.URL,
		APIKeyCiphertext: ciphertext, Enabled: true,
	}
	repository.models["model-1"] = domain.Model{
		ID: "model-1", ProviderConfigID: "provider-1", Provider: "openai",
		ExternalID: "gpt-test", Capabilities: domain.DefaultModelCapabilities("openai").JSON(),
	}

	body := `{"model_id":"model-1","system":"stable","input":"hello","max_output_tokens":64}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/chat", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(server.cookie(t, user))
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if count := strings.Count(response.Body.String(), `"type":"error"`); count != 1 {
		t.Fatalf("terminal error count=%d body=%s", count, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"type":"delta"`) {
		t.Fatalf("missing delta: %s", response.Body.String())
	}
	if len(repository.usage) != 1 || repository.usage[0].FirstTokenMS == nil || *repository.usage[0].FirstTokenMS < 1 {
		t.Fatalf("usage did not retain TTFT: %+v", repository.usage)
	}
}
