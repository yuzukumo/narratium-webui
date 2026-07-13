package domain

import "testing"

func TestCalculateUsageCostUsesNormalizedTokenClasses(t *testing.T) {
	pricing := ModelPricing{
		InputMicrousdPerMillion:         2_000_000,
		OutputMicrousdPerMillion:        3_000_000,
		CacheReadMicrousdPerMillion:     1_000_000,
		CacheCreationMicrousdPerMillion: 4_000_000,
	}
	usage := UsageLog{
		InputTokens: 10, OutputTokens: 5, ReasoningTokens: 3,
		CacheReadInputTokens: 4, CacheCreationInputTokens: 2,
	}

	tests := []struct {
		provider string
		want     int64
	}{
		{provider: "openai", want: 47},
		{provider: "anthropic", want: 47},
		{provider: "gemini", want: 56},
	}
	for _, test := range tests {
		t.Run(test.provider, func(t *testing.T) {
			if got := CalculateUsageCost(test.provider, pricing, usage); got != test.want {
				t.Fatalf("cost = %d microusd, want %d", got, test.want)
			}
		})
	}
}

func TestCalculateUsageCostRoundsEachPriceClassUpToMicrousd(t *testing.T) {
	pricing := ModelPricing{
		InputMicrousdPerMillion:         1,
		OutputMicrousdPerMillion:        1,
		CacheReadMicrousdPerMillion:     1,
		CacheCreationMicrousdPerMillion: 1,
	}
	usage := UsageLog{
		InputTokens: 1, OutputTokens: 1,
		CacheReadInputTokens: 1, CacheCreationInputTokens: 1,
	}
	if got := CalculateUsageCost("openai", pricing, usage); got != 4 {
		t.Fatalf("cost = %d microusd, want 4", got)
	}
}

func TestEstimateMaximumCostUsesHighestInputClassRate(t *testing.T) {
	pricing := ModelPricing{
		InputMicrousdPerMillion:         2_000_000,
		OutputMicrousdPerMillion:        3_000_000,
		CacheReadMicrousdPerMillion:     1_000_000,
		CacheCreationMicrousdPerMillion: 5_000_000,
	}
	if got := EstimateMaximumCost(pricing, 10, 4); got != 62 {
		t.Fatalf("maximum cost = %d microusd, want 62", got)
	}
}

func TestPriceMultiplierIsExactAndPreservesAdministratorPrecision(t *testing.T) {
	pricing := ModelPricing{
		InputMicrousdPerMillion: 2_000_000,
		PriceMultiplier:         "1.20",
	}
	if got := pricing.NormalizedMultiplier(); got != "1.20" {
		t.Fatalf("normalized multiplier = %q, want original precision", got)
	}
	usage := UsageLog{InputTokens: 500_000}
	if got := CalculateUsageCost("openai", pricing, usage); got != 1_200_000 {
		t.Fatalf("multiplied cost = %d microusd, want 1200000", got)
	}
}

func TestPriceMultiplierRoundsOnlyAtTheSmallestBillingUnit(t *testing.T) {
	pricing := ModelPricing{
		InputMicrousdPerMillion: 1,
		PriceMultiplier:         "0.1250",
	}
	if got := CalculateUsageCost("openai", pricing, UsageLog{InputTokens: 1}); got != 1 {
		t.Fatalf("multiplied cost = %d microusd, want one rounded microusd", got)
	}
}

func TestPriceMultiplierRejectsInvalidDecimals(t *testing.T) {
	for _, value := range []string{"-1", "1e2", ".5", "1.", "1000000.1"} {
		pricing := ModelPricing{PriceMultiplier: value}
		if err := pricing.Validate(); err == nil {
			t.Fatalf("multiplier %q unexpectedly validated", value)
		}
	}
}
