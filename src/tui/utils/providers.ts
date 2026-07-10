const PROVIDER_NAMES: Record<string, string> = {
  "openai": "OpenAI",
  "anthropic": "Anthropic",
  "google": "Google",
  "mistral": "Mistral",
  "meta": "Meta",
  "xai": "xAI",
  "deepseek": "DeepSeek",
  "qwen": "Qwen",
  "cohere": "Cohere",
  "perplexity": "Perplexity",
  "together": "Together",
  "replicate": "Replicate",
  "microsoft": "Microsoft",
  "azure": "Azure",
  "aws": "AWS",
  "bedrock": "Bedrock",
  "gcp": "GCP",
  "vertex": "Vertex",
  "ai21": "AI21",
  "nvidia": "NVIDIA",
  "ibm": "IBM",
  "databricks": "Databricks",
  "anyscale": "Anyscale",
  "fireworks": "Fireworks",
  "groq": "Groq",
  "stability": "Stability",
  "stability-ai": "Stability AI",
  "jina": "Jina",
  "elevenlabs": "ElevenLabs",
  "01-ai": "01.AI",
  "zero-one": "01.AI",
  "upstage": "Upstage",
  "nomic": "Nomic",
  "writer": "Writer",
  "inflection": "Inflection",
  "snowflake": "Snowflake",
  "samba-nova": "SambaNova",
  "neuralmagic": "NeuralMagic",
  "lepton": "Lepton",
  "deepinfra": "DeepInfra",
  "featherless": "Featherless",
  "liquid": "Liquid",
  "minimax": "MiniMax",
  "moonshot": "Moonshot",
  "yi": "Yi",
  "internlm": "InternLM",
  "seallm": "SeaLLM",
  "tii": "TII",
  "google-gla": "Google",
  "google-palm": "Google PaLM",
};

function isAcronym(s: string): boolean {
  if (s.length < 2 || s.length > 6) return false;
  return s === s.toUpperCase();
}

export function formatProviderName(raw: string): string {
  if (!raw) return "Unknown";

  const known = PROVIDER_NAMES[raw.toLowerCase()];
  if (known) return known;

  if (isAcronym(raw)) return raw;

  if (raw !== raw.toLowerCase()) return raw;

  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
