package domain

import "testing"

func TestModelCapabilitiesValidate(t *testing.T) {
	valid := ModelCapabilities{
		SchemaVersion:       ModelCapabilitiesSchemaVersion,
		ContextWindow:       128000,
		CompactionThreshold: 120000,
		MaxOutputTokens:     16384,
		Reasoning: ReasoningCapabilities{
			Enabled: true,
			Effort:  "high",
		},
	}

	tests := []struct {
		name         string
		capabilities ModelCapabilities
		provider     string
		serverLimit  int
	}{
		{name: "schema", capabilities: func() ModelCapabilities {
			item := valid
			item.SchemaVersion = 3
			return item
		}(), provider: "openai"},
		{name: "context window", capabilities: func() ModelCapabilities {
			item := valid
			item.ContextWindow = 100
			return item
		}(), provider: "openai"},
		{name: "compaction threshold empty", capabilities: func() ModelCapabilities {
			item := valid
			item.CompactionThreshold = 0
			return item
		}(), provider: "openai"},
		{name: "compaction threshold reaches context", capabilities: func() ModelCapabilities {
			item := valid
			item.CompactionThreshold = item.ContextWindow
			return item
		}(), provider: "openai"},
		{name: "output exceeds context", capabilities: func() ModelCapabilities {
			item := valid
			item.MaxOutputTokens = item.ContextWindow + 1
			return item
		}(), provider: "openai"},
		{name: "output exceeds server limit", capabilities: valid, provider: "openai", serverLimit: 8192},
		{name: "empty enabled effort", capabilities: func() ModelCapabilities {
			item := valid
			item.Reasoning.Effort = ""
			return item
		}(), provider: "openai"},
		{name: "invalid effort", capabilities: func() ModelCapabilities {
			item := valid
			item.Reasoning.Effort = "not valid"
			return item
		}(), provider: "openai"},
		{name: "disabled reasoning has effort", capabilities: func() ModelCapabilities {
			item := valid
			item.Reasoning.Enabled = false
			return item
		}(), provider: "openai"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := test.capabilities.Validate(test.provider, test.serverLimit); err == nil {
				t.Fatal("Validate() error = nil, want validation failure")
			}
		})
	}

	if err := valid.Validate("openai", 32768); err != nil {
		t.Fatalf("valid capabilities rejected: %v", err)
	}

	custom := valid
	custom.Reasoning.Effort = "provider_custom-v2"
	if err := custom.Validate("anthropic", 32768); err != nil {
		t.Fatalf("custom effort rejected: %v", err)
	}
}

func TestDefaultModelCapabilitiesGPT56(t *testing.T) {
	capabilities := DefaultModelCapabilities("openai", "gpt-5.6-terra")
	if capabilities.ContextWindow != 272000 || capabilities.CompactionThreshold != 258000 {
		t.Fatalf("GPT-5.6 defaults = %+v", capabilities)
	}
}
