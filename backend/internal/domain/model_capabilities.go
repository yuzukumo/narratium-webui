package domain

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"
)

const ModelCapabilitiesSchemaVersion = 2

var reasoningEffortPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

type ReasoningCapabilities struct {
	Enabled          bool     `json:"enabled"`
	Effort           string   `json:"effort"`
	SupportedEfforts []string `json:"supported_efforts,omitempty"`
}

type ModelCapabilities struct {
	SchemaVersion       int                   `json:"schema_version"`
	ContextWindow       int                   `json:"context_window"`
	CompactionThreshold int                   `json:"compaction_threshold"`
	MaxOutputTokens     int                   `json:"max_output_tokens"`
	Reasoning           ReasoningCapabilities `json:"reasoning"`
}

func defaultCompactionThreshold(contextWindow int) int {
	return max(contextWindow*95/100, 1)
}

func DefaultModelCapabilities(provider string, modelIDs ...string) ModelCapabilities {
	capabilities := ModelCapabilities{
		SchemaVersion:       ModelCapabilitiesSchemaVersion,
		ContextWindow:       128000,
		CompactionThreshold: defaultCompactionThreshold(128000),
		MaxOutputTokens:     16384,
		Reasoning: ReasoningCapabilities{
			Enabled: true,
			Effort:  "medium",
		},
	}
	switch provider {
	case "openai":
	case "anthropic":
		capabilities.ContextWindow = 200000
		capabilities.CompactionThreshold = defaultCompactionThreshold(capabilities.ContextWindow)
		capabilities.Reasoning.Effort = "high"
	case "gemini":
		capabilities.ContextWindow = 1048576
		capabilities.CompactionThreshold = defaultCompactionThreshold(capabilities.ContextWindow)
		capabilities.MaxOutputTokens = 65536
		capabilities.Reasoning.Effort = "high"
	}

	modelID := ""
	if len(modelIDs) > 0 {
		modelID = strings.ToLower(strings.TrimSpace(modelIDs[0]))
	}
	switch {
	case provider == "openai" && strings.HasPrefix(modelID, "gpt-5.6"):
		capabilities.ContextWindow = 272000
		capabilities.CompactionThreshold = 258000
		capabilities.MaxOutputTokens = 128000
	case provider == "anthropic" && strings.Contains(modelID, "fable-5"):
		capabilities.ContextWindow = 1000000
		capabilities.CompactionThreshold = 950000
		capabilities.MaxOutputTokens = 128000
	}
	return capabilities
}

func ParseModelCapabilities(raw json.RawMessage, provider string) (ModelCapabilities, error) {
	if len(raw) == 0 || string(raw) == "null" || string(raw) == "{}" {
		return ModelCapabilities{}, nil
	}
	capabilities := ModelCapabilities{}
	if err := json.Unmarshal(raw, &capabilities); err != nil {
		return ModelCapabilities{}, err
	}
	if capabilities.SchemaVersion == 0 {
		capabilities.SchemaVersion = ModelCapabilitiesSchemaVersion
	}
	return capabilities, nil
}

func (capabilities ModelCapabilities) Configured() bool {
	return capabilities.ContextWindow > 0 &&
		capabilities.CompactionThreshold > 0 &&
		capabilities.MaxOutputTokens > 0
}

func (capabilities ModelCapabilities) Validate(_ string, globalMaxOutputTokens int) error {
	if capabilities.SchemaVersion != ModelCapabilitiesSchemaVersion {
		return errors.New("unsupported model capability schema version")
	}
	if capabilities.ContextWindow < 1024 || capabilities.ContextWindow > 10000000 {
		return errors.New("context_window must be between 1024 and 10000000")
	}
	if capabilities.CompactionThreshold < 1 || capabilities.CompactionThreshold >= capabilities.ContextWindow {
		return errors.New("compaction_threshold must be positive and less than context_window")
	}
	if capabilities.MaxOutputTokens < 1 || capabilities.MaxOutputTokens > capabilities.ContextWindow {
		return errors.New("max_output_tokens must be positive and no greater than context_window")
	}
	if globalMaxOutputTokens > 0 && capabilities.MaxOutputTokens > globalMaxOutputTokens {
		return errors.New("max_output_tokens exceeds the server limit")
	}

	effort := strings.TrimSpace(capabilities.Reasoning.Effort)
	if len(capabilities.Reasoning.SupportedEfforts) > 32 {
		return errors.New("reasoning supported_efforts cannot contain more than 32 values")
	}
	seenEfforts := make(map[string]struct{}, len(capabilities.Reasoning.SupportedEfforts))
	for _, supportedEffort := range capabilities.Reasoning.SupportedEfforts {
		supportedEffort = strings.TrimSpace(supportedEffort)
		if !reasoningEffortPattern.MatchString(supportedEffort) {
			return errors.New("reasoning supported efforts must use 1-64 letters, numbers, dots, underscores, or hyphens")
		}
		if _, exists := seenEfforts[supportedEffort]; exists {
			return errors.New("reasoning supported efforts must be unique")
		}
		seenEfforts[supportedEffort] = struct{}{}
	}
	if !capabilities.Reasoning.Enabled {
		if effort != "" || len(capabilities.Reasoning.SupportedEfforts) > 0 {
			return errors.New("reasoning effort must be empty when reasoning is disabled")
		}
		return nil
	}
	if !reasoningEffortPattern.MatchString(effort) {
		return errors.New("reasoning effort must be 1-64 letters, numbers, dots, underscores, or hyphens")
	}
	return nil
}

func (capabilities ModelCapabilities) JSON() json.RawMessage {
	encoded, _ := json.Marshal(capabilities)
	return encoded
}
