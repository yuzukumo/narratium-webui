package httpapi

import (
	"sync"
	"time"
)

type chatLimitReason string

const (
	chatLimitRequests    chatLimitReason = "requests"
	chatLimitConcurrency chatLimitReason = "concurrency"
)

type chatLimitState struct {
	requests []time.Time
	active   int
	lastSeen time.Time
}

type chatLimiter struct {
	mu                sync.Mutex
	requestsPerMinute int
	maxConcurrent     int
	states            map[string]*chatLimitState
	now               func() time.Time
	lastCleanup       time.Time
}

func newChatLimiter(requestsPerMinute, maxConcurrent int) *chatLimiter {
	return &chatLimiter{
		requestsPerMinute: requestsPerMinute,
		maxConcurrent:     maxConcurrent,
		states:            make(map[string]*chatLimitState),
		now:               time.Now,
	}
}

func (l *chatLimiter) acquire(userID string) (release func(), retryAfter time.Duration, reason chatLimitReason, ok bool) {
	if l.requestsPerMinute < 1 && l.maxConcurrent < 1 {
		return func() {}, 0, "", true
	}
	l.mu.Lock()
	now := l.now()
	l.cleanupLocked(now)
	state := l.states[userID]
	if state == nil {
		state = &chatLimitState{}
		l.states[userID] = state
	}
	state.lastSeen = now

	if l.maxConcurrent > 0 && state.active >= l.maxConcurrent {
		l.mu.Unlock()
		return func() {}, time.Second, chatLimitConcurrency, false
	}

	if l.requestsPerMinute > 0 {
		windowStart := now.Add(-time.Minute)
		firstCurrent := 0
		for firstCurrent < len(state.requests) && !state.requests[firstCurrent].After(windowStart) {
			firstCurrent++
		}
		state.requests = append(state.requests[:0], state.requests[firstCurrent:]...)
		if len(state.requests) >= l.requestsPerMinute {
			retryAfter = state.requests[0].Add(time.Minute).Sub(now)
			if retryAfter < time.Second {
				retryAfter = time.Second
			}
			l.mu.Unlock()
			return func() {}, retryAfter, chatLimitRequests, false
		}
		state.requests = append(state.requests, now)
	}

	state.active++
	l.mu.Unlock()

	var once sync.Once
	return func() {
		once.Do(func() {
			l.mu.Lock()
			if current := l.states[userID]; current != nil {
				if current.active > 0 {
					current.active--
				}
				current.lastSeen = l.now()
			}
			l.mu.Unlock()
		})
	}, 0, "", true
}

func (l *chatLimiter) cleanupLocked(now time.Time) {
	if !l.lastCleanup.IsZero() && now.Sub(l.lastCleanup) < time.Minute {
		return
	}
	cutoff := now.Add(-2 * time.Minute)
	for userID, state := range l.states {
		if state.active == 0 && state.lastSeen.Before(cutoff) {
			delete(l.states, userID)
		}
	}
	l.lastCleanup = now
}
