export const PROMPTS = {
  contentPlanner: `Act as an information architect. Convert source content into social-ready structured output: one title, one concise caption, 1-5 hashtags, and 1-8 slides. Each slide must contain 1-5 cards; each card must include a short title and one complete sentence with no truncation.`,
  visualPromptPlanner: `Generate globally consistent image-prompt plans for a carousel. First infer a topic-matched style blueprint (visual style, icon style, typography direction), then generate per-slide prompts that preserve the same style language while mapping each slide's card content into clear visual structures.`,
  assetGenerator: `Generate director-grade image prompts with 4 steps: intent parsing, visual association mapping, strict text rendering rules, and style treatment with consistent composition constraints. Adapt visual language to the source domain and audience. Ensure first-glance recognizability (0.3s), strong focal hierarchy, controlled contrast, and social-feed stopping power.`,
  viralOptimizer: `Create one contextual CTA for save/share/comment behavior.`
};

export function buildPromptHeader(skillName: keyof typeof PROMPTS): string {
  return `[${skillName}] ${PROMPTS[skillName]}`;
}
