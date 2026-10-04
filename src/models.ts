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
  if (id.includes('/')) {
    const prefix = id.split('/')[0];
    if (prefix) return prefix;
  }
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
      source: id.includes('/') ? 'router' : 'catalog',
      live: LIVE_RE.test(id),
      caps: { ...caps, ...(CATALOG.providers[providerOfCatalogModel(id)]?.[id] ?? {}) }
    });
  }
  return infos;
}

function normalizeRouterItem(item: Record<string, unknown>): ModelInfo | null {
  if (typeof item?.id !== 'string' || !item.id) return null;
  const caps = (item.capabilities as CatalogCapabilities | undefined) ?? {};
  let prov = typeof item.owned_by === 'string' && item.owned_by ? item.owned_by : 'router';
  if (prov === 'router' && item.id.includes('/')) {
    prov = item.id.split('/')[0];
  }
  return {
    id: item.id,
    provider: prov,
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

export class UnifiedModelCatalog {
  private static instance: UnifiedModelCatalog;
  private _models: ModelInfo[] = [];
  private _lastFetchTime = 0;
  private _isFetching = false;
  private _isOnline = false;
  private _listeners: Array<(models: ModelInfo[]) => void> = [];

  private constructor() {
    this._models = catalogModelInfos();
  }

  public static getInstance(): UnifiedModelCatalog {
    if (!UnifiedModelCatalog.instance) {
      UnifiedModelCatalog.instance = new UnifiedModelCatalog();
    }
    return UnifiedModelCatalog.instance;
  }

  public getModels(): ModelInfo[] {
    return this._models;
  }

  public isOnline(): boolean {
    return this._isOnline;
  }

  public onModelsUpdated(listener: (models: ModelInfo[]) => void): () => void {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener);
    };
  }

  public async syncWithRouter(baseUrl: string, apiKey?: string, force = false): Promise<ModelInfo[]> {
    const now = Date.now();
    if (!force && now - this._lastFetchTime < 10000 && this._models.length > 0) {
      return this._models;
    }
    if (this._isFetching) {
      return this._models;
    }

    this._isFetching = true;
    try {
      const res = await fetchRouterModels(baseUrl, apiKey);
      this._isOnline = res.online;
      if (res.online && res.items.length > 0) {
        this._models = mergeModels(res.items, catalogModelInfos());
        this._lastFetchTime = Date.now();
        for (const listener of this._listeners) {
          try {
            listener(this._models);
          } catch {}
        }
      }
    } finally {
      this._isFetching = false;
    }

    return this._models;
  }
}

export const LIVE_ONLY_CATALOG_IDS = catalogModelInfos()
  .filter((m) => m.live)
  .map((m) => m.id)
  .sort();

export interface LiveModelDefinition {
  id: string;
  name: string;
  description: string;
  recommended?: boolean;
  tag: string;
}

export const KNOWN_BIDI_LIVE_MODELS: LiveModelDefinition[] = [
  {
    id: 'gemini-3.1-flash-live-preview',
    name: 'Gemini 3.1 Flash Live Preview',
    description: 'Fastest real-time voice-to-voice + simultaneous text & tools',
    recommended: true,
    tag: 'Latest Flash (Recommended)'
  },
  {
    id: 'gemini-2.5-flash-native-audio-latest',
    name: 'Gemini 2.5 Flash Native Audio Latest',
    description: 'GA native audio voice-to-voice with expressive multilingual speech & text',
    tag: 'Native Audio GA'
  },
  {
    id: 'gemini-2.5-flash-native-audio-preview-12-2025',
    name: 'Gemini 2.5 Flash Native Audio Preview (Dec 2025)',
    description: 'Native audio conversation model with emotional inflection & text',
    tag: 'Native Audio'
  },
  {
    id: 'gemini-2.5-flash-native-audio-preview-09-2025',
    name: 'Gemini 2.5 Flash Native Audio Preview (Sep 2025)',
    description: 'Low-latency native audio live conversation & text',
    tag: 'Native Audio'
  },
  {
    id: 'gemini-3.8-live',
    name: 'Gemini 3.8 Live',
    description: 'State-of-the-art live voice-to-voice with full autonomous tool execution, compilation & verification',
    tag: 'Tools & Execution'
  },
  {
    id: 'gemini-3.8-live-extended-thinking',
    name: 'Gemini 3.8 Live Extended Thinking',
    description: 'Real-time voice conversation with deep reasoning (pure voice mode; safely routes to Gemini 3.8 Live when tools are active)',
    tag: 'Deep Reasoning'
  },
  {
    id: 'gemini-live-2.5-flash-preview',
    name: 'Gemini Live 2.5 Flash Preview',
    description: 'Low-latency 2.5 Flash Live preview for voice-to-voice',
    tag: '2.5 Preview'
  },
  {
    id: 'gemini-live-2.5-pro-preview-09-2025',
    name: 'Gemini Live 2.5 Pro Preview',
    description: 'Pro reasoning variant of Gemini Live preview',
    tag: 'Pro Preview'
  },
  {
    id: 'gemini-3.5-live-translate-preview',
    name: 'Gemini 3.5 Live Translate Preview',
    description: 'Real-time simultaneous speech & text translation live channel',
    tag: 'Translation'
  },
  {
    id: 'gemini-3.5-transcribe-live',
    name: 'Gemini 3.5 Transcribe Live',
    description: 'Ultra-low-latency real-time live audio transcription and voice channel',
    tag: 'Transcription'
  }
];

export function getBidiLiveModels(): LiveModelDefinition[] {
  return [...KNOWN_BIDI_LIVE_MODELS];
}