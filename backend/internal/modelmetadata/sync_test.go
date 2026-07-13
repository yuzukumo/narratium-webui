package modelmetadata

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/yuzukumo/narratium-webui/backend/internal/domain"
)

type memoryRepository struct {
	models map[string]domain.Model
}

func (r *memoryRepository) ListModels(context.Context, bool) ([]domain.Model, error) {
	items := make([]domain.Model, 0, len(r.models))
	for _, item := range r.models {
		items = append(items, item)
	}
	return items, nil
}

func (r *memoryRepository) UpdateModel(_ context.Context, item domain.Model) (domain.Model, error) {
	r.models[item.ID] = item
	return item, nil
}

func TestSyncStrictlyMatchesModelIDsAndFillsMetadata(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/ratios.json":
			_, _ = writer.Write([]byte(`{"data":{"model_ratio":{"test-model":1.5},"completion_ratio":{"test-model":2},"cache_ratio":{"test-model":0.5},"model_price":{}}}`))
		case "/catalog.json":
			_, _ = writer.Write([]byte(`{"provider":{"models":{"test-model":{"limit":{"context":10000,"output":2000},"reasoning":true,"reasoning_options":[{"type":"effort","values":["low","medium","high"]}],"cost":{"input":3,"output":6,"cache_read":1.5,"cache_write":0.2}}}}}`))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	repository := &memoryRepository{models: map[string]domain.Model{
		"known": {ID: "known", ExternalID: "test-model", Provider: "openai", Capabilities: json.RawMessage(`{}`)},
		"alias": {ID: "alias", ExternalID: "test-model-alias", Provider: "openai", Capabilities: json.RawMessage(`{}`)},
	}}
	synchronizer := NewWithEndpoints(repository, server.Client(), slog.Default(), server.URL+"/ratios.json", server.URL+"/catalog.json")
	result, err := synchronizer.Sync(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.ModelsUpdated != 1 || result.PricingUpdated != 1 || result.CapabilitiesUpdated != 1 {
		t.Fatalf("unexpected sync result: %+v", result)
	}

	known := repository.models["known"]
	if known.Pricing.InputMicrousdPerMillion != 3_000_000 ||
		known.Pricing.OutputMicrousdPerMillion != 6_000_000 ||
		known.Pricing.CacheReadMicrousdPerMillion != 1_500_000 ||
		known.Pricing.CacheCreationMicrousdPerMillion != 200_000 {
		t.Fatalf("unexpected pricing: %+v", known.Pricing)
	}
	capabilities, err := domain.ParseModelCapabilities(known.Capabilities, known.Provider)
	if err != nil {
		t.Fatal(err)
	}
	if capabilities.ContextWindow != 10000 || capabilities.CompactionThreshold != 9500 ||
		capabilities.MaxOutputTokens != 2000 || !capabilities.Reasoning.Enabled || capabilities.Reasoning.Effort != "medium" {
		t.Fatalf("unexpected capabilities: %+v", capabilities)
	}
	if string(repository.models["alias"].Capabilities) != "{}" {
		t.Fatalf("non-exact model ID was modified: %s", repository.models["alias"].Capabilities)
	}
}

func TestSyncDoesNotReplaceExistingCapabilitiesWhenSourceChanges(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		if request.URL.Path == "/ratios.json" {
			_, _ = writer.Write([]byte(`{"data":{"model_ratio":{"model":1},"completion_ratio":{"model":1}}}`))
			return
		}
		_, _ = writer.Write([]byte(`{"provider":{"models":{"model":{"limit":{"context":200000,"output":1000},"reasoning":false,"cost":{"input":2,"output":2}}}}}`))
	}))
	defer server.Close()

	configured := domain.ModelCapabilities{
		SchemaVersion: domain.ModelCapabilitiesSchemaVersion,
		ContextWindow: 8192, CompactionThreshold: 7800, MaxOutputTokens: 512,
		Reasoning: domain.ReasoningCapabilities{Enabled: true, Effort: "high"},
	}.JSON()
	repository := &memoryRepository{models: map[string]domain.Model{
		"model": {ID: "model", ExternalID: "model", Provider: "openai", Capabilities: configured},
	}}
	synchronizer := NewWithEndpoints(repository, server.Client(), slog.Default(), server.URL+"/ratios.json", server.URL+"/catalog.json")
	if _, err := synchronizer.Sync(context.Background()); err != nil {
		t.Fatal(err)
	}
	capabilities, err := domain.ParseModelCapabilities(repository.models["model"].Capabilities, "openai")
	if err != nil {
		t.Fatal(err)
	}
	if capabilities.ContextWindow != 8192 || capabilities.Reasoning.Effort != "high" {
		t.Fatalf("existing capabilities were overwritten: %+v", capabilities)
	}
}

func TestFindCapabilityCandidateFallsBackWhenCanonicalProviderLacksExactID(t *testing.T) {
	sources := metadataSources{catalog: map[string]catalogProvider{
		"openai": {
			Models: map[string]catalogModel{"another-model": catalogModelWithLimits(128000, 16384)},
		},
		"community": {
			Models: map[string]catalogModel{"gpt-local-exact": catalogModelWithLimits(32768, 4096)},
		},
	}}

	candidate, found, _ := findCapabilityCandidate("gpt-local-exact", sources)
	if !found {
		t.Fatal("exact model ID from a non-canonical provider was not found")
	}
	if candidate.capabilities.ContextWindow != 32768 || candidate.capabilities.MaxOutputTokens != 4096 {
		t.Fatalf("unexpected capabilities: %+v", candidate.capabilities)
	}
}

func TestFindCapabilityCandidatePrefersCanonicalProviderWithExactID(t *testing.T) {
	canonical := catalogModelWithLimits(400000, 128000)
	alternative := catalogModelWithLimits(128000, 16384)
	sources := metadataSources{catalog: map[string]catalogProvider{
		"openai":    {Models: map[string]catalogModel{"gpt-official": canonical}},
		"community": {Models: map[string]catalogModel{"gpt-official": alternative}},
	}}

	candidate, found, _ := findCapabilityCandidate("gpt-official", sources)
	if !found {
		t.Fatal("canonical exact model ID was not found")
	}
	if candidate.capabilities.ContextWindow != 400000 || candidate.capabilities.MaxOutputTokens != 128000 {
		t.Fatalf("canonical provider was not preferred: %+v", candidate.capabilities)
	}
}

func catalogModelWithLimits(contextWindow, maxOutput int) catalogModel {
	var model catalogModel
	model.Limit.Context = contextWindow
	model.Limit.Output = maxOutput
	return model
}
