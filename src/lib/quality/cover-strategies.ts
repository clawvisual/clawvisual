export type CoverStrategyId =
  | "conflict_split"
  | "data_shock"
  | "mystery_gap"
  | "before_after"
  | "myth_bust"
  | "urgency_window"
  | "hidden_cost"
  | "authority_gap";

export type CoverStrategyPlan = {
  id: CoverStrategyId;
  directive: string;
  score: number;
};

type StrategyDef = {
  id: CoverStrategyId;
  directive: string;
  triggers: RegExp[];
  baseScore: number;
};

const STRATEGIES: StrategyDef[] = [
  {
    id: "conflict_split",
    directive: "Cover strategy: split-screen conflict with two opposing forces and a decisive center tension line.",
    triggers: [/(vs|versus|对比|冲突|battle|竞争)/i],
    baseScore: 74
  },
  {
    id: "data_shock",
    directive: "Cover strategy: one dominant data shock anchor with dramatic scale contrast and minimal clutter.",
    triggers: [/(data|metric|kpi|roi|gmv|%|增长|下滑|同比|环比)/i],
    baseScore: 76
  },
  {
    id: "mystery_gap",
    directive: "Cover strategy: reveal partial answer only, keep asymmetric framing that creates unresolved curiosity gap.",
    triggers: [/(why|how|秘密|真相|没人告诉你|unknown|hidden)/i],
    baseScore: 71
  },
  {
    id: "before_after",
    directive: "Cover strategy: show explicit before/after transformation with one dramatic pivot point.",
    triggers: [/(before|after|转型|升级|改善|improve|transformation)/i],
    baseScore: 72
  },
  {
    id: "myth_bust",
    directive: "Cover strategy: visually break one common myth with contrarian framing and strong hierarchy.",
    triggers: [/(myth|误区|真相|错了|wrong|misconception)/i],
    baseScore: 70
  },
  {
    id: "urgency_window",
    directive: "Cover strategy: imply a shrinking time window with directional urgency cues and countdown tension.",
    triggers: [/(now|202\d|deadline|窗口期|机会|urgent|window)/i],
    baseScore: 69
  },
  {
    id: "hidden_cost",
    directive: "Cover strategy: spotlight an invisible cost/risk as a looming visual threat behind the hero subject.",
    triggers: [/(risk|cost|亏损|代价|burn|trap|隐形成本)/i],
    baseScore: 68
  },
  {
    id: "authority_gap",
    directive: "Cover strategy: juxtapose expert authority cue with novice mistake cue for immediate status contrast.",
    triggers: [/(expert|pro|novice|高手|小白|经验|方法论)/i],
    baseScore: 67
  }
];

function scoreStrategy(def: StrategyDef, corpus: string): number {
  let score = def.baseScore;
  for (const pattern of def.triggers) {
    if (pattern.test(corpus)) score += 7;
  }
  return score;
}

export function selectCoverStrategies(params: {
  sourceText: string;
  corePoints: string[];
  trendTags: string[];
  count: number;
}): CoverStrategyPlan[] {
  const count = Math.max(1, Math.min(6, params.count));
  const corpus = `${params.sourceText}\n${params.corePoints.join("\n")}\n${params.trendTags.join(" ")}`.toLowerCase();

  const ranked = STRATEGIES
    .map((def) => ({
      id: def.id,
      directive: def.directive,
      score: scoreStrategy(def, corpus)
    }))
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, count);
}

export function applyCoverStrategy(basePrompt: string, directive: string): string {
  return [basePrompt, directive].join("\n");
}
