package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/yuzukumo/narratium-webui/backend/internal/domain"
)

const issuer = "narratium"

var ErrInvalidToken = errors.New("invalid session token")

type Claims struct {
	TokenVersion int64 `json:"ver"`
	jwt.RegisteredClaims
}

type Service struct {
	secret []byte
	ttl    time.Duration
	now    func() time.Time
}

func New(secret []byte, ttl time.Duration) *Service {
	return &Service{secret: secret, ttl: ttl, now: time.Now}
}

func (s *Service) Issue(user domain.User) (string, time.Time, error) {
	now := s.now().UTC()
	expiresAt := now.Add(s.ttl)
	claims := Claims{
		TokenVersion: user.TokenVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Subject:   user.ID,
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now.Add(-5 * time.Second)),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(s.secret)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("sign session token: %w", err)
	}
	return signed, expiresAt, nil
}

func (s *Service) Parse(raw string) (Claims, error) {
	token, err := jwt.ParseWithClaims(raw, &Claims{}, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, ErrInvalidToken
		}
		return s.secret, nil
	}, jwt.WithIssuer(issuer), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	if err != nil || !token.Valid {
		return Claims{}, ErrInvalidToken
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || claims.Subject == "" || claims.TokenVersion < 1 {
		return Claims{}, ErrInvalidToken
	}
	return *claims, nil
}
