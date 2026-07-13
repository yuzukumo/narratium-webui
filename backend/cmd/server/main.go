package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/yuzukumo/narratium-webui/backend/internal/auth"
	"github.com/yuzukumo/narratium-webui/backend/internal/config"
	"github.com/yuzukumo/narratium-webui/backend/internal/email"
	"github.com/yuzukumo/narratium-webui/backend/internal/httpapi"
	"github.com/yuzukumo/narratium-webui/backend/internal/modelmetadata"
	"github.com/yuzukumo/narratium-webui/backend/internal/secure"
	"github.com/yuzukumo/narratium-webui/backend/internal/store"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load()
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	repository, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		cancel()
		logger.Error("open database", "error", err)
		os.Exit(1)
	}
	if err := repository.Migrate(ctx); err != nil {
		cancel()
		repository.Close()
		logger.Error("migrate database", "error", err)
		os.Exit(1)
	}
	if err := repository.RecoverChatRuns(ctx); err != nil {
		cancel()
		repository.Close()
		logger.Error("recover interrupted chat runs", "error", err)
		os.Exit(1)
	}
	cancel()
	defer repository.Close()
	backgroundCtx, cancelBackground := context.WithCancel(context.Background())
	defer cancelBackground()

	cryptor, err := secure.NewCryptor(cfg.EncryptionKey)
	if err != nil {
		logger.Error("initialize secret encryption", "error", err)
		os.Exit(1)
	}
	authService := auth.New(cfg.JWTSecret, cfg.SessionTTL)
	mailer, err := email.NewSMTPMailer(
		cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUsername, cfg.SMTPPassword, cfg.SMTPFrom, cfg.SMTPImplicitTLS,
	)
	if err != nil {
		logger.Error("initialize email delivery", "error", err)
		os.Exit(1)
	}
	metadataSync := modelmetadata.New(repository, &http.Client{Timeout: 30 * time.Second}, logger)
	go metadataSync.Run(backgroundCtx, 12*time.Hour)
	api := httpapi.New(
		cfg, repository, authService, cryptor, logger,
		httpapi.WithProviderModelsChanged(metadataSync.Trigger),
		httpapi.WithBackgroundContext(backgroundCtx),
		httpapi.WithEmailMailer(mailer),
	)
	server := &http.Server{
		Addr:              cfg.Address,
		Handler:           api.Router(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      0,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    1 << 20,
	}

	serverErrors := make(chan error, 1)
	go func() {
		logger.Info("server listening", "config", cfg.String())
		serverErrors <- server.ListenAndServe()
	}()

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	select {
	case signal := <-signals:
		logger.Info("shutdown requested", "signal", signal.String())
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server stopped", "error", err)
			os.Exit(1)
		}
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
		_ = server.Close()
	}
}
