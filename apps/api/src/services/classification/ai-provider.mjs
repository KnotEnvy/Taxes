const AI_KEYWORD_PRIORS = Object.freeze([
  { categoryCode: "advertising", pattern: /\b(ad|promo|campaign|marketing)\b/i, confidence: 0.78 },
  { categoryCode: "supplies", pattern: /\b(cleaning|supplies|equipment|tools)\b/i, confidence: 0.76 },
  { categoryCode: "utilities", pattern: /\b(internet|phone|electric|water)\b/i, confidence: 0.79 },
  { categoryCode: "travel", pattern: /\b(flight|hotel|lodging|uber|lyft)\b/i, confidence: 0.77 },
  { categoryCode: "meals", pattern: /\b(lunch|dinner|restaurant|coffee)\b/i, confidence: 0.75 },
  { categoryCode: "taxes_licenses", pattern: /\b(tax|license|permit)\b/i, confidence: 0.82 },
]);

export class MockAiCategorizationProvider {
  async suggestCategory({ transaction }) {
    const text = `${transaction.description ?? ""} ${transaction.rawLine ?? ""}`.trim();
    for (const prior of AI_KEYWORD_PRIORS) {
      if (prior.pattern.test(text)) {
        return {
          categoryCode: prior.categoryCode,
          confidence: prior.confidence,
          reasonCode: "ai_keyword_prior",
        };
      }
    }

    return {
      categoryCode: "other_expense",
      confidence: 0.55,
      reasonCode: "ai_fallback_other",
    };
  }
}
