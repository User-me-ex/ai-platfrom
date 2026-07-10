import { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { ProviderList } from "./components/provider-list";
import { ProviderModels } from "./components/provider-models";
import { AllModelsGrid } from "./components/all-models-grid";
import { ComboList } from "./components/combo-list";
import type { Theme, ModelInfo, ModelSelectorScreen } from "./types";

interface ModelPickerProps {
  models: ModelInfo[];
  selectedModel: string;
  onSelect: (model: string) => void;
  onClose: () => void;
  theme: Theme;
}

interface MenuOption {
  id: ModelSelectorScreen;
  label: string;
  description: string;
  icon: string;
}

const MENU_OPTIONS: MenuOption[] = [
  { id: "providers", label: "Browse by Provider", description: "Browse AI model providers and their models", icon: "🏢" },
  { id: "combos", label: "Model Combos", description: "Predefined model combinations for different use cases", icon: "🎯" },
  { id: "all-models", label: "Show All Models", description: "Browse and filter every available model", icon: "📋" },
];

export function ModelPicker({ models, selectedModel, onSelect, onClose, theme }: ModelPickerProps) {
  const [screen, setScreen] = useState<ModelSelectorScreen>("menu");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [menuCursor, setMenuCursor] = useState(0);

  const providers = useMemo(() => {
    const map = new Map<string, { modelCount: number; displayName: string }>();
    for (const m of models) {
      if (!m.provider) continue;
      const existing = map.get(m.provider);
      if (existing) {
        existing.modelCount++;
      } else {
        map.set(m.provider, { modelCount: 1, displayName: m.providerDisplayName });
      }
    }
    return [...map.entries()]
      .map(([name, data]) => ({ name, modelCount: data.modelCount, displayName: data.displayName }))
      .sort((a, b) => b.modelCount - a.modelCount);
  }, [models]);

  const providerModels = useMemo(() => {
    if (!selectedProvider) return [];
    return models.filter((m) => m.provider === selectedProvider);
  }, [models, selectedProvider]);

  const handleProviderSelect = (provider: string) => {
    setSelectedProvider(provider);
    setScreen("provider-models");
  };

  const handleBack = () => {
    if (screen === "provider-models") { setScreen("providers"); return; }
    setScreen("menu");
  };

  const handleComboActivate = (comboModels: string[]) => {
    const first = comboModels[0];
    if (first) onSelect(first);
  };

  useInput((_input, key) => {
    if (screen !== "menu") return;

    if (key.escape) { onClose(); return; }
    if (key.return) {
      const opt = MENU_OPTIONS[menuCursor];
      if (opt) setScreen(opt.id);
      return;
    }
    if (key.upArrow) { setMenuCursor((c) => Math.max(0, c - 1)); return; }
    if (key.downArrow) { setMenuCursor((c) => Math.min(MENU_OPTIONS.length - 1, c + 1)); return; }
  });

  const renderScreen = () => {
    switch (screen) {
      case "providers":
        return (
          <ProviderList
            providers={providers}
            onSelect={handleProviderSelect}
            onBack={handleBack}
            theme={theme}
          />
        );
      case "provider-models":
        return (
          <ProviderModels
            providerDisplayName={providerModels[0]?.providerDisplayName || selectedProvider}
            models={providerModels}
            selectedModel={selectedModel}
            onSelect={(modelId) => { onSelect(modelId); onClose(); }}
            onBack={handleBack}
            theme={theme}
          />
        );
      case "all-models":
        return (
          <AllModelsGrid
            models={models}
            selectedModel={selectedModel}
            onSelect={(modelId) => { onSelect(modelId); onClose(); }}
            onBack={handleBack}
            theme={theme}
          />
        );
      case "combos":
        return (
          <ComboList
            onActivateCombo={(comboModels) => {
              handleComboActivate(comboModels);
              onClose();
            }}
            onBack={handleBack}
            theme={theme}
          />
        );
      default:
        return (
          <Box flexDirection="column" width={64}>
            <Box marginBottom={1}>
              <Text bold color={theme.primary}>Select Model</Text>
              <Text color={theme.textDim}>  ({models.length} models available)</Text>
            </Box>

            <Box flexDirection="column" height={10}>
              {MENU_OPTIONS.map((opt, i) => {
                const isHovered = i === menuCursor;
                return (
                  <Box key={opt.id} paddingX={1} marginBottom={1} flexDirection="column">
                    <Box>
                      <Text color={isHovered ? theme.primary : theme.textDim}>
                        {isHovered ? "▸" : " "}
                      </Text>
                      <Text color={isHovered ? theme.text : theme.textDim}>
                        {" "}{opt.icon} {opt.label}
                      </Text>
                    </Box>
                    <Box marginLeft={3}>
                      <Text color={theme.dim}>{opt.description}</Text>
                    </Box>
                  </Box>
                );
              })}
            </Box>

            <Box marginTop={1}>
              <Text color={theme.textDim}>
                ↑↓ navigate · Enter select · Esc close
              </Text>
            </Box>
          </Box>
        );
    }
  };

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" width="100%">
      <Box flexDirection="column" borderStyle="round" borderColor={theme.borderActive} padding={1} width={76}>
        {renderScreen()}
      </Box>
    </Box>
  );
}
