# Model Selection UI — Implementation Prompt

## Overview

9 Router CLI mein ek **Model Selection UI** implement karna hai. Jab user `/model` command run kare ya `Ctrl+P` press kare, to ek modal window khule. Us window mein **3 options** dikhein: **Provider**, **Combos**, **Show All Models**.

Current codebase mein:
- `src/router/models.ts` — `ModelRegistry` class (listModels, searchModels, groupByProvider, getProviders)
- `src/router/client.ts` — `NineRouterClient.listModels()` fetches from `/v1/models`
- `src/router/types.ts` — `RouterModel`, `toModelInfo()` converter
- `src/core/types.ts` — `ModelInfo` interface (id, name, provider, contextLength, capabilities, pricing, metadata)
- `src/tui/model-picker.tsx` — existing basic model picker (needs complete rewrite)
- `src/tui/components/command-palette.tsx` — `Submenu` component (reusable for grouped model lists)
- `src/tui/components/badge.tsx` — `ModelBadge`, `CapabilityBadge` components
- `src/tui/types.ts` — `ModelInfo`, `ModelCapability` types

**Note:** OpenRouter API model list endpoint returns models in format `provider/model-name` (e.g., `openai/gpt-5`, `anthropic/claude-sonnet-5`). Provider is parsed from the model ID prefix in `toModelInfo()`. There is NO existing combo system — combos need to be fetched from OpenRouter's `/v1/combos` or defined locally.

---

## Files to Create / Modify

### 1. NEW: `src/tui/components/model-selector.tsx`
Main model selection orchestrator component. This is the top-level modal.

```typescript
// Interface
interface ModelSelectorProps {
  theme: Theme;
  models: ModelInfo[];           // From ModelRegistry
  providers: string[];           // From ModelRegistry.getProviders()
  combos?: Combo[];              // Optional: from OpenRouter combos API or local
  selectedModel: string;         // Currently active model ID
  selectedProvider: string;      // Currently active provider
  lastSelectedProvider: string;  // Persisted from config
  recentModels: string[];        // Recently used model IDs
  onSelectModel: (modelId: string) => void;
  onSelectProvider: (provider: string) => void;
  onSelectCombo: (comboId: string) => void;
  onClose: () => void;
}
```

**States to handle:**
- `view: "menu"` — Show 3 options (Provider / Combos / Show All Models)
- `view: "providers"` — Provider list with search
- `view: "provider-models"` — Models of selected provider
- `view: "combos"` — Combo list
- `view: "all-models"` — Full model browser with search + filters
- `loading: boolean` — While fetching data
- `error: string | null` — Error state

### 2. NEW: `src/tui/components/provider-list.tsx`
Provider selection component.

```typescript
interface ProviderListProps {
  theme: Theme;
  providers: string[];           // Sorted provider names
  selectedProvider: string;      // Currently active
  onSelect: (provider: string) => void;
  onBack: () => void;
}

// Features
- Search bar with fuzzy filter (fuse.js style, character-by-character matching)
- Show provider name + model count badge for each
- Keyboard navigation (↑↓, Enter, Esc)
- Highlight selected provider with ✓
```

### 3. NEW: `src/tui/components/model-card.tsx`
Individual model display card.

```typescript
interface ModelCardProps {
  theme: Theme;
  model: ModelInfo;
  isActive: boolean;             // Currently selected model
  isRecent?: boolean;
  onSelect: () => void;
  onSetActive?: () => void;      // "Set as Default" button
}

// Display fields (show all):
┌─────────────────────────────────────────┐
│  ▸ gpt-5                          ✓     │  ← model name + active indicator
│  Provider: openAI                       │
│  Context: 128K  |  Input: $15/M  |  Output: $60/M
│  Capabilities: [TEXT] [VISION] [TOOLS] [REASONING]
│  Speed: Fast  |  Free: No  |  Status: Available
└─────────────────────────────────────────┘
```

### 4. NEW: `src/tui/components/model-grid.tsx`
Grid/list display for browsing all models.

```typescript
interface ModelGridProps {
  theme: Theme;
  models: ModelInfo[];
  selectedModel: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSelect: (modelId: string) => void;
  onSetActive: (modelId: string) => void;
  onBack: () => void;
}

// Features
- Powerful search bar at top
- Filters row below search:
  - Provider dropdown
  - Min context length slider/input
  - Capability checkboxes (text, vision, audio, tools, reasoning)
  - Max input price filter
  - Sort by: name, provider, context, price
- Virtualized list for performance (render only visible items)
- Each item = ModelCard
- Loading state while models load
- Empty state when no results match
```

### 5. NEW: `src/tui/components/combo-list.tsx`
OpenRouter combos display.

```typescript
interface ComboListProps {
  theme: Theme;
  combos: Combo[];
  selectedCombo: string | null;
  onSelect: (comboId: string) => void;
  onBack: () => void;
}

interface Combo {
  id: string;                    // Combo identifier
  name: string;                  // Human-readable name
  description: string;           // What it's good for
  models: string[];              // Included model IDs
  useCase: string;               // Intended use case
  isActive: boolean;             // Currently selected
}

// Display:
┌─────────────────────────────────────────┐
│  ▸ Smart Chat                     ✓     │
│  Best for general conversation          │
│  Models: gpt-5, claude-sonnet-5         │
│  Use case: General purpose chat         │
├─────────────────────────────────────────┤
│  Coding Pro                              │
│  Optimized for code generation           │
│  Models: gpt-5-codex, claude-opus-5     │
│  Use case: Software development          │
└─────────────────────────────────────────┘
```

### 6. MODIFY: `src/tui/model-picker.tsx`
Completely rewrite to use the new `ModelSelector` component.

### 7. MODIFY: `src/tui/app.tsx`
- Add `view: "model-selector"` to handle model selector view
- Wire up model selector dispatches

### 8. MODIFY: `src/tui/engine.tsx`
- Add `setCombos()` method if combos are used
- Pass `recentModels` and `lastProvider` from config

### 9. OPTIONAL: `src/tui/components/search-bar.tsx`
Reusable search component with:
- Ghost text ("Type to search models...")
- Clear button (Esc)
- Fuzzy matching
- Debounced input (150ms)

---

## Data Flow

```
User presses /model or Ctrl+P
  └─> TuiEngine sets view = "model-selector"
      └─> ModelSelector renders 3-option menu
          ├─> "Provider" ─> ProviderList
          │   └─> select provider ─> show provider's models (filtered)
          │       └─> select model ─> onSelectModel(id) ─> TuiEngine.setSelectedModel()
          │
          ├─> "Combos" ─> ComboList
          │   └─> select combo ─> onSelectCombo(id) ─> switch entire model config
          │
          └─> "Show All Models" ─> ModelGrid
              └─> search + filters ─> filtered results
                  └─> select model ─> onSelectModel(id)
```

### Search Behavior Detail

Jab user "Show All Models" mein search karega, to:

1. **Search by model name:** `gpt-5` → show all model variants named `gpt-5`
2. **Search by provider:** `openai` → show all OpenAI models
3. **Combined:** `gpt-5 openai` → show gpt-5 variants from OpenAI only

**Cross-provider search example:**
User searches `gpt-5`:
```
Results for "gpt-5":
  Provider A: gpt-5 (context: 128K, $15/$60)  [Select]
  Provider B: gpt-5 (context: 100K, $12/$50)  [Select]
  Provider C: gpt-5 (context: 200K, $18/$70)  [Select]
```
Har provider ke saath ek "Select" button — user decide karega kis provider ka model use karna hai.

---

## State Management

```typescript
// In TuiEngine (or new ModelStore)
interface ModelUIState {
  // Persisted (save to config)
  lastSelectedProvider: string;
  lastSelectedModel: string;
  lastSelectedCombo: string | null;
  recentModels: string[];        // Max 10, LRU
  
  // Transient
  modelSelectorView: "menu" | "providers" | "provider-models" | "combos" | "all-models";
  modelSearchQuery: string;
  modelFilters: ModelFilters;
  providerSearchQuery: string;
  modelsCache: ModelInfo[];       // Cached API response
  combosCache: Combo[];           // Cached combos
  isLoading: boolean;
  error: string | null;
}

interface ModelFilters {
  provider: string | null;
  minContext: number;
  maxInputPrice: number;
  capabilities: Set<string>;      // "vision", "tools", "reasoning", "audio"
  sortBy: "name" | "provider" | "context" | "price";
  sortOrder: "asc" | "desc";
}
```

### Persistence Layer
`~/.9router/config.json` mein save karein:
```json
{
  "lastModel": "openai/gpt-5",
  "lastProvider": "openai",
  "lastCombo": "smart-chat",
  "recentModels": [
    "openai/gpt-5",
    "anthropic/claude-sonnet-5",
    "google/gemini-3.1-pro"
  ]
}
```

---

## Winning Criteria Checklist

### Models Module
- [ ] New `ModelSelector` component renders 3-option menu
- [ ] Provider option shows all providers from registry
- [ ] Provider option has search/filter
- [ ] Selecting a provider shows that provider's models
- [ ] Each model card shows all info fields (context, pricing, capabilities)
- [ ] Combos option shows combo list (with fallback message if unavailable)
- [ ] Combo cards show name, description, models, use case
- [ ] Show All Models option opens full browser with search
- [ ] Search supports by name, provider, keywords
- [ ] Search results show all providers hosting same model
- [ ] Filters work (provider, context, pricing, capability)
- [ ] Loading indicator while fetching
- [ ] Error state for failed fetches
- [ ] Empty state for no results

### State & Persistence
- [ ] Last selected model persists across sessions
- [ ] Last selected provider persists
- [ ] Recent models tracked (LRU, max 10)
- [ ] Model list cached, refreshed on demand

### UX & Performance
- [ ] Full keyboard navigation (↑↓, Enter, Esc, Tab)
- [ ] Fast fuzzy search (debounced)
- [ ] Virtualized/scrolling for large lists
- [ ] No unnecessary re-renders
- [ ] Model provider highlights when multiple providers have same model

### Code Quality
- [ ] No hardcoded commands — registry-driven
- [ ] Reusable components (ModelCard, ProviderList, SearchBar)
- [ ] TypeScript strict, no `any`
- [ ] Zero type errors (`bun x tsc --noEmit`)
- [ ] Index synced (`bun run index:update`)

---

## Example Implementation Approaches

### Provider List Rendering
```tsx
// Pseudocode for provider list
<Box flexDirection="column">
  <SearchInput value={q} onChange={setQ} placeholder="Search providers..." />
  <Box flexDirection="column" height={16}>
    {filteredProviders.map((p, i) => (
      <Box key={p}>
        <Text color={i === cursor ? theme.primary : theme.textDim}>
          {i === cursor ? "▸" : " "}
        </Text>
        <Text color={p === selected ? theme.success : theme.text}>
          {p}
        </Text>
        <Text dimColor>  ({modelCount.get(p)} models)</Text>
        {p === selected ? <Text color={theme.success}> ✓</Text> : null}
      </Box>
    ))}
  </Box>
</Box>
```

### Cross-Provider Search Logic
```typescript
// When user searches "gpt-5":
function searchCrossProvider(query: string, models: ModelInfo[]): GroupedResult[] {
  // 1. Find all models matching the query by name
  const matching = models.filter(m => m.name.toLowerCase().includes(query.toLowerCase()));
  
  // 2. Group by model name
  const byName = new Map<string, ModelInfo[]>();
  for (const m of matching) {
    const group = byName.get(m.name) ?? [];
    group.push(m);
    byName.set(m.name, group);
  }
  
  // 3. Each group shows all providers offering this model
  return [...byName.entries()].map(([name, models]) => ({
    modelName: name,
    providers: models.map(m => ({
      provider: m.provider,
      modelId: m.id,
      contextLength: m.contextLength,
      pricing: m.pricing,
      capabilities: m.capabilities,
    })),
  }));
}
```

---

## Performance Considerations

1. **Cache API responses** — model list rarely changes mid-session
2. **Lazy load** — model details only when provider is selected
3. **Virtual scroll** — ModelGrid should only render visible items
4. **Debounce search** — 150ms debounce on search input
5. **Memoize filtered results** — `useMemo` for all filtered/computed lists
6. **Avoid re-renders** — use `React.memo` for ModelCard, stable callbacks

---

## Future Extensibility

- New filter types can be added to `ModelFilters` without UI changes
- New provider sources can add models to the registry
- Combo system can be extended with user-defined combos
- Model comparison feature can build on top of ModelCard
- Favorites/pinned models can extend `recentModels` pattern
