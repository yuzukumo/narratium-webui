package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuzukumo/narratium-webui/backend/internal/auth"
	"github.com/yuzukumo/narratium-webui/backend/internal/config"
	"github.com/yuzukumo/narratium-webui/backend/internal/domain"
	"github.com/yuzukumo/narratium-webui/backend/internal/email"
	"github.com/yuzukumo/narratium-webui/backend/internal/secure"
	"github.com/yuzukumo/narratium-webui/backend/internal/store"
)

const userContextKey = "authenticated-user"

const accountBindingHeader = "X-Narratium-User-ID"

type API struct {
	cfg                     config.Config
	repo                    store.Repository
	auth                    *auth.Service
	cryptor                 *secure.Cryptor
	logger                  *slog.Logger
	limiter                 *loginLimiter
	registrationLimiter     *loginLimiter
	verificationLimiter     *loginLimiter
	chatLimiter             *chatLimiter
	mailer                  email.Mailer
	client                  *http.Client
	onProviderModelsChanged func()
	backgroundCtx           context.Context
	runMu                   sync.Mutex
	runCancels              map[string]context.CancelFunc
	runExplicitCancels      map[string]bool
	runSubscribers          map[string]map[chan struct{}]struct{}
}

type Option func(*API)

func WithProviderModelsChanged(callback func()) Option {
	return func(api *API) {
		api.onProviderModelsChanged = callback
	}
}

func WithBackgroundContext(ctx context.Context) Option {
	return func(api *API) {
		if ctx != nil {
			api.backgroundCtx = ctx
		}
	}
}

func WithEmailMailer(mailer email.Mailer) Option {
	return func(api *API) {
		if mailer != nil {
			api.mailer = mailer
		}
	}
}

func New(cfg config.Config, repo store.Repository, authService *auth.Service, cryptor *secure.Cryptor, logger *slog.Logger, options ...Option) *API {
	api := &API{
		cfg: cfg, repo: repo, auth: authService, cryptor: cryptor, logger: logger,
		limiter:             newLoginLimiter(10, 10*time.Minute),
		registrationLimiter: newLoginLimiter(5, 10*time.Minute),
		verificationLimiter: newLoginLimiter(5, 10*time.Minute),
		chatLimiter:         newChatLimiter(cfg.ChatRequestsPM, cfg.ChatConcurrency),
		client:              newProviderHTTPClient(cfg),
		mailer:              &email.SMTPMailer{},
		backgroundCtx:       context.Background(),
		runCancels:          make(map[string]context.CancelFunc),
		runExplicitCancels:  make(map[string]bool),
		runSubscribers:      make(map[string]map[chan struct{}]struct{}),
	}
	for _, option := range options {
		option(api)
	}
	return api
}

func (a *API) Router() *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	if err := router.SetTrustedProxies(a.cfg.TrustedProxies); err != nil {
		a.logger.Error("configure trusted proxies", "error", err)
		_ = router.SetTrustedProxies(nil)
	}
	router.Use(a.recovery(), a.requestID(), a.securityHeaders(), a.corsAndOrigin(), a.bodyLimit())

	v1 := router.Group("/api/v1")
	v1.Use(a.noStoreAPI())
	v1.GET("/health", a.health)
	authRoutes := v1.Group("/auth")
	authRoutes.GET("/bootstrap", a.bootstrap)
	authRoutes.POST("/register", a.register)
	authRoutes.POST("/send-verification-code", a.sendVerificationCode)
	authRoutes.POST("/login", a.login)
	authRoutes.POST("/logout", a.requireAuth(), a.logout)
	authRoutes.GET("/me", a.requireAuth(), a.me)
	authRoutes.PATCH("/me", a.requireAuth(), a.updateOwnProfile)

	protected := v1.Group("")
	protected.Use(a.requireAuth())
	protected.GET("/models", a.listEnabledModels)
	protected.GET("/billing/balance", a.getBalance)
	protected.GET("/usage-logs", a.listOwnUsageLogs)
	protected.POST("/chat", a.chat)
	protected.POST("/chat/runs", a.createChatRun)
	protected.GET("/chat/runs", a.listChatRuns)
	protected.GET("/chat/runs/:id", a.getChatRun)
	protected.GET("/chat/runs/:id/events", a.chatRunEvents)
	protected.POST("/chat/runs/:id/cancel", a.cancelChatRun)
	protected.POST("/chat/runs/:id/ack", a.acknowledgeChatRun)
	protected.GET("/data/:namespace", a.getDocument)
	protected.PUT("/data/:namespace", a.putDocument)
	protected.GET("/blobs", a.listBlobs)
	protected.GET("/blobs/*key", a.getBlob)
	protected.PUT("/blobs/*key", a.putBlob)
	protected.DELETE("/blobs/*key", a.deleteBlob)

	admin := protected.Group("/admin")
	admin.Use(a.requireAdmin())
	admin.GET("/users", a.listUsers)
	admin.PATCH("/users/:id", a.updateUser)
	admin.PUT("/users/:id/password", a.updateUserPassword)
	admin.POST("/users/:id/balance-adjustments", a.adjustUserBalance)
	admin.GET("/users/:id/balance-ledger", a.listUserBalanceLedger)
	admin.GET("/settings", a.getAdminSettings)
	admin.PATCH("/settings", a.updateAdminSettings)
	admin.GET("/providers", a.listProviders)
	admin.POST("/providers", a.createProvider)
	admin.PATCH("/providers/:id", a.updateProvider)
	admin.DELETE("/providers/:id", a.deleteProvider)
	admin.GET("/models", a.listModels)
	admin.PATCH("/models/:id", a.updateModel)

	a.attachStatic(router)
	return router
}

func (a *API) noStoreAPI() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "private, no-store")
		c.Header("Vary", "Origin, Cookie, X-Narratium-User-ID")
		c.Next()
	}
}

func (a *API) health(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	if err := a.repo.Health(ctx); err != nil {
		a.logger.Error("database health check failed", "error", err, "request_id", requestID(c))
		writeError(c, http.StatusServiceUnavailable, "database_unavailable", "Database is unavailable.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (a *API) requestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := strings.TrimSpace(c.GetHeader("X-Request-ID"))
		if id == "" || len(id) > 128 || !validRequestID(id) {
			id = uuid.NewString()
		}
		c.Set("request-id", id)
		c.Header("X-Request-ID", id)
		c.Next()
	}
}

func (a *API) recovery() gin.HandlerFunc {
	return gin.CustomRecovery(func(c *gin.Context, recovered any) {
		a.logger.Error("panic recovered", "panic", recovered, "request_id", requestID(c))
		writeError(c, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
	})
}

func (a *API) securityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "same-origin")
		c.Header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		c.Next()
	}
}

func (a *API) corsAndOrigin() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := strings.TrimRight(strings.TrimSpace(c.GetHeader("Origin")), "/")
		allowed := origin == "" || sameOrigin(origin, c.Request) || a.cfg.ValidateOrigin(origin)
		if !allowed {
			writeError(c, http.StatusForbidden, "origin_not_allowed", "Request origin is not allowed.")
			c.Abort()
			return
		}
		if origin != "" && (sameOrigin(origin, c.Request) || a.cfg.ValidateOrigin(origin)) {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Headers", "Content-Type, If-Match, X-Request-ID, "+accountBindingHeader)
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		}
		if c.Request.Method == http.MethodOptions {
			c.Status(http.StatusNoContent)
			c.Abort()
			return
		}
		c.Next()
	}
}

func (a *API) bodyLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		limit := a.cfg.MaxJSONBodyBytes
		if strings.HasPrefix(c.Request.URL.Path, "/api/v1/blobs/") {
			limit = a.cfg.MaxBlobBytes
			if limit < 1 {
				limit = a.cfg.MaxBlobTotalBytes
			}
		}
		if limit > 0 {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
		}
		c.Next()
	}
}

func (a *API) requireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		raw, err := c.Cookie(a.cfg.CookieName)
		if err != nil || raw == "" {
			writeError(c, http.StatusUnauthorized, "authentication_required", "Authentication is required.")
			c.Abort()
			return
		}
		claims, err := a.auth.Parse(raw)
		if err != nil {
			a.clearSession(c)
			writeError(c, http.StatusUnauthorized, "invalid_session", "The session is invalid or expired.")
			c.Abort()
			return
		}
		user, err := a.repo.UserByID(c.Request.Context(), claims.Subject)
		if err != nil || user.Status != domain.StatusActive || user.TokenVersion != claims.TokenVersion {
			a.clearSession(c)
			writeError(c, http.StatusUnauthorized, "invalid_session", "The session is invalid or expired.")
			c.Abort()
			return
		}
		if expectedUserID := strings.TrimSpace(c.GetHeader(accountBindingHeader)); expectedUserID != "" && expectedUserID != user.ID {
			writeError(c, http.StatusConflict, "account_changed", "The signed-in account changed in another browser tab. Refresh this page before continuing.")
			c.Abort()
			return
		}
		c.Header(accountBindingHeader, user.ID)
		c.Set(userContextKey, user)
		c.Next()
	}
}

func (a *API) requireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		if currentUser(c).Role != domain.RoleAdmin {
			writeError(c, http.StatusForbidden, "admin_required", "Administrator access is required.")
			c.Abort()
			return
		}
		c.Next()
	}
}

func (a *API) attachStatic(router *gin.Engine) {
	staticDir := filepath.Clean(a.cfg.StaticDir)
	router.NoRoute(func(c *gin.Context) {
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			writeError(c, http.StatusNotFound, "not_found", "Resource not found.")
			return
		}
		requestPath := filepath.Clean(strings.TrimPrefix(c.Request.URL.Path, "/"))
		if requestPath == "." {
			requestPath = "index.html"
		}
		candidates := []string{filepath.Join(staticDir, requestPath)}
		if filepath.Ext(requestPath) == "" {
			candidates = append(candidates, filepath.Join(staticDir, requestPath, "index.html"))
		}
		for _, candidate := range candidates {
			if withinDir(staticDir, candidate) && regularFile(candidate) {
				serveStaticFile(c, candidate, requestPath)
				return
			}
		}
		notFound := filepath.Join(staticDir, "404.html")
		if regularFile(notFound) {
			if contents, err := os.ReadFile(notFound); err == nil {
				c.Header("Cache-Control", "no-cache")
				c.Data(http.StatusNotFound, "text/html; charset=utf-8", contents)
				return
			}
		}
		writeError(c, http.StatusNotFound, "not_found", "Resource not found.")
	})
}

func serveStaticFile(c *gin.Context, path, requestPath string) {
	servedPath, encoding := compressedStaticPath(path, c.GetHeader("Accept-Encoding"))
	file, err := os.Open(servedPath)
	if err != nil {
		writeError(c, http.StatusNotFound, "not_found", "Resource not found.")
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		writeError(c, http.StatusInternalServerError, "static_file_error", "Static file could not be served.")
		return
	}

	if contentType := mime.TypeByExtension(filepath.Ext(path)); contentType != "" {
		c.Header("Content-Type", contentType)
	}
	if encoding != "" {
		c.Header("Content-Encoding", encoding)
	}
	c.Header("Vary", "Accept-Encoding")
	c.Header("Cache-Control", staticCacheControl(requestPath))
	http.ServeContent(c.Writer, c.Request, filepath.Base(path), info.ModTime(), file)
}

func compressedStaticPath(path, acceptEncoding string) (string, string) {
	for _, encoding := range []struct {
		name   string
		suffix string
	}{
		{name: "br", suffix: ".br"},
		{name: "gzip", suffix: ".gz"},
	} {
		candidate := path + encoding.suffix
		if acceptsEncoding(acceptEncoding, encoding.name) && regularFile(candidate) {
			return candidate, encoding.name
		}
	}
	return path, ""
}

func acceptsEncoding(header, target string) bool {
	wildcardQuality := -1.0
	for _, rawPart := range strings.Split(strings.ToLower(header), ",") {
		parts := strings.Split(rawPart, ";")
		name := strings.TrimSpace(parts[0])
		quality := 1.0
		for _, parameter := range parts[1:] {
			key, value, found := strings.Cut(strings.TrimSpace(parameter), "=")
			if found && key == "q" {
				parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
				if err != nil {
					quality = 0
				} else {
					quality = parsed
				}
			}
		}
		if name == target {
			return quality > 0
		}
		if name == "*" {
			wildcardQuality = quality
		}
	}
	return wildcardQuality > 0
}

func staticCacheControl(requestPath string) string {
	normalized := filepath.ToSlash(strings.TrimPrefix(requestPath, "/"))
	if strings.HasPrefix(normalized, "_next/static/") {
		return "public, max-age=31536000, immutable"
	}
	extension := strings.ToLower(filepath.Ext(normalized))
	if extension == ".html" || extension == ".txt" || extension == "" {
		return "no-cache"
	}
	return "public, max-age=86400"
}

func decodeJSON(c *gin.Context, target any) error {
	if mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type")); err != nil || mediaType != "application/json" {
		return errors.New("Content-Type must be application/json")
	}
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain one JSON object")
	}
	return nil
}

func writeError(c *gin.Context, status int, code, message string) {
	c.JSON(status, gin.H{"error": gin.H{
		"code": code, "message": message, "request_id": requestID(c),
	}})
}

func writeDecodeError(c *gin.Context, err error, message string) {
	var maxBytesError *http.MaxBytesError
	if errors.As(err, &maxBytesError) {
		writeError(c, http.StatusRequestEntityTooLarge, "request_too_large", "The request body exceeds the configured size limit.")
		return
	}
	writeError(c, http.StatusBadRequest, "invalid_request", message)
}

func jsonArray[T any](items []T) []T {
	if items == nil {
		return []T{}
	}
	return items
}

func validRequestID(value string) bool {
	for _, char := range value {
		if !(char >= 'a' && char <= 'z') && !(char >= 'A' && char <= 'Z') &&
			!(char >= '0' && char <= '9') && char != '-' && char != '_' && char != '.' && char != ':' {
			return false
		}
	}
	return true
}

func requestID(c *gin.Context) string {
	value, _ := c.Get("request-id")
	id, _ := value.(string)
	return id
}

func currentUser(c *gin.Context) domain.User {
	value, _ := c.Get(userContextKey)
	user, _ := value.(domain.User)
	return user
}

func sameOrigin(origin string, request *http.Request) bool {
	parsed, err := url.Parse(origin)
	return err == nil && parsed.Host != "" && strings.EqualFold(parsed.Host, request.Host)
}

func withinDir(root, candidate string) bool {
	relative, err := filepath.Rel(root, candidate)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func regularFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

func parsePagination(c *gin.Context) (limit, offset int) {
	limit = 50
	offset = 0
	if value, err := strconv.Atoi(c.Query("limit")); err == nil && value > 0 && value <= 200 {
		limit = value
	}
	if value, err := strconv.Atoi(c.Query("offset")); err == nil && value >= 0 {
		offset = value
	}
	return limit, offset
}
