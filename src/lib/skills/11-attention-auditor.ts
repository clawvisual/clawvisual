import { callSkillLlmJson } from "@/lib/llm/skill-client";
import type { AttentionAudit, ConversionContext } from "@/lib/types/skills";

function compactAuditScript(script: string, maxChars = 220): string {
  const normalized = script.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1).trim()}...`;
}

function toAuditImageRef(imageUrl: string): string {
  const normalized = String(imageUrl ?? "").trim();
  // Avoid passing huge inline base64 blobs to text-only LLM calls.
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return "";
}

function fallbackAudits(context: ConversionContext): AttentionAudit[] {
  return context.compositions.map((composition) => {
    const length = composition.script.length;
    const readabilityScore = Math.max(0.4, Math.min(0.95, 1 - length / 240));
    const contrastScore = 0.85;
    const keywordDensity = Math.min(1, composition.script.split(/\s+/).filter(Boolean).length / 14);
    const hookStrength = Math.max(0.45, Math.min(0.92, 0.88 - Math.abs(keywordDensity - 0.72) * 0.45));
    const novelty = Math.max(0.4, Math.min(0.9, 0.55 + (composition.index % 3) * 0.12));
    const emotionalImpact = Math.max(0.45, Math.min(0.9, (hookStrength + novelty) / 2 + 0.05));
    const overlapRisk: "low" | "medium" | "high" = length > 180 ? "high" : length > 120 ? "medium" : "low";
    const action: "none" | "add-overlay" | "darken-background" = overlapRisk === "high" ? "add-overlay" : "none";

    return {
      index: composition.index,
      readabilityScore,
      contrastScore,
      hookStrength,
      novelty,
      emotionalImpact,
      overlapRisk,
      action
    };
  });
}

function isRisk(value: string): value is "low" | "medium" | "high" {
  return value === "low" || value === "medium" || value === "high";
}

function isAction(value: string): value is "none" | "add-overlay" | "darken-background" {
  return value === "none" || value === "add-overlay" || value === "darken-background";
}

function parseOptionalScore(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(0, Math.min(1, numeric));
}

export async function skill11AttentionAuditor(context: ConversionContext): Promise<ConversionContext> {
  const llmResult = await callSkillLlmJson<{
    audits?: Array<{
      index?: number;
      readabilityScore?: number;
      contrastScore?: number;
      hookStrength?: number;
      novelty?: number;
      emotionalImpact?: number;
      overlapRisk?: string;
      action?: string;
    }>;
  }>({
    skill: "attentionAuditor",
    input: {
      slides: context.compositions.map((composition) => ({
        index: composition.index,
        script: compactAuditScript(composition.script),
        layout: composition.layout,
        image_url: toAuditImageRef(composition.imageUrl)
      }))
    },
    outputSchemaHint:
      '{"audits":[{"index":1,"readabilityScore":0.85,"contrastScore":0.8,"hookStrength":0.78,"novelty":0.74,"emotionalImpact":0.76,"overlapRisk":"low|medium|high","action":"none|add-overlay|darken-background"}]}',
    outputLanguage: context.request.outputLanguage
  });

  const audits: AttentionAudit[] = [];
  for (const audit of llmResult?.audits ?? []) {
    const index = Number(audit.index);
    const readabilityScore = Number(audit.readabilityScore);
    const contrastScore = Number(audit.contrastScore);
    const overlapRisk = String(audit.overlapRisk ?? "");
    const action = String(audit.action ?? "");

    if (
      !Number.isFinite(index) ||
      !Number.isFinite(readabilityScore) ||
      !Number.isFinite(contrastScore) ||
      !isRisk(overlapRisk) ||
      !isAction(action)
    ) {
      continue;
    }

    audits.push({
      index,
      readabilityScore: Math.max(0, Math.min(1, readabilityScore)),
      contrastScore: Math.max(0, Math.min(1, contrastScore)),
      hookStrength: parseOptionalScore(audit.hookStrength),
      novelty: parseOptionalScore(audit.novelty),
      emotionalImpact: parseOptionalScore(audit.emotionalImpact),
      overlapRisk,
      action
    });
  }

  return {
    ...context,
    audits: audits.length === context.compositions.length ? audits : fallbackAudits(context)
  };
}
