package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/yuzukumo/narratium-webui/backend/internal/domain"
)

var (
	ErrNotFound             = errors.New("not found")
	ErrConflict             = errors.New("conflict")
	ErrRegistrationDisabled = errors.New("registration disabled")
	ErrLastAdmin            = errors.New("cannot disable or demote the last active admin")
	ErrInsufficientBalance  = errors.New("insufficient available balance")
	ErrReservationClosed    = errors.New("billing reservation is already closed")
	ErrBlobCountQuota       = errors.New("blob count quota exceeded")
	ErrBlobTotalBytesQuota  = errors.New("blob total bytes quota exceeded")
	ErrInvalidVerification  = errors.New("invalid email verification code")
	ErrVerificationExpired  = errors.New("email verification code expired")
	ErrVerificationLocked   = errors.New("email verification code locked")
)

type BlobQuota struct {
	MaxCount      int
	MaxTotalBytes int64
}

type Repository interface {
	Health(context.Context) error
	Bootstrap(context.Context) (domain.BootstrapState, error)
	Register(context.Context, string, string, string) (domain.User, error)
	UserByID(context.Context, string) (domain.User, error)
	UserByEmail(context.Context, string) (domain.User, error)
	ListUsers(context.Context, int, int) (domain.Page[domain.User], error)
	UpdateUser(context.Context, string, string, string, string, string) (domain.User, error)
	UpdateUserPassword(context.Context, string, string) (domain.User, error)
	RevokeSessions(context.Context, string, int64) error
	AdjustUserBalance(context.Context, string, string, int64, string) (domain.User, domain.BalanceLedgerEntry, error)
	AdjustUserQuota(context.Context, string, string, string, int64, string) (domain.User, domain.BalanceLedgerEntry, error)
	ListBalanceLedger(context.Context, string, int, int) (domain.Page[domain.BalanceLedgerEntry], error)

	RegistrationEnabled(context.Context) (bool, error)
	SetRegistrationEnabled(context.Context, bool) error
	EmailVerificationEnabled(context.Context) (bool, error)
	SetEmailVerificationEnabled(context.Context, bool) error
	SaveEmailVerificationCode(context.Context, string, string, time.Time) error
	ConsumeEmailVerificationCode(context.Context, string, string, time.Time) error

	ListProviders(context.Context) ([]domain.ProviderConfig, error)
	ProviderByID(context.Context, string) (domain.ProviderConfig, error)
	CreateProvider(context.Context, domain.ProviderConfig) (domain.ProviderConfig, error)
	UpdateProvider(context.Context, domain.ProviderConfig) (domain.ProviderConfig, error)
	DeleteProvider(context.Context, string) (domain.ProviderConfig, error)

	ListModels(context.Context, bool) ([]domain.Model, error)
	ModelByID(context.Context, string) (domain.Model, error)
	UpdateModel(context.Context, domain.Model) (domain.Model, error)

	GetDocument(context.Context, string, string) (domain.UserDocument, error)
	PutDocument(context.Context, string, string, json.RawMessage, *int64) (domain.UserDocument, error)
	GetBlob(context.Context, string, string) (domain.UserBlob, error)
	ListBlobs(context.Context, string, int, int) (domain.Page[domain.UserBlob], error)
	PutBlob(context.Context, string, string, string, []byte, int64, BlobQuota) (domain.UserBlob, error)
	DeleteBlob(context.Context, string, string, int64) error

	InsertUsage(context.Context, domain.UsageLog) error
	ListUsageLogs(context.Context, string, int, int) (domain.Page[domain.UsageLog], error)
	ReserveBalance(context.Context, domain.BillingReservation) (domain.BillingReservation, error)
	FinalizeBilling(context.Context, string, domain.UsageLog, int64) (domain.BillingSettlement, error)
	ReleaseBalanceReservation(context.Context, string) error

	CreateChatRun(context.Context, domain.ChatRun) error
	AttachChatRunReservation(context.Context, string, string) error
	ChatRunByID(context.Context, string, string) (domain.ChatRun, error)
	ListPendingChatRuns(context.Context, string, string) ([]domain.ChatRun, error)
	UpdateChatRunProgress(context.Context, string, string, *int64) error
	FinishChatRun(context.Context, string, domain.ChatRunUpdate) (domain.ChatRun, error)
	RequestChatRunCancel(context.Context, string, string) (domain.ChatRun, error)
	AcknowledgeChatRun(context.Context, string, string) error
	RecoverChatRuns(context.Context) error
}
