import { AsyncLocalStorage } from "node:async_hooks";

type UsageModelTotals = {
  calls: number;
  callsWithUsage: number;
  callsWithoutUsage: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
};

type UsageScope = {
  calls: number;
  callsWithUsage: number;
  callsWithoutUsage: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  models: Map<string, UsageModelTotals>;
};

export type UsageSnapshot = {
  calls: number;
  callsWithUsage: number;
  callsWithoutUsage: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  models: Array<{
    model: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    callsWithUsage: number;
    callsWithoutUsage: number;
  }>;
};

const storage = new AsyncLocalStorage<UsageScope>();

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function readUsageNumbers(payload: unknown): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  hasUsage: boolean;
} {
  const root = asRecord(payload);
  const usage = asRecord(root?.usage) ?? asRecord(root?.token_usage) ?? null;
  if (!usage) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      hasUsage: false
    };
  }

  const inputTokens =
    toNumber(usage.prompt_tokens) ??
    toNumber(usage.input_tokens) ??
    toNumber(usage.inputTokens) ??
    toNumber(usage.promptTokens) ??
    0;
  const outputTokens =
    toNumber(usage.completion_tokens) ??
    toNumber(usage.output_tokens) ??
    toNumber(usage.outputTokens) ??
    toNumber(usage.completionTokens) ??
    0;
  const totalTokens =
    toNumber(usage.total_tokens) ??
    toNumber(usage.totalTokens) ??
    (inputTokens + outputTokens > 0 ? inputTokens + outputTokens : 0);
  const costUsd =
    toNumber(usage.cost) ??
    toNumber(usage.total_cost) ??
    toNumber(usage.cost_usd) ??
    toNumber(usage.total_cost_usd) ??
    0;

  const hasUsage = inputTokens > 0 || outputTokens > 0 || totalTokens > 0;
  return {
    inputTokens: Math.max(0, Math.round(inputTokens)),
    outputTokens: Math.max(0, Math.round(outputTokens)),
    totalTokens: Math.max(0, Math.round(totalTokens)),
    costUsd: Math.max(0, costUsd),
    hasUsage
  };
}

function getOrCreateModel(scope: UsageScope, model: string): UsageModelTotals {
  const normalized = model.trim() || "unknown";
  const existing = scope.models.get(normalized);
  if (existing) return existing;

  const created: UsageModelTotals = {
    calls: 0,
    callsWithUsage: 0,
    callsWithoutUsage: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0
  };
  scope.models.set(normalized, created);
  return created;
}

export function beginUsageScope(): UsageScope {
  const scope: UsageScope = {
    calls: 0,
    callsWithUsage: 0,
    callsWithoutUsage: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    models: new Map()
  };
  storage.enterWith(scope);
  return scope;
}

export function recordUsageFromPayload(params: {
  model?: string;
  payload: unknown;
}): void {
  const scope = storage.getStore();
  if (!scope) return;

  const usage = readUsageNumbers(params.payload);
  const model = String(params.model ?? asRecord(params.payload)?.model ?? "unknown");
  const modelTotals = getOrCreateModel(scope, model);

  scope.calls += 1;
  modelTotals.calls += 1;

  if (usage.hasUsage) {
    scope.callsWithUsage += 1;
    modelTotals.callsWithUsage += 1;
  } else {
    scope.callsWithoutUsage += 1;
    modelTotals.callsWithoutUsage += 1;
  }

  scope.inputTokens += usage.inputTokens;
  scope.outputTokens += usage.outputTokens;
  scope.totalTokens += usage.totalTokens;
  scope.costUsd += usage.costUsd;

  modelTotals.inputTokens += usage.inputTokens;
  modelTotals.outputTokens += usage.outputTokens;
  modelTotals.totalTokens += usage.totalTokens;
  modelTotals.costUsd += usage.costUsd;
}

export function snapshotUsage(scope?: UsageScope): UsageSnapshot {
  const active = scope ?? storage.getStore();
  if (!active) {
    return {
      calls: 0,
      callsWithUsage: 0,
      callsWithoutUsage: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      models: []
    };
  }

  return {
    calls: active.calls,
    callsWithUsage: active.callsWithUsage,
    callsWithoutUsage: active.callsWithoutUsage,
    inputTokens: active.inputTokens,
    outputTokens: active.outputTokens,
    totalTokens: active.totalTokens,
    costUsd: active.costUsd,
    models: [...active.models.entries()]
      .map(([model, totals]) => ({ model, ...totals }))
      .sort((a, b) => b.totalTokens - a.totalTokens)
  };
}

export function formatUsageSummary(snapshot: UsageSnapshot): string {
  if (!snapshot.calls) {
    return "calls=0; usage=unavailable";
  }

  const costPart = snapshot.costUsd > 0 ? `; cost_usd=${snapshot.costUsd.toFixed(4)}` : "";
  const modelPart = snapshot.models.length
    ? `; models=${snapshot.models
        .slice(0, 3)
        .map((item) => `${item.model}(in:${item.inputTokens},out:${item.outputTokens},total:${item.totalTokens})`)
        .join("|")}`
    : "";

  return [
    `calls=${snapshot.calls}`,
    `usage_calls=${snapshot.callsWithUsage}`,
    `missing_usage_calls=${snapshot.callsWithoutUsage}`,
    `in=${snapshot.inputTokens}`,
    `out=${snapshot.outputTokens}`,
    `total=${snapshot.totalTokens}`
  ].join("; ") + costPart + modelPart;
}

