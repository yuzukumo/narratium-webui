package modelmetadata

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/yuzukumo/narratium-webui/backend/internal/domain"
)

const (
	RatioConfigURL = "https://basellm.github.io/llm-metadata/api/newapi/ratio_config-v1-base.json"
	CatalogURL     = "https://models.dev/api.json"
	maxPayloadSize = 32 << 20
)

type Repository interface {
	ListModels(context.Context, bool) ([]domain.Model, error)
	UpdateModel(context.Context, domain.Model) (domain.Model, error)
}

type Synchronizer struct {
	repo       Repository
	client     *http.Client
	logger     *slog.Logger
	trigger    chan struct{}
	ratioURL   string
	catalogURL string
}

type SyncResult struct {
	ModelsSeen          int
	ModelsUpdated       int
	PricingUpdated      int
	CapabilitiesUpdated int
}

type ratioEnvelope struct {
	Data struct {
		CacheRatio      map[string]float64 `json:"cache_ratio"`
		CompletionRatio map[string]float64 `json:"completion_ratio"`
		ModelRatio      map[string]float64 `json:"model_ratio"`
		ModelPrice      map[string]float64 `json:"model_price"`
	} `json:"data"`
}

type catalogProvider struct {
	Models map[string]catalogModel `json:"models"`
}

type catalogModel struct {
	Limit struct {
		Context int `json:"context"`
		Output  int `json:"output"`
	} `json:"limit"`
	Reasoning        bool `json:"reasoning"`
	ReasoningOptions []struct {
		Type   string   `json:"type"`
		Values []string `json:"values"`
	} `json:"reasoning_options"`
	Cost struct {
		Input      *float64 `json:"input"`
		Output     *float64 `json:"output"`
		CacheRead  *float64 `json:"cache_read"`
		CacheWrite *float64 `json:"cache_write"`
	} `json:"cost"`
}

type metadataSources struct {
	ratios  ratioEnvelope
	catalog map[string]catalogProvider
}

type capabilityCandidate struct {
	capabilities domain.ModelCapabilities
	cost         catalogModel
}

func New(repo Repository, client *http.Client, logger *slog.Logger) *Synchronizer {
	return NewWithEndpoints(repo, client, logger, RatioConfigURL, CatalogURL)
}

func NewWithEndpoints(repo Repository, client *http.Client, logger *slog.Logger, ratioURL, catalogURL string) *Synchronizer {
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Synchronizer{
		repo: repo, client: client, logger: logger,
		trigger:  make(chan struct{}, 1),
		ratioURL: ratioURL, catalogURL: catalogURL,
	}
}

// Run performs an initial sync and then refreshes on demand or periodically.
func (s *Synchronizer) Run(ctx context.Context, interval time.Duration) {
	s.Trigger()
	if interval <= 0 {
		interval = 12 * time.Hour
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.trigger:
			s.syncOnce(ctx)
		case <-ticker.C:
			s.syncOnce(ctx)
		}
	}
}

func (s *Synchronizer) Trigger() {
	select {
	case s.trigger <- struct{}{}:
	default:
	}
}

func (s *Synchronizer) Sync(ctx context.Context) (SyncResult, error) {
	var result SyncResult
	if s.repo == nil {
		return result, errors.New("model metadata repository is nil")
	}
	sources, err := s.loadSources(ctx)
	if err != nil {
		return result, err
	}
	models, err := s.repo.ListModels(ctx, true)
	if err != nil {
		return result, fmt.Errorf("list models for metadata sync: %w", err)
	}
	result.ModelsSeen = len(models)
	for _, model := range models {
		updated, pricingChanged, capabilitiesChanged := applyMetadata(model, sources)
		if !pricingChanged && !capabilitiesChanged {
			continue
		}
		if _, err := s.repo.UpdateModel(ctx, updated); err != nil {
			return result, fmt.Errorf("update model %s metadata: %w", model.ExternalID, err)
		}
		result.ModelsUpdated++
		if pricingChanged {
			result.PricingUpdated++
		}
		if capabilitiesChanged {
			result.CapabilitiesUpdated++
		}
	}
	return result, nil
}

func (s *Synchronizer) syncOnce(ctx context.Context) {
	result, err := s.Sync(ctx)
	if err != nil {
		if ctx.Err() == nil {
			s.logger.Warn("model metadata sync failed", "error", err)
		}
		return
	}
	s.logger.Info("model metadata sync completed",
		"models_seen", result.ModelsSeen,
		"models_updated", result.ModelsUpdated,
		"pricing_updated", result.PricingUpdated,
		"capabilities_updated", result.CapabilitiesUpdated,
	)
}

func (s *Synchronizer) loadSources(ctx context.Context) (metadataSources, error) {
	var ratios ratioEnvelope
	ratioErr := fetchJSON(ctx, s.client, s.ratioURL, &ratios)
	var catalog map[string]catalogProvider
	catalogErr := fetchJSON(ctx, s.client, s.catalogURL, &catalog)
	if ratioErr != nil && catalogErr != nil {
		return metadataSources{}, fmt.Errorf("fetch metadata sources: ratio config: %v; model catalog: %v", ratioErr, catalogErr)
	}
	if ratioErr != nil {
		s.logger.Warn("BaseLLM ratio metadata is unavailable; using models.dev only", "error", ratioErr)
	}
	if catalogErr != nil {
		s.logger.Warn("models.dev metadata is unavailable; using BaseLLM ratios only", "error", catalogErr)
	}
	return metadataSources{ratios: ratios, catalog: catalog}, nil
}

func fetchJSON(ctx context.Context, client *http.Client, endpoint string, target any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("metadata endpoint returned HTTP %d", response.StatusCode)
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, maxPayloadSize))
	if err := decoder.Decode(target); err != nil {
		return err
	}
	return nil
}

func applyMetadata(model domain.Model, sources metadataSources) (domain.Model, bool, bool) {
	updated := model
	pricingChanged := false
	capabilitiesChanged := false
	candidate, hasCandidate, hasDirectPricing := findCapabilityCandidate(model.ExternalID, sources)

	if hasDirectPricing && validPrice(candidate.cost.Cost.Input) && validPrice(candidate.cost.Cost.Output) {
		// Keep the administrator's multiplier when refreshing upstream base prices.
		pricing := updated.Pricing
		pricing.InputMicrousdPerMillion, _ = dollarsToMicrousd(*candidate.cost.Cost.Input)
		pricing.OutputMicrousdPerMillion, _ = dollarsToMicrousd(*candidate.cost.Cost.Output)
		if validPrice(candidate.cost.Cost.CacheRead) {
			pricing.CacheReadMicrousdPerMillion, _ = dollarsToMicrousd(*candidate.cost.Cost.CacheRead)
		}
		if validPrice(candidate.cost.Cost.CacheWrite) {
			pricing.CacheCreationMicrousdPerMillion, _ = dollarsToMicrousd(*candidate.cost.Cost.CacheWrite)
		}
		if pricing != updated.Pricing {
			updated.Pricing = pricing
			pricingChanged = true
		}
	} else if modelRatio, hasModelRatio := sources.ratios.Data.ModelRatio[model.ExternalID]; hasModelRatio && modelRatio > 0 && finite(modelRatio) {
		inputPrice, inputOK := dollarsToMicrousd(modelRatio * 2)
		outputRatio, outputOK := sources.ratios.Data.CompletionRatio[model.ExternalID]
		if inputOK {
			if updated.Pricing.InputMicrousdPerMillion != inputPrice {
				updated.Pricing.InputMicrousdPerMillion = inputPrice
				pricingChanged = true
			}
			if outputOK && outputRatio > 0 && finite(outputRatio) {
				if outputPrice, ok := dollarsToMicrousd(float64(inputPrice) / 1_000_000 * outputRatio); ok && updated.Pricing.OutputMicrousdPerMillion != outputPrice {
					updated.Pricing.OutputMicrousdPerMillion = outputPrice
					pricingChanged = true
				}
			}
		}
		if cacheRatio, ok := sources.ratios.Data.CacheRatio[model.ExternalID]; ok && cacheRatio > 0 && finite(cacheRatio) && inputOK {
			if cachePrice, valid := dollarsToMicrousd(float64(inputPrice) / 1_000_000 * cacheRatio); valid && updated.Pricing.CacheReadMicrousdPerMillion != cachePrice {
				updated.Pricing.CacheReadMicrousdPerMillion = cachePrice
				pricingChanged = true
			}
		}
	}

	if hasCandidate {
		current, err := domain.ParseModelCapabilities(model.Capabilities, model.Provider)
		if err == nil && !current.Configured() {
			updated.Capabilities = candidate.capabilities.JSON()
			capabilitiesChanged = true
		}
	}
	return updated, pricingChanged, capabilitiesChanged
}

func findCapabilityCandidate(modelID string, sources metadataSources) (capabilityCandidate, bool, bool) {
	providerIDs := make([]string, 0, len(sources.catalog))
	for providerID := range sources.catalog {
		providerIDs = append(providerIDs, providerID)
	}
	sort.Strings(providerIDs)
	preferred := preferredProviderIDs(modelID)
	preferredIDs := make([]string, 0, len(preferred))
	for _, providerID := range preferred {
		provider, exists := sources.catalog[providerID]
		if exists {
			if _, hasExactModel := provider.Models[modelID]; !hasExactModel {
				continue
			}
			preferredIDs = append(preferredIDs, providerID)
		}
	}
	if len(preferredIDs) > 0 {
		providerIDs = preferredIDs
	}
	var candidates []capabilityCandidate
	for _, providerID := range providerIDs {
		model, ok := sources.catalog[providerID].Models[modelID]
		if !ok {
			continue
		}
		contextWindow := model.Limit.Context
		maxOutput := model.Limit.Output
		if contextWindow < 1024 || maxOutput < 1 || maxOutput > contextWindow {
			continue
		}
		effort := ""
		supportedEfforts := []string(nil)
		if model.Reasoning {
			effort = "medium"
			for _, option := range model.ReasoningOptions {
				if option.Type != "effort" || len(option.Values) == 0 {
					continue
				}
				supportedEfforts = uniqueEfforts(option.Values)
				if contains(option.Values, "medium") {
					effort = "medium"
				} else {
					effort = option.Values[0]
				}
				break
			}
		}
		candidates = append(candidates, capabilityCandidate{
			capabilities: domain.ModelCapabilities{
				SchemaVersion:       domain.ModelCapabilitiesSchemaVersion,
				ContextWindow:       contextWindow,
				CompactionThreshold: contextWindow * 95 / 100,
				MaxOutputTokens:     maxOutput,
				Reasoning:           domain.ReasoningCapabilities{Enabled: model.Reasoning, Effort: effort, SupportedEfforts: supportedEfforts},
			},
			cost: model,
		})
	}
	if len(candidates) == 0 {
		return capabilityCandidate{}, false, false
	}
	modelRatio, hasRatio := sources.ratios.Data.ModelRatio[modelID]
	pricingConsistent := true
	if hasRatio && modelRatio > 0 {
		matching := candidates[:0]
		for _, candidate := range candidates {
			if positivePrice(candidate.cost.Cost.Input) && closeEnough(*candidate.cost.Cost.Input/2, modelRatio) {
				if outputRatio, exists := sources.ratios.Data.CompletionRatio[modelID]; exists {
					if !positivePrice(candidate.cost.Cost.Output) || !closeEnough(*candidate.cost.Cost.Output / *candidate.cost.Cost.Input, outputRatio) {
						continue
					}
				}
				if cacheRatio, exists := sources.ratios.Data.CacheRatio[modelID]; exists {
					if !positivePrice(candidate.cost.Cost.CacheRead) || !closeEnough(*candidate.cost.Cost.CacheRead / *candidate.cost.Cost.Input, cacheRatio) {
						continue
					}
				}
				matching = append(matching, candidate)
			}
		}
		if len(matching) > 0 {
			candidates = matching
		} else {
			pricingConsistent = false
		}
	}
	first := candidates[0]
	for _, candidate := range candidates[1:] {
		if candidate.capabilities.ContextWindow != first.capabilities.ContextWindow ||
			candidate.capabilities.MaxOutputTokens != first.capabilities.MaxOutputTokens ||
			candidate.capabilities.Reasoning.Enabled != first.capabilities.Reasoning.Enabled ||
			candidate.capabilities.Reasoning.Effort != first.capabilities.Reasoning.Effort ||
			!slices.Equal(candidate.capabilities.Reasoning.SupportedEfforts, first.capabilities.Reasoning.SupportedEfforts) {
			return capabilityCandidate{}, false, false
		}
	}
	return first, true, pricingConsistent && sameDirectPricing(candidates)
}

func preferredProviderIDs(modelID string) []string {
	lower := strings.ToLower(modelID)
	switch {
	case strings.HasPrefix(lower, "gpt-") || strings.HasPrefix(lower, "gpt") || strings.HasPrefix(lower, "codex"):
		return []string{"openai"}
	case strings.Contains(lower, "claude") || strings.Contains(lower, "fable"):
		return []string{"anthropic", "google-vertex-anthropic"}
	case strings.HasPrefix(lower, "gemini") || strings.HasPrefix(lower, "gemma"):
		return []string{"google", "google-vertex"}
	case strings.Contains(lower, "glm"):
		return []string{"zai", "zhipuai"}
	default:
		return nil
	}
}

func sameDirectPricing(candidates []capabilityCandidate) bool {
	if len(candidates) == 0 || !validPrice(candidates[0].cost.Cost.Input) || !validPrice(candidates[0].cost.Cost.Output) {
		return false
	}
	first := candidates[0].cost.Cost
	for _, candidate := range candidates[1:] {
		cost := candidate.cost.Cost
		if !samePrice(first.Input, cost.Input) || !samePrice(first.Output, cost.Output) ||
			!samePrice(first.CacheRead, cost.CacheRead) || !samePrice(first.CacheWrite, cost.CacheWrite) {
			return false
		}
	}
	return true
}

func samePrice(left, right *float64) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return closeEnough(*left, *right)
}

func validPrice(value *float64) bool {
	return value != nil && *value >= 0 && finite(*value) && *value <= 1_000_000
}

func positivePrice(value *float64) bool {
	return validPrice(value) && *value > 0
}

func dollarsToMicrousd(value float64) (int64, bool) {
	if !finite(value) || value < 0 || value > 1_000_000 {
		return 0, false
	}
	return int64(math.Round(value * 1_000_000)), true
}

func finite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func closeEnough(left, right float64) bool {
	return math.Abs(left-right) <= math.Max(0.000001, math.Abs(right)*0.00001)
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func uniqueEfforts(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" || len(value) > 64 {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}
