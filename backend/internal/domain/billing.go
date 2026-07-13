package domain

import (
	"errors"
	"math"
	"math/big"
	"regexp"
	"strings"
	"time"
)

const (
	MicroUSDPerUSD          int64 = 1_000_000
	PricingTokenUnit        int64 = 1_000_000
	MaxPriceMicroUSD        int64 = 1_000_000_000_000
	DefaultPriceMultiplier        = "1"
	LedgerKindAdjustment          = "adjustment"
	LedgerKindQuotaAdd            = "quota_add"
	LedgerKindQuotaSubtract       = "quota_subtract"
	LedgerKindQuotaOverride       = "quota_override"
	LedgerKindUsageCharge         = "usage_charge"
)

const (
	BalanceAdjustmentAdd      = "add"
	BalanceAdjustmentSubtract = "subtract"
	BalanceAdjustmentOverride = "override"
)

var priceMultiplierPattern = regexp.MustCompile(`^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$`)

type ModelPricing struct {
	InputMicrousdPerMillion         int64  `json:"input_microusd_per_million,string"`
	OutputMicrousdPerMillion        int64  `json:"output_microusd_per_million,string"`
	CacheReadMicrousdPerMillion     int64  `json:"cache_read_microusd_per_million,string"`
	CacheCreationMicrousdPerMillion int64  `json:"cache_creation_microusd_per_million,string"`
	PriceMultiplier                 string `json:"price_multiplier"`
}

func (pricing ModelPricing) Validate() error {
	values := []int64{
		pricing.InputMicrousdPerMillion,
		pricing.OutputMicrousdPerMillion,
		pricing.CacheReadMicrousdPerMillion,
		pricing.CacheCreationMicrousdPerMillion,
	}
	for _, value := range values {
		if value < 0 || value > MaxPriceMicroUSD {
			return errors.New("model prices must be between 0 and 1000000 USD per million tokens")
		}
	}
	if _, err := pricing.MultiplierRat(); err != nil {
		return err
	}
	return nil
}

// MultiplierRat parses the administrator's original decimal representation
// without going through float64. The string is intentionally retained on the
// model so values such as 1.20 remain visible as 1.20 in the administration UI.
func (pricing ModelPricing) MultiplierRat() (*big.Rat, error) {
	raw := strings.TrimSpace(pricing.PriceMultiplier)
	if raw == "" {
		raw = DefaultPriceMultiplier
	}
	if !priceMultiplierPattern.MatchString(raw) {
		return nil, errors.New("price_multiplier must be a non-negative decimal")
	}
	rat, ok := new(big.Rat).SetString(raw)
	if !ok || rat.Sign() < 0 {
		return nil, errors.New("price_multiplier must be a non-negative decimal")
	}
	if rat.Cmp(big.NewRat(1_000_000, 1)) > 0 {
		return nil, errors.New("price_multiplier must not exceed 1000000")
	}
	return rat, nil
}

func (pricing ModelPricing) NormalizedMultiplier() string {
	if strings.TrimSpace(pricing.PriceMultiplier) == "" {
		return DefaultPriceMultiplier
	}
	return strings.TrimSpace(pricing.PriceMultiplier)
}

func (pricing ModelPricing) MaxInputRate() int64 {
	return max(
		pricing.InputMicrousdPerMillion,
		pricing.CacheReadMicrousdPerMillion,
		pricing.CacheCreationMicrousdPerMillion,
	)
}

type BillingReservation struct {
	ID                    string    `json:"id"`
	UserID                string    `json:"user_id"`
	ModelID               string    `json:"model_id"`
	RequestID             string    `json:"request_id"`
	EstimatedCostMicrousd int64     `json:"estimated_cost_microusd,string"`
	ActualCostMicrousd    int64     `json:"actual_cost_microusd,string"`
	ChargedMicrousd       int64     `json:"charged_microusd,string"`
	BalanceAfterMicrousd  int64     `json:"balance_after_microusd,string"`
	Status                string    `json:"status"`
	ExpiresAt             time.Time `json:"expires_at"`
	CreatedAt             time.Time `json:"created_at"`
	SettledAt             time.Time `json:"settled_at,omitempty"`
}

type BillingSettlement struct {
	CostMicrousd             int64 `json:"cost_microusd,string"`
	ChargedMicrousd          int64 `json:"charged_microusd,string"`
	UnbilledMicrousd         int64 `json:"unbilled_microusd,string"`
	BalanceMicrousd          int64 `json:"balance_microusd,string"`
	ReservedMicrousd         int64 `json:"reserved_microusd,string"`
	AvailableBalanceMicrousd int64 `json:"available_balance_microusd,string"`
}

type BalanceLedgerEntry struct {
	ID                   string    `json:"id"`
	UserID               string    `json:"user_id"`
	ActorUserID          string    `json:"actor_user_id,omitempty"`
	ModelID              string    `json:"model_id,omitempty"`
	UsageLogID           string    `json:"usage_log_id,omitempty"`
	RequestID            string    `json:"request_id,omitempty"`
	Kind                 string    `json:"kind"`
	AmountMicrousd       int64     `json:"amount_microusd,string"`
	BalanceAfterMicrousd int64     `json:"balance_after_microusd,string"`
	Note                 string    `json:"note"`
	CreatedAt            time.Time `json:"created_at"`
}

func CalculateUsageCost(provider string, pricing ModelPricing, usage UsageLog) int64 {
	outputTokens := max(usage.OutputTokens, 0)
	if strings.EqualFold(provider, "gemini") {
		outputTokens = saturatingAdd(outputTokens, max(usage.ReasoningTokens, 0))
	}
	multiplier, err := pricing.MultiplierRat()
	if err != nil {
		multiplier = big.NewRat(1, 1)
	}
	return saturatingSum(
		priceTokens(max(usage.InputTokens, 0), pricing.InputMicrousdPerMillion, multiplier),
		priceTokens(outputTokens, pricing.OutputMicrousdPerMillion, multiplier),
		priceTokens(max(usage.CacheReadInputTokens, 0), pricing.CacheReadMicrousdPerMillion, multiplier),
		priceTokens(max(usage.CacheCreationInputTokens, 0), pricing.CacheCreationMicrousdPerMillion, multiplier),
	)
}

func EstimateMaximumCost(pricing ModelPricing, inputTokenUpperBound, maxOutputTokens int64) int64 {
	multiplier, err := pricing.MultiplierRat()
	if err != nil {
		multiplier = big.NewRat(1, 1)
	}
	return saturatingSum(
		priceTokens(max(inputTokenUpperBound, 0), pricing.MaxInputRate(), multiplier),
		priceTokens(max(maxOutputTokens, 0), pricing.OutputMicrousdPerMillion, multiplier),
	)
}

func priceTokens(tokens, rate int64, multiplier *big.Rat) int64 {
	if tokens <= 0 || rate <= 0 {
		return 0
	}
	if multiplier == nil {
		multiplier = big.NewRat(1, 1)
	}
	// tokens * (microUSD / 1,000,000 tokens) * multiplier, rounded up to
	// the smallest billable unit. big.Int keeps this exact for long contexts
	// and decimal multipliers with many significant digits.
	numerator := new(big.Int).Mul(big.NewInt(tokens), big.NewInt(rate))
	numerator.Mul(numerator, multiplier.Num())
	denominator := new(big.Int).Mul(big.NewInt(PricingTokenUnit), multiplier.Denom())
	quotient, remainder := new(big.Int).QuoRem(numerator, denominator, new(big.Int))
	if remainder.Sign() != 0 {
		quotient.Add(quotient, big.NewInt(1))
	}
	if !quotient.IsInt64() {
		return math.MaxInt64
	}
	return quotient.Int64()
}

func saturatingMultiply(left, right int64) int64 {
	if left <= 0 || right <= 0 {
		return 0
	}
	if left > math.MaxInt64/right {
		return math.MaxInt64
	}
	return left * right
}

func saturatingAdd(left, right int64) int64 {
	if right > 0 && left > math.MaxInt64-right {
		return math.MaxInt64
	}
	return left + right
}

func saturatingSum(values ...int64) int64 {
	var total int64
	for _, value := range values {
		total = saturatingAdd(total, value)
	}
	return total
}
