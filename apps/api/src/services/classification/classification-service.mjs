import { categoryExistsInTaxonomy } from "../../domain/taxonomies.mjs";
import { CLASSIFICATION_METHOD, CONFIDENCE_THRESHOLD } from "../../domain/constants.mjs";
import { MockAiCategorizationProvider } from "./ai-provider.mjs";
import { RulesEngine } from "./rules-engine.mjs";

export class ClassificationService {
  #rulesEngine;
  #aiProvider;
  #confidenceThreshold;

  constructor({ rulesEngine, aiProvider, confidenceThreshold } = {}) {
    this.#rulesEngine = rulesEngine ?? new RulesEngine();
    this.#aiProvider = aiProvider ?? new MockAiCategorizationProvider();
    this.#confidenceThreshold = confidenceThreshold ?? CONFIDENCE_THRESHOLD;
  }

  async classify({ transaction, context }) {
    const ruleDecision = this.#rulesEngine.classify(transaction, context, context?.customRules ?? []);

    if (ruleDecision && ruleDecision.confidence >= this.#confidenceThreshold) {
      const valid = categoryExistsInTaxonomy(context.taxonomyId, ruleDecision.categoryCode);
      const categoryCode = valid ? ruleDecision.categoryCode : "other_expense";
      return {
        categoryCode,
        confidence: valid ? ruleDecision.confidence : 0.5,
        method: CLASSIFICATION_METHOD.RULE,
        reasonCodes: [ruleDecision.reasonCode, valid ? "taxonomy_ok" : "taxonomy_fallback"],
        needsReview: !valid,
      };
    }

    const aiDecision = await this.#aiProvider.suggestCategory({ transaction, context });
    const fallbackDecision = aiDecision ?? {
      categoryCode: "other_expense",
      confidence: 0.5,
      reasonCode: "fallback_other_expense",
    };

    const categoryValid = categoryExistsInTaxonomy(context.taxonomyId, fallbackDecision.categoryCode);
    const categoryCode = categoryValid ? fallbackDecision.categoryCode : "other_expense";
    const confidence = categoryValid ? fallbackDecision.confidence : 0.45;

    return {
      categoryCode,
      confidence,
      method: CLASSIFICATION_METHOD.AI,
      reasonCodes: [ruleDecision ? "rule_low_confidence" : "rule_no_match", fallbackDecision.reasonCode],
      needsReview: confidence < this.#confidenceThreshold || !categoryValid,
    };
  }
}
