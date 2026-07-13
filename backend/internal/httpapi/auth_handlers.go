package httpapi

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/yuzukumo/narratium-webui/backend/internal/domain"
	"github.com/yuzukumo/narratium-webui/backend/internal/store"
	"golang.org/x/crypto/bcrypt"
)

type registrationRequest struct {
	Name             string `json:"name"`
	Email            string `json:"email"`
	Password         string `json:"password"`
	VerificationCode string `json:"verification_code"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type verificationCodeRequest struct {
	Email string `json:"email"`
}

func (a *API) bootstrap(c *gin.Context) {
	state, err := a.repo.Bootstrap(c.Request.Context())
	if err != nil {
		a.logger.Error("load bootstrap state", "error", err, "request_id", requestID(c))
		writeError(c, http.StatusInternalServerError, "internal_error", "Unable to load application state.")
		return
	}
	c.JSON(http.StatusOK, state)
}

func (a *API) register(c *gin.Context) {
	key := c.ClientIP()
	if !a.registrationLimiter.Allow(key) {
		c.Header("Retry-After", "600")
		writeError(c, http.StatusTooManyRequests, "registration_rate_limited", "Too many registration attempts. Try again later.")
		return
	}
	state, err := a.repo.Bootstrap(c.Request.Context())
	if err != nil {
		a.logger.Error("load registration policy", "error", err, "request_id", requestID(c))
		writeError(c, http.StatusInternalServerError, "internal_error", "Unable to load registration policy.")
		return
	}
	if state.Initialized && !state.RegistrationEnabled {
		writeError(c, http.StatusForbidden, "registration_disabled", "Registration is disabled.")
		return
	}
	var request registrationRequest
	if err := decodeJSON(c, &request); err != nil {
		writeDecodeError(c, err, "A name, email address, and password are required.")
		return
	}
	request.Name = strings.TrimSpace(request.Name)
	request.Email = normalizeEmail(request.Email)
	if err := validateRegistration(request.Name, request.Email, request.Password); err != nil {
		writeError(c, http.StatusBadRequest, "invalid_credentials", err.Error())
		return
	}
	if state.EmailVerificationEnabled {
		request.VerificationCode = strings.TrimSpace(request.VerificationCode)
		if request.VerificationCode == "" {
			writeError(c, http.StatusBadRequest, "verification_code_required", "A verification code is required.")
			return
		}
		if err := a.repo.ConsumeEmailVerificationCode(c.Request.Context(), request.Email, verificationCodeHash(a.cfg.JWTSecret, request.Email, request.VerificationCode), time.Now().UTC()); err != nil {
			switch {
			case errors.Is(err, store.ErrVerificationExpired):
				writeError(c, http.StatusBadRequest, "verification_code_expired", "The verification code has expired.")
			case errors.Is(err, store.ErrVerificationLocked):
				writeError(c, http.StatusTooManyRequests, "verification_code_locked", "Too many incorrect verification attempts. Request a new code.")
			default:
				writeError(c, http.StatusBadRequest, "invalid_verification_code", "The verification code is incorrect.")
			}
			return
		}
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(request.Password), 12)
	if err != nil {
		a.logger.Error("hash password", "error", err, "request_id", requestID(c))
		writeError(c, http.StatusInternalServerError, "internal_error", "Unable to create the account.")
		return
	}
	user, err := a.repo.Register(c.Request.Context(), request.Name, request.Email, string(hash))
	if errors.Is(err, store.ErrConflict) {
		writeError(c, http.StatusConflict, "email_taken", "That email address is already in use.")
		return
	}
	if errors.Is(err, store.ErrRegistrationDisabled) {
		writeError(c, http.StatusForbidden, "registration_disabled", "Registration is disabled.")
		return
	}
	if err != nil {
		a.logger.Error("register user", "error", err, "request_id", requestID(c))
		writeError(c, http.StatusInternalServerError, "internal_error", "Unable to create the account.")
		return
	}
	if err := a.setSession(c, user); err != nil {
		a.logger.Error("issue session", "error", err, "request_id", requestID(c))
		writeError(c, http.StatusInternalServerError, "internal_error", "Unable to start a session.")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"user": user})
}

func (a *API) login(c *gin.Context) {
	key := c.ClientIP()
	if !a.limiter.Allow(key) {
		c.Header("Retry-After", "600")
		writeError(c, http.StatusTooManyRequests, "login_rate_limited", "Too many login attempts. Try again later.")
		return
	}
	var request loginRequest
	if err := decodeJSON(c, &request); err != nil {
		writeDecodeError(c, err, "An email address and password are required.")
		return
	}
	request.Email = normalizeEmail(request.Email)
	user, err := a.repo.UserByEmail(c.Request.Context(), request.Email)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(request.Password)) != nil || user.Status != domain.StatusActive {
		writeError(c, http.StatusUnauthorized, "invalid_credentials", "The email address or password is incorrect.")
		return
	}
	a.limiter.Reset(key)
	if err := a.setSession(c, user); err != nil {
		a.logger.Error("issue session", "error", err, "request_id", requestID(c))
		writeError(c, http.StatusInternalServerError, "internal_error", "Unable to start a session.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": user})
}

func (a *API) sendVerificationCode(c *gin.Context) {
	key := c.ClientIP()
	if !a.verificationLimiter.Allow(key) {
		c.Header("Retry-After", "600")
		writeError(c, http.StatusTooManyRequests, "verification_rate_limited", "Too many verification code requests. Try again later.")
		return
	}
	state, err := a.repo.Bootstrap(c.Request.Context())
	if err != nil {
		a.logger.Error("load verification policy", "error", err, "request_id", requestID(c))
		writeError(c, http.StatusInternalServerError, "internal_error", "Unable to load verification policy.")
		return
	}
	if state.Initialized && !state.RegistrationEnabled {
		writeError(c, http.StatusForbidden, "registration_disabled", "Registration is disabled.")
		return
	}
	if !state.EmailVerificationEnabled {
		writeError(c, http.StatusBadRequest, "email_verification_disabled", "Email verification is disabled.")
		return
	}
	if !a.mailer.Configured() {
		writeError(c, http.StatusServiceUnavailable, "email_delivery_unavailable", "Email delivery is not configured.")
		return
	}
	var request verificationCodeRequest
	if err := decodeJSON(c, &request); err != nil {
		writeDecodeError(c, err, "An email address is required.")
		return
	}
	request.Email = normalizeEmail(request.Email)
	if err := validateEmail(request.Email); err != nil {
		writeError(c, http.StatusBadRequest, "invalid_email", err.Error())
		return
	}
	codeNumber, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		a.logger.Error("generate verification code", "error", err, "request_id", requestID(c))
		writeError(c, http.StatusInternalServerError, "internal_error", "Unable to create a verification code.")
		return
	}
	code := fmt.Sprintf("%06d", codeNumber.Int64())
	expiresAt := time.Now().UTC().Add(10 * time.Minute)
	if err := a.repo.SaveEmailVerificationCode(c.Request.Context(), request.Email, verificationCodeHash(a.cfg.JWTSecret, request.Email, code), expiresAt); err != nil {
		a.logger.Error("save verification code", "error", err, "request_id", requestID(c))
		writeError(c, http.StatusInternalServerError, "internal_error", "Unable to create a verification code.")
		return
	}
	if err := a.mailer.SendVerificationCode(c.Request.Context(), request.Email, code, expiresAt); err != nil {
		a.logger.Error("send verification code", "error", err, "request_id", requestID(c))
		writeError(c, http.StatusServiceUnavailable, "email_delivery_failed", "Unable to send the verification code.")
		return
	}
	a.verificationLimiter.Reset(key)
	c.JSON(http.StatusAccepted, gin.H{"expires_in_seconds": 600})
}

func (a *API) logout(c *gin.Context) {
	a.clearSession(c)
	user := currentUser(c)
	if err := a.repo.RevokeSessions(c.Request.Context(), user.ID, user.TokenVersion); err != nil && !errors.Is(err, store.ErrConflict) {
		a.logger.Error("revoke session", "error", err, "request_id", requestID(c), "user_id", user.ID)
		writeError(c, http.StatusInternalServerError, "internal_error", "Unable to revoke the session.")
		return
	}
	c.Status(http.StatusNoContent)
}

func (a *API) me(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"user": currentUser(c)})
}

type updateOwnProfileRequest struct {
	Name string `json:"name"`
}

func (a *API) updateOwnProfile(c *gin.Context) {
	var request updateOwnProfileRequest
	if err := decodeJSON(c, &request); err != nil {
		writeDecodeError(c, err, "A name is required.")
		return
	}
	request.Name = strings.TrimSpace(request.Name)
	if err := validateName(request.Name); err != nil {
		writeError(c, http.StatusBadRequest, "invalid_name", err.Error())
		return
	}
	current := currentUser(c)
	user, err := a.repo.UpdateUser(c.Request.Context(), current.ID, request.Name, current.Email, current.Role, current.Status)
	if errors.Is(err, store.ErrConflict) {
		writeError(c, http.StatusConflict, "email_conflict", "The account email address is already in use.")
		return
	}
	if err != nil {
		a.logger.Error("update own profile", "error", err, "request_id", requestID(c), "user_id", current.ID)
		writeError(c, http.StatusInternalServerError, "internal_error", "Unable to update the profile.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": user})
}

func (a *API) setSession(c *gin.Context, user domain.User) error {
	raw, expiresAt, err := a.auth.Issue(user)
	if err != nil {
		return err
	}
	http.SetCookie(c.Writer, &http.Cookie{
		Name: a.cfg.CookieName, Value: raw, Path: "/", HttpOnly: true,
		Secure: requestUsesHTTPS(c), SameSite: http.SameSiteLaxMode,
		Expires: expiresAt, MaxAge: int(time.Until(expiresAt).Seconds()),
	})
	return nil
}

func (a *API) clearSession(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name: a.cfg.CookieName, Value: "", Path: "/", HttpOnly: true,
		Secure: requestUsesHTTPS(c), SameSite: http.SameSiteLaxMode,
		Expires: time.Unix(1, 0), MaxAge: -1,
	})
}

func requestUsesHTTPS(c *gin.Context) bool {
	if c.Request.TLS != nil {
		return true
	}
	forwardedProto := strings.TrimSpace(strings.Split(c.GetHeader("X-Forwarded-Proto"), ",")[0])
	return strings.EqualFold(forwardedProto, "https")
}

func validateRegistration(name, email, password string) error {
	if err := validateName(name); err != nil {
		return err
	}
	if err := validateEmail(email); err != nil {
		return err
	}
	return validatePassword(password)
}

func normalizeEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func verificationCodeHash(secret []byte, email, code string) string {
	hash := sha256.New()
	_, _ = hash.Write([]byte("narratium/email-verification/v1\x00"))
	_, _ = hash.Write(secret)
	_, _ = hash.Write([]byte("\x00" + email + "\x00" + code))
	return hex.EncodeToString(hash.Sum(nil))
}

func validateName(name string) error {
	nameLength := utf8.RuneCountInString(name)
	if nameLength < 1 || nameLength > 64 {
		return errors.New("Name must contain 1 to 64 characters.")
	}
	for _, char := range name {
		if char < 0x20 || char == 0x7f {
			return errors.New("Name contains unsupported characters.")
		}
	}
	return nil
}

func validatePassword(password string) error {
	passwordLength := utf8.RuneCountInString(password)
	if passwordLength < 10 || passwordLength > 128 {
		return errors.New("Password must contain 10 to 128 characters.")
	}
	if len([]byte(password)) > 72 {
		return errors.New("Password must not exceed 72 UTF-8 bytes.")
	}
	return nil
}

type loginAttempt struct {
	count     int
	windowEnd time.Time
}

type loginLimiter struct {
	mu          sync.Mutex
	limit       int
	duration    time.Duration
	attempts    map[string]loginAttempt
	lastCleanup time.Time
}

func newLoginLimiter(limit int, duration time.Duration) *loginLimiter {
	return &loginLimiter{limit: limit, duration: duration, attempts: make(map[string]loginAttempt)}
}

func (l *loginLimiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if l.lastCleanup.IsZero() || now.Sub(l.lastCleanup) >= l.duration {
		for attemptKey, candidate := range l.attempts {
			if now.After(candidate.windowEnd) {
				delete(l.attempts, attemptKey)
			}
		}
		l.lastCleanup = now
	}
	attempt := l.attempts[key]
	if now.After(attempt.windowEnd) {
		attempt = loginAttempt{windowEnd: now.Add(l.duration)}
	}
	attempt.count++
	l.attempts[key] = attempt
	return attempt.count <= l.limit
}

func (l *loginLimiter) Reset(key string) {
	l.mu.Lock()
	delete(l.attempts, key)
	l.mu.Unlock()
}
