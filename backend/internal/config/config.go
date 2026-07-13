package config

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultDatabaseURL = "postgres://narratium:narratium@narratium-postgres:5432/narratium?sslmode=disable"
	bytesPerGB         = int64(1 << 30)
)

type Config struct {
	Address                   string
	DatabaseURL               string
	JWTSecret                 []byte
	EncryptionKey             []byte
	CookieName                string
	SessionTTL                time.Duration
	AllowedOrigins            []string
	TrustedProxies            []string
	StaticDir                 string
	MaxJSONBodyBytes          int64
	MaxBlobBytes              int64
	MaxBlobsPerUser           int
	MaxBlobTotalBytes         int64
	UpstreamTimeout           time.Duration
	MaxOutputTokens           int
	ChatRequestsPM            int
	ChatConcurrency           int
	AllowPrivateProviderHosts bool
	AllowInsecureProviderHTTP bool
	SMTPHost                  string
	SMTPPort                  int
	SMTPUsername              string
	SMTPPassword              string
	SMTPFrom                  string
	SMTPImplicitTLS           bool
}

func Load() (Config, error) {
	masterSecret := strings.TrimSpace(os.Getenv("NARRATIUM_SECRET"))
	if len(masterSecret) < 32 {
		return Config{}, errors.New("NARRATIUM_SECRET is required and must be at least 32 bytes")
	}
	maxBlobTotalBytes, err := blobTotalBytesEnv()
	if err != nil {
		return Config{}, err
	}
	cfg := Config{
		Address:                   env("NARRATIUM_ADDRESS", ":8080"),
		DatabaseURL:               env("NARRATIUM_DATABASE_URL", defaultDatabaseURL),
		CookieName:                env("NARRATIUM_COOKIE_NAME", "narratium_session"),
		StaticDir:                 env("NARRATIUM_STATIC_DIR", "out"),
		SessionTTL:                durationEnv("NARRATIUM_SESSION_TTL", 7*24*time.Hour),
		UpstreamTimeout:           durationEnv("NARRATIUM_UPSTREAM_TIMEOUT", 5*time.Minute),
		MaxJSONBodyBytes:          int64Env("NARRATIUM_MAX_JSON_BODY_BYTES", 4<<20),
		MaxBlobBytes:              nonNegativeInt64Env("NARRATIUM_MAX_BLOB_BYTES", 0),
		MaxBlobsPerUser:           nonNegativeIntEnv("NARRATIUM_MAX_BLOBS_PER_USER", 0),
		MaxBlobTotalBytes:         maxBlobTotalBytes,
		MaxOutputTokens:           nonNegativeIntEnv("NARRATIUM_MAX_OUTPUT_TOKENS", 0),
		ChatRequestsPM:            nonNegativeIntEnv("NARRATIUM_CHAT_REQUESTS_PER_MINUTE", 0),
		ChatConcurrency:           nonNegativeIntEnv("NARRATIUM_CHAT_MAX_CONCURRENT_PER_USER", 0),
		AllowPrivateProviderHosts: boolEnv("NARRATIUM_ALLOW_PRIVATE_PROVIDER_HOSTS", true),
		AllowInsecureProviderHTTP: boolEnv("NARRATIUM_ALLOW_INSECURE_PROVIDER_HTTP", true),
	}
	if err := loadSMTPConfig(&cfg); err != nil {
		return Config{}, err
	}
	jwtSecret := sha256.Sum256([]byte("narratium/jwt/v1\x00" + masterSecret))
	encryptionKey := sha256.Sum256([]byte("narratium/encryption/v1\x00" + masterSecret))
	cfg.JWTSecret = jwtSecret[:]
	cfg.EncryptionKey = encryptionKey[:]

	if origins := strings.TrimSpace(os.Getenv("NARRATIUM_ALLOWED_ORIGINS")); origins != "" {
		for _, origin := range strings.Split(origins, ",") {
			if value := strings.TrimSpace(origin); value != "" {
				cfg.AllowedOrigins = append(cfg.AllowedOrigins, strings.TrimRight(value, "/"))
			}
		}
	}
	if proxies := strings.TrimSpace(os.Getenv("NARRATIUM_TRUSTED_PROXIES")); proxies != "" {
		for _, proxy := range strings.Split(proxies, ",") {
			value := strings.TrimSpace(proxy)
			if value == "" {
				continue
			}
			if net.ParseIP(value) == nil {
				if _, _, err := net.ParseCIDR(value); err != nil {
					return Config{}, fmt.Errorf("NARRATIUM_TRUSTED_PROXIES contains invalid address %q", value)
				}
			}
			cfg.TrustedProxies = append(cfg.TrustedProxies, value)
		}
	}

	return cfg, nil
}

func loadSMTPConfig(cfg *Config) error {
	raw := strings.TrimSpace(os.Getenv("NARRATIUM_SMTP_URL"))
	if raw == "" {
		return nil
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "smtp" && parsed.Scheme != "smtps") || parsed.Hostname() == "" {
		return errors.New("NARRATIUM_SMTP_URL must be an smtp:// or smtps:// URL")
	}
	port := 587
	if parsed.Scheme == "smtps" {
		port = 465
	}
	if parsed.Port() != "" {
		port, err = strconv.Atoi(parsed.Port())
		if err != nil || port < 1 || port > 65535 {
			return errors.New("NARRATIUM_SMTP_URL contains an invalid port")
		}
	}
	cfg.SMTPHost = parsed.Hostname()
	cfg.SMTPPort = port
	cfg.SMTPImplicitTLS = parsed.Scheme == "smtps"
	if parsed.User != nil {
		cfg.SMTPUsername = parsed.User.Username()
		cfg.SMTPPassword, _ = parsed.User.Password()
	}
	cfg.SMTPFrom = strings.TrimSpace(os.Getenv("NARRATIUM_SMTP_FROM"))
	if cfg.SMTPFrom == "" {
		cfg.SMTPFrom = cfg.SMTPUsername
	}
	if cfg.SMTPFrom == "" {
		return errors.New("NARRATIUM_SMTP_FROM is required when NARRATIUM_SMTP_URL is configured")
	}
	return nil
}

func env(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func durationEnv(name string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func int64Env(name string, fallback int64) int64 {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func intEnv(name string, fallback int) int {
	value := int64Env(name, int64(fallback))
	maxInt := int64(^uint(0) >> 1)
	if value > maxInt {
		return fallback
	}
	return int(value)
}

func nonNegativeInt64Env(name string, fallback int64) int64 {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed < 0 {
		return fallback
	}
	return parsed
}

func nonNegativeIntEnv(name string, fallback int) int {
	value := nonNegativeInt64Env(name, int64(fallback))
	maxInt := int64(^uint(0) >> 1)
	if value > maxInt {
		return fallback
	}
	return int(value)
}

func blobTotalBytesEnv() (int64, error) {
	raw := strings.TrimSpace(os.Getenv("NARRATIUM_MAX_BLOB_TOTAL_GB"))
	if raw == "" {
		return 2 * bytesPerGB, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 0 || value > int64(^uint64(0)>>1)/bytesPerGB {
		return 0, errors.New("NARRATIUM_MAX_BLOB_TOTAL_GB must be a non-negative whole number")
	}
	return value * bytesPerGB, nil
}

func boolEnv(name string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func (c Config) ValidateOrigin(origin string) bool {
	origin = strings.TrimRight(strings.TrimSpace(origin), "/")
	if origin == "" {
		return true
	}
	for _, allowed := range c.AllowedOrigins {
		if origin == allowed {
			return true
		}
	}
	return false
}

func (c Config) String() string {
	return fmt.Sprintf("address=%s static_dir=%s", c.Address, c.StaticDir)
}
