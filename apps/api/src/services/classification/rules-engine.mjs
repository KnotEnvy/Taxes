const DEFAULT_RULES = Object.freeze([
  { id: "rule_ads_1", categoryCode: "advertising", confidence: 0.92, pattern: /\b(google ads|facebook|meta ads|yelp|canva|mailchimp|marketing)\b/i, priority: 100 },
  { id: "rule_car_1", categoryCode: "car_truck", confidence: 0.9, pattern: /\b(shell|chevron|exxon|wawa|fuel|gas station)\b/i, priority: 100 },
  { id: "rule_insurance_1", categoryCode: "insurance", confidence: 0.9, pattern: /\b(insurance|geico|state farm|progressive)\b/i, priority: 100 },
  { id: "rule_interest_1", categoryCode: "interest", confidence: 0.92, pattern: /\b(interest charge|finance charge)\b/i, priority: 100 },
  { id: "rule_professional_1", categoryCode: "legal_professional", confidence: 0.9, pattern: /\b(attorney|law office|cpa|accounting|bookkeeping)\b/i, priority: 100 },
  { id: "rule_office_1", categoryCode: "office_expense", confidence: 0.85, pattern: /\b(staples|office depot|zoom|microsoft|adobe)\b/i, priority: 100 },
  { id: "rule_rent_1", categoryCode: "rent_lease", confidence: 0.88, pattern: /\b(rent|lease)\b/i, priority: 100 },
  { id: "rule_repairs_1", categoryCode: "repairs_maintenance", confidence: 0.87, pattern: /\b(repair|maintenance|service call)\b/i, priority: 100 },
  { id: "rule_supplies_1", categoryCode: "supplies", confidence: 0.86, pattern: /\b(home depot|lowe'?s|amazon|supply|cleaning)\b/i, priority: 100 },
  { id: "rule_taxes_1", categoryCode: "taxes_licenses", confidence: 0.95, pattern: /\b(irs|department of revenue|tax payment|state tax)\b/i, priority: 100 },
  { id: "rule_travel_1", categoryCode: "travel", confidence: 0.88, pattern: /\b(delta|southwest|airlines|marriott|hotel|airbnb|uber)\b/i, priority: 100 },
  { id: "rule_meals_1", categoryCode: "meals", confidence: 0.85, pattern: /\b(restaurant|cafe|coffee|doordash|ubereats|grubhub)\b/i, priority: 100 },
  { id: "rule_utils_1", categoryCode: "utilities", confidence: 0.9, pattern: /\b(utility|electric|water bill|internet|comcast|verizon|at&t)\b/i, priority: 100 },
  { id: "rule_wages_1", categoryCode: "wages", confidence: 0.9, pattern: /\b(payroll|gusto|adp)\b/i, priority: 100 },
  { id: "rule_draw_1", categoryCode: "owner_draw", confidence: 0.88, pattern: /\b(owner draw|atm withdrawal|cash withdrawal)\b/i, priority: 100 },
]);

function normalizeAccountLabel(accountLabel) {
  return (accountLabel ?? "").trim().toLowerCase();
}

function accountHintDecision(accountLabel) {
  const normalized = (accountLabel ?? "").toLowerCase();
  if (normalized.includes("payroll")) {
    return {
      categoryCode: "wages",
      confidence: 0.97,
      reasonCode: "account_hint_payroll",
      ruleId: "account_hint_payroll",
      priority: 900,
    };
  }
  if (normalized.includes("marketing")) {
    return {
      categoryCode: "advertising",
      confidence: 0.97,
      reasonCode: "account_hint_marketing",
      ruleId: "account_hint_marketing",
      priority: 900,
    };
  }
  if (normalized.includes("tax_savings")) {
    return {
      categoryCode: "taxes_licenses",
      confidence: 0.97,
      reasonCode: "account_hint_tax_savings",
      ruleId: "account_hint_tax_savings",
      priority: 900,
    };
  }
  if (normalized.includes("misc_expense")) {
    return {
      categoryCode: "office_expense",
      confidence: 0.8,
      reasonCode: "account_hint_misc_expense",
      ruleId: "account_hint_misc_expense",
      priority: 900,
    };
  }
  return null;
}

function compilePattern(value) {
  if (value instanceof RegExp) {
    return value;
  }
  try {
    return new RegExp(value, "i");
  } catch {
    return null;
  }
}

function normalizeRule(rawRule, defaults = {}) {
  const pattern = compilePattern(rawRule.pattern);
  if (!pattern || !rawRule.categoryCode) {
    return null;
  }
  return {
    id: rawRule.id ?? defaults.idPrefix ?? `custom_rule_${Math.random().toString(36).slice(2)}`,
    categoryCode: rawRule.categoryCode,
    confidence: rawRule.confidence ?? 0.85,
    pattern,
    priority: Number.isFinite(rawRule.priority) ? rawRule.priority : defaults.priority ?? 100,
    scope: (rawRule.scope ?? defaults.scope ?? "TENANT").toUpperCase(),
    accountLabel: rawRule.accountLabel ?? null,
    reasonCode: rawRule.reasonCode ?? defaults.reasonCode ?? "keyword_rule_match",
  };
}

function ruleAppliesToAccount(rule, accountLabel) {
  if (rule.scope !== "ACCOUNT") {
    return true;
  }
  if (!rule.accountLabel) {
    return false;
  }
  return normalizeAccountLabel(rule.accountLabel) === normalizeAccountLabel(accountLabel);
}

export class RulesEngine {
  #defaultRules;

  constructor() {
    this.#defaultRules = DEFAULT_RULES.map((rule) =>
      normalizeRule(rule, {
        priority: 100,
        scope: "TENANT",
        reasonCode: "default_rule_match",
      }),
    ).filter(Boolean);
  }

  classify(transaction, context, customRules = []) {
    const description = `${transaction.description ?? ""} ${transaction.rawLine ?? ""}`.trim();
    if (!description) {
      return null;
    }

    const runtimeRules = customRules
      .map((rule) =>
        normalizeRule(rule, {
          priority: 500,
          scope: "TENANT",
          reasonCode: "tenant_rule_match",
          idPrefix: "tenant_rule",
        }),
      )
      .filter(Boolean)
      .filter((rule) => ruleAppliesToAccount(rule, context?.accountLabel))
      .sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);

    const hint = accountHintDecision(context?.accountLabel);
    let best = hint;

    for (const rule of [...runtimeRules, ...this.#defaultRules]) {
      if (!rule.pattern.test(description)) {
        continue;
      }
      const candidate = {
        categoryCode: rule.categoryCode,
        confidence: rule.confidence,
        reasonCode: rule.reasonCode,
        ruleId: rule.id,
        priority: rule.priority,
      };
      if (
        !best ||
        candidate.priority > (best.priority ?? 0) ||
        (candidate.priority === (best.priority ?? 0) && candidate.confidence > best.confidence)
      ) {
        best = candidate;
      }
    }

    return best;
  }
}
