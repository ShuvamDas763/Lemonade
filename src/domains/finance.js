// Lemonade — Domain Plugin: Finance & Expense Tracking.
//
// Provides optional domain recommendations for expense tracking and personal finance:
// These recommendations are strictly non-binding (PROVENANCE.SYSTEM_RECOMMENDED)
// and never overwrite or remove user-stated requirements.

import { registerPlugin, addRecommendation } from "./registry.js";
import { ITEM_CATEGORY, PRIORITY, IMPACT } from "../spec/model.js";

export const expensePlugin = {
  name: "finance-expense-tracker",
  description: "Enhancement patterns for expense tracking and budgeting",
  match(prompt) {
    const p = prompt.toLowerCase();
    return p.includes("expense") || p.includes("spending") || (p.includes("budget") && (p.includes("track") || p.includes("money")));
  },
  enhance(spec, rawPrompt) {
    addRecommendation(spec, "Expense data recommendation: store amount, date, description, and category (e.g. food, travel, shopping, utilities)", {
      category: ITEM_CATEGORY.DATA_ENTITY,
      priority: PRIORITY.SHOULD,
      impact: IMPACT.MEDIUM,
    });
    addRecommendation(spec, "Analytics recommendation: dashboard displaying monthly spending totals and category breakdown chart", {
      category: ITEM_CATEGORY.SYSTEM_RECOMMENDATION,
      priority: PRIORITY.SHOULD,
      impact: IMPACT.MEDIUM,
    });
    addRecommendation(spec, "Budget calculation: support monthly income entry and real-time remaining balance calculation (income minus expenses)", {
      category: ITEM_CATEGORY.WORKFLOW,
      priority: PRIORITY.SHOULD,
      impact: IMPACT.MEDIUM,
    });
    addRecommendation(spec, "Data isolation recommendation: multi-user apps must strictly isolate expense records per user account", {
      category: ITEM_CATEGORY.SECURITY,
      priority: PRIORITY.MUST,
      impact: IMPACT.HIGH,
    });
    return spec;
  },
};

// Auto-register finance plugin
registerPlugin(expensePlugin);
