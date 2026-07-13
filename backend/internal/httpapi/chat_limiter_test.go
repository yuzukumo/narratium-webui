package httpapi

import (
	"testing"
	"time"
)

func TestChatLimiterEnforcesConcurrencyAndReleases(t *testing.T) {
	limiter := newChatLimiter(10, 2)
	releaseOne, _, _, ok := limiter.acquire("user-1")
	if !ok {
		t.Fatal("first request was rejected")
	}
	releaseTwo, _, _, ok := limiter.acquire("user-1")
	if !ok {
		t.Fatal("second request was rejected")
	}
	if _, retryAfter, reason, ok := limiter.acquire("user-1"); ok || reason != chatLimitConcurrency || retryAfter < time.Second {
		t.Fatalf("concurrency result: ok=%v reason=%q retry_after=%s", ok, reason, retryAfter)
	}

	releaseOne()
	releaseOne()
	releaseThree, _, _, ok := limiter.acquire("user-1")
	if !ok {
		t.Fatal("request remained blocked after release")
	}
	releaseTwo()
	releaseThree()
}

func TestChatLimiterEnforcesRollingRequestWindow(t *testing.T) {
	limiter := newChatLimiter(2, 1)
	now := time.Date(2026, time.July, 10, 0, 0, 0, 0, time.UTC)
	limiter.now = func() time.Time { return now }
	for range 2 {
		release, _, _, ok := limiter.acquire("user-1")
		if !ok {
			t.Fatal("request was rejected before the limit")
		}
		release()
	}
	if _, retryAfter, reason, ok := limiter.acquire("user-1"); ok || reason != chatLimitRequests || retryAfter != time.Minute {
		t.Fatalf("request limit result: ok=%v reason=%q retry_after=%s", ok, reason, retryAfter)
	}

	now = now.Add(time.Minute + time.Nanosecond)
	release, _, _, ok := limiter.acquire("user-1")
	if !ok {
		t.Fatal("request remained blocked after the rolling window")
	}
	release()
}

func TestChatLimiterSeparatesUsers(t *testing.T) {
	limiter := newChatLimiter(1, 1)
	releaseOne, _, _, ok := limiter.acquire("user-1")
	if !ok {
		t.Fatal("first user was rejected")
	}
	releaseTwo, _, _, ok := limiter.acquire("user-2")
	if !ok {
		t.Fatal("second user shared the first user's limit")
	}
	releaseOne()
	releaseTwo()
}

func TestChatLimiterCanBeFullyDisabled(t *testing.T) {
	limiter := newChatLimiter(0, 0)
	for range 100 {
		release, retryAfter, reason, ok := limiter.acquire("user-1")
		if !ok || retryAfter != 0 || reason != "" {
			t.Fatalf("disabled limiter result: ok=%v reason=%q retry_after=%s", ok, reason, retryAfter)
		}
		release()
	}
	if len(limiter.states) != 0 {
		t.Fatalf("disabled limiter retained %d user states", len(limiter.states))
	}
}

func TestChatLimiterSupportsIndependentLimits(t *testing.T) {
	t.Run("requests only", func(t *testing.T) {
		limiter := newChatLimiter(1, 0)
		release, _, _, ok := limiter.acquire("user-1")
		if !ok {
			t.Fatal("first request was rejected")
		}
		release()
		if _, _, reason, ok := limiter.acquire("user-1"); ok || reason != chatLimitRequests {
			t.Fatalf("request-only result: ok=%v reason=%q", ok, reason)
		}
	})

	t.Run("concurrency only", func(t *testing.T) {
		limiter := newChatLimiter(0, 1)
		release, _, _, ok := limiter.acquire("user-1")
		if !ok {
			t.Fatal("first request was rejected")
		}
		if _, _, reason, ok := limiter.acquire("user-1"); ok || reason != chatLimitConcurrency {
			t.Fatalf("concurrency-only result: ok=%v reason=%q", ok, reason)
		}
		release()
	})
}
