export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  /** 5-minute cache write (1.25x input). */
  cacheWritePerMillion: number;
  /** 1-hour cache write (2x input). Claude Code uses these for most writes. */
  cacheWrite1hPerMillion: number;
  cacheReadPerMillion: number;
}

function price(input: number, output: number, cacheRead: number): ModelPricing {
  return {
    inputPerMillion: input,
    outputPerMillion: output,
    cacheWritePerMillion: input * 1.25,
    cacheWrite1hPerMillion: input * 2,
    cacheReadPerMillion: cacheRead,
  };
}

/** First-party Claude API rates, USD per million tokens. Source:
 * https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-10-01).
 * Keyed by alias; dated snapshot IDs (`claude-haiku-4-5-20251001`) resolve by
 * stripping the date suffix, see getModelPricing(). Cache reads are 0.1x input
 * except where noted — don't "simplify" those back to input * 0.1. */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-fable-5-1': price(10, 50, 0.25), // cache reads 0.025x input
  'claude-mythos-5-1': price(10, 50, 0.25), // cache reads 0.025x input
  'claude-fable-5': price(10, 50, 1),
  'claude-mythos-5': price(10, 50, 1),
  'claude-opus-5-5': price(4, 20, 0.20), // cache reads 0.05x input
  'claude-opus-5': price(5, 25, 0.50),
  'claude-opus-4-8': price(5, 25, 0.50),
  'claude-opus-4-7': price(5, 25, 0.50),
  'claude-opus-4-6': price(5, 25, 0.50),
  // Was $15/$75 here until 2026-10-01 (Opus 4.1-era rates), which tripled the
  // cost of every Opus 4.5 session in stats-cache history.
  'claude-opus-4-5': price(5, 25, 0.50),
  'claude-opus-4-1': price(15, 75, 1.50),
  'claude-opus-4': price(15, 75, 1.50),
  'claude-sonnet-5-5': price(2, 10, 0.20),
  'claude-sonnet-5': price(2, 10, 0.20),
  'claude-sonnet-4-6': price(3, 15, 0.30),
  'claude-sonnet-4-5': price(3, 15, 0.30),
  'claude-sonnet-4': price(3, 15, 0.30),
  'claude-haiku-4-5': price(1, 5, 0.10),
  'claude-haiku-3-5': price(0.80, 4, 0.08),
};

/** Models shown in the Pricing Reference table, in display order. Explicit list
 * instead of slicing MODEL_PRICING — that dict also carries older models kept
 * only for historical cost accuracy, and slicing blindly is what caused the old
 * "Opus, Opus, Sonnet" duplicate-row bug. */
export const CURRENT_MODEL_IDS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5', 'claude-fable-5-1'];

/**
 * Cost estimation modes:
 *
 * "api"          — DEFAULT. Raw API-equivalent cost. All 4 token types at published
 *                  API rates. The only mode that isn't a guess at plan billing.
 *
 * Legacy modes (kept for comparison with older reports, shown dimmed in the UI):
 *
 * "conservative" — Discounted estimate. Output tokens at full price, input at full price,
 *                  cache writes at 50% discount, cache reads at 90% discount.
 *                  Reflects that Anthropic likely doesn't charge subscription users
 *                  full API rate for cached context. Lands ~2-3x above real spend.
 *
 * "subscription" — Subscription-friendly estimate. Designed to approximate real Claude Code
 *                  plan billing. Output at full price, input at full price, cache tokens
 *                  heavily discounted (cache writes 80% off, cache reads 95% off).
 *                  For a $100/mo + overage plan, this tracks much closer to reality.
 */
export type CostMode = 'api' | 'conservative' | 'subscription';

export const COST_MODE_LABELS: Record<CostMode, { name: string; description: string }> = {
  api: {
    name: 'API Equivalent',
    description: 'What this usage would cost at published API rates',
  },
  conservative: {
    name: 'Conservative',
    description: 'Discounted cache tokens — upper bound for subscription users',
  },
  subscription: {
    name: 'Subscription',
    description: 'Approximates real Claude Code plan billing',
  },
};

// Multipliers applied to cache token costs relative to their API price
const COST_MODE_MULTIPLIERS: Record<CostMode, { cacheWrite: number; cacheRead: number }> = {
  api:          { cacheWrite: 1.0,  cacheRead: 1.0  },
  conservative: { cacheWrite: 0.15, cacheRead: 0.05 },
  subscription: { cacheWrite: 0.08, cacheRead: 0.01 },
};

export const DEFAULT_COST_MODE: CostMode = 'api';

/** Modes still selectable but no longer recommended; the selector groups them as "legacy". */
export const LEGACY_COST_MODES: CostMode[] = ['conservative', 'subscription'];

export function getModelDisplayName(modelId: string): string {
  if (modelId.includes('fable') || modelId.includes('mythos')) return 'Fable';
  if (modelId.includes('opus')) return 'Opus';
  if (modelId.includes('sonnet')) return 'Sonnet';
  if (modelId.includes('haiku')) return 'Haiku';
  return modelId;
}

export function getModelColor(modelId: string): string {
  if (modelId.includes('fable') || modelId.includes('mythos')) return '#A65CD4';
  if (modelId.includes('opus')) return '#D4764E';
  if (modelId.includes('sonnet')) return '#6B8AE6';
  if (modelId.includes('haiku')) return '#5CB87A';
  return '#888888';
}

/** "Opus 5.5", "Haiku 4.5", "Fable 5.1" — for tables that list exact models. */
export function getModelVersionLabel(modelId: string): string {
  const m = modelId.replace(DATE_SUFFIX, '').match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?$/);
  if (!m) return getModelDisplayName(modelId);
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? '.' + m[3] : ''}`;
}

const DATE_SUFFIX = /-\d{8}$/;
const FAMILY_FALLBACK: [string, string][] = [
  ['fable', 'claude-fable-5-1'],
  ['mythos', 'claude-mythos-5-1'],
  ['opus', 'claude-opus-5-5'],
  ['sonnet', 'claude-sonnet-5-5'],
  ['haiku', 'claude-haiku-4-5'],
];

/** Rates for a model ID as it appears in transcripts. Exact alias first, then
 * the alias with its date snapshot suffix stripped (`claude-sonnet-4-5-20250929`
 * → `claude-sonnet-4-5`), then the current model of the same family so an ID
 * newer than this table still gets a plausible rate. */
export function getModelPricing(model: string): ModelPricing | null {
  const exact = MODEL_PRICING[model] || MODEL_PRICING[model.replace(DATE_SUFFIX, '')];
  if (exact) return exact;
  for (const [family, key] of FAMILY_FALLBACK) {
    if (model.includes(family)) return MODEL_PRICING[key];
  }
  return null; // e.g. Claude Code's `<synthetic>` messages, which carry no usage
}

/** Cost in every mode. `cacheWrite1hTokens` is the part of `cacheWriteTokens`
 * written to the 1-hour cache (2x input instead of 1.25x); transcripts record
 * it under usage.cache_creation.ephemeral_1h_input_tokens. */
export function calculateCostAllModes(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens: number,
  cacheReadTokens: number,
  cacheWrite1hTokens = 0,
): Record<CostMode, number> {
  const pricing = getModelPricing(model);
  if (!pricing) return { api: 0, conservative: 0, subscription: 0 };

  const baseCost =
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion;
  const write1h = Math.min(cacheWrite1hTokens, cacheWriteTokens);
  const cacheWriteCost =
    ((cacheWriteTokens - write1h) / 1_000_000) * pricing.cacheWritePerMillion +
    (write1h / 1_000_000) * pricing.cacheWrite1hPerMillion;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion;

  const out = {} as Record<CostMode, number>;
  for (const mode of Object.keys(COST_MODE_MULTIPLIERS) as CostMode[]) {
    const m = COST_MODE_MULTIPLIERS[mode];
    out[mode] = baseCost + cacheWriteCost * m.cacheWrite + cacheReadCost * m.cacheRead;
  }
  return out;
}
