package auth

import (
	"testing"
	"time"

	"github.com/yuzukumo/narratium-webui/backend/internal/domain"
)

func TestIssueAndParse(t *testing.T) {
	service := New([]byte("01234567890123456789012345678901"), time.Hour)
	raw, _, err := service.Issue(domain.User{ID: "user-id", TokenVersion: 4})
	if err != nil {
		t.Fatal(err)
	}
	claims, err := service.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if claims.Subject != "user-id" || claims.TokenVersion != 4 {
		t.Fatalf("unexpected claims: %#v", claims)
	}
}

func TestParseRejectsDifferentSecret(t *testing.T) {
	issuer := New([]byte("01234567890123456789012345678901"), time.Hour)
	raw, _, err := issuer.Issue(domain.User{ID: "user-id", TokenVersion: 1})
	if err != nil {
		t.Fatal(err)
	}
	parser := New([]byte("abcdefghijklmnopqrstuvwxyz123456"), time.Hour)
	if _, err := parser.Parse(raw); !errorsIs(err, ErrInvalidToken) {
		t.Fatalf("expected invalid token, got %v", err)
	}
}

func errorsIs(err, target error) bool {
	return err == target
}
