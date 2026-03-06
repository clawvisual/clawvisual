import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

const datasetPath = resolve(process.cwd(), "evals/regression-cases.json");
const raw = readFileSync(datasetPath, "utf-8");
const data = JSON.parse(raw);

if (!Array.isArray(data.cases) || data.cases.length === 0) {
  throw new Error("No regression cases found.");
}

for (const testCase of data.cases) {
  const id = String(testCase.id || "unknown");
  const output = testCase.output || {};
  const rules = testCase.rules || {};
  const slides = Array.isArray(output.slides) ? output.slides : [];
  const hashtags = Array.isArray(output.hashtags) ? output.hashtags : [];
  const sourceEvidence = Array.isArray(output.source_evidence) ? output.source_evidence : [];
  const trendSignals = Array.isArray(output.trend_signals) ? output.trend_signals : [];
  const cover = slides.find((slide) => slide && slide.is_cover) || slides[0];
  const coverPrompt = String(cover?.visual_prompt || "").toLowerCase();

  if (slides.length >= Number(rules.min_slides || 1)) {
    pass(`${id}: slide count ${slides.length}`);
  } else {
    fail(`${id}: slide count ${slides.length} < ${rules.min_slides}`);
  }

  if (hashtags.length >= Number(rules.min_hashtags || 0) && hashtags.length <= Number(rules.max_hashtags || 99)) {
    pass(`${id}: hashtag count ${hashtags.length}`);
  } else {
    fail(`${id}: hashtag count ${hashtags.length} outside [${rules.min_hashtags}, ${rules.max_hashtags}]`);
  }

  const coverKeywords = Array.isArray(rules.requires_cover_keyword) ? rules.requires_cover_keyword : [];
  const coverKeywordPass = coverKeywords.some((keyword) => coverPrompt.includes(String(keyword).toLowerCase()));
  if (coverKeywordPass) {
    pass(`${id}: cover prompt includes key hook tokens`);
  } else {
    fail(`${id}: cover prompt missing required hook tokens`);
  }

  if (sourceEvidence.length >= Number(rules.min_source_evidence || 0)) {
    pass(`${id}: source evidence ${sourceEvidence.length}`);
  } else {
    fail(`${id}: source evidence ${sourceEvidence.length} < ${rules.min_source_evidence}`);
  }

  if (trendSignals.length >= Number(rules.min_trend_signals || 0)) {
    pass(`${id}: trend signals ${trendSignals.length}`);
  } else {
    fail(`${id}: trend signals ${trendSignals.length} < ${rules.min_trend_signals}`);
  }
}

if (process.exitCode && process.exitCode !== 0) {
  console.error("\nRegression checks failed.");
} else {
  console.log("\nAll regression checks passed.");
}
