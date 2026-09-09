import * as raw from '../catalog/models.json';

export interface CatalogCapabilities {
  vision?: boolean;
  audioInput?: boolean;
  videoInput?: boolean;
  pdf?: boolean;
  imageOutput?: boolean;
  audioOutput?: boolean;
  search?: boolean;
  tools?: boolean;
  reasoning?: boolean;
  contextWindow?: number;
  maxOutput?: number;
}

export interface CatalogShape {
  v?: number;
  etag?: string;
  syncedAt?: number;
  models: Record<string, CatalogCapabilities>;
  providers: Record<string, Record<string, Partial<CatalogCapabilities>>>;
}

export const CATALOG = raw as CatalogShape;

export interface ModelInfo {
  id: string;
  provider: string;
  source: 'router' | 'catalog';
  live: boolean;
  caps: CatalogCapabilities;
}

export interface RouterModelsResult {
  online: boolean;
  baseUrl: string;
  error?: string;
  items: ModelInfo[];
}

const LIVE_RE = /live|voice|tts|stt|realtime|speech/i;

const PREFIX_HINTS: Array<[RegExp, string]> = [
  [/^gemini-/, 'gemini'],
  [/^grok-/, 'xai'],
  [/^gpt-|^o[0-9]|^chatgpt/, 'openai'],
  [/^claude/, 'anthropic'],
  [/^qwen/, 'qwen'],
  [/^llama|^llamav/, 'meta'],
  [/^deepseek/, 'deepseek'],
  [/^glm-/, 'z-ai'],
  [/^kimi/, 'moonshot'],
  [/^minimax/, 'minimax'],
  [/^mistral|^codestral/, 'mistral'],
  [/^gemma-/, 'google'],
  [/^command-/, 'cohere']
];

function guessProvider(id: string): string {
  for (const [re, prov] of PREFIX_HINTS) if (re.test(id)) return prov;
  return 'catalog';
}

function providerOfCatalogModel(id: string): string {
  for (const [provider, models] of Object.entries(CATALOG.providers)) {
    if (Object.prototype.hasOwnProperty.call(models, id)) return provider;
  }
  return guessProvider(id);
}

export function catalogModelInfos(): ModelInfo[] {
  const infos: ModelInfo[] = [];
  for (const [id, caps] of Object.entries(CATALOG.models)) {
    infos.push({
      id,
      provider: providerOfCatalogModel(id),
      source: 'catalog',
      live: LIVE_RE.test(id),
      caps: { ...caps, ...(CATALOG.providers[providerOfCatalogModel(id)]?.[id] ?? {}) }
    });
  }
  return infos;
}

function normalizeRouterItem(item: Record<string, unknown>): ModelInfo | null {
  if (typeof item?.id !== 'string' || !item.id) return null;
  const caps = (item.capabilities as CatalogCapabilities | undefined) ?? {};
  return {
    id: item.id,
    provider: typeof item.owned_by === 'string' && item.owned_by ? item.owned_by : 'router',
    source: 'router',
    live: LIVE_RE.test(item.id),
    caps: {
      ...caps,
      contextWindow: caps.contextWindow ?? (item.context_length as number | undefined),
      maxOutput: caps.maxOutput ?? (item.max_completion_tokens as number | undefined)
    }
  };
}

export async function fetchRouterModels(
  baseUrl: string,
  apiKey?: string
): Promise<RouterModelsResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined
    });
    if (!res.ok) {
      return {
        online: false,
        baseUrl,
        error: `router answered HTTP ${res.status}`,
        items: []
      };
    }
    const body = (await res.json()) as { data?: Record<string, unknown>[] };
    const items = (body.data ?? [])
      .map(normalizeRouterItem)
      .filter((m): m is ModelInfo => m !== null);
    return { online: true, baseUrl, items };
  } catch (err) {
    return {
      online: false,
      baseUrl,
      error: err instanceof Error ? err.message : String(err),
      items: []
    };
  }
}

export function mergeModels(router: ModelInfo[], catalog: ModelInfo[]): ModelInfo[] {
  const byId = new Map<string, ModelInfo>();
  for (const item of router) byId.set(item.id, item);
  for (const item of catalog) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  const items = [...byId.values()];
  items.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'router' ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
  return items;
}

export const LIVE_ONLY_CATALOG_IDS = catalogModelInfos()
  .filter((m) => m.live)
  .map((m) => m.id)
  .sort();