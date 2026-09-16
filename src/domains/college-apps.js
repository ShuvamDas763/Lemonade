// Lemonade — Domain Plugin: College Applications.
//
// Provides optional domain recommendations for college apps:
//   - Lost and Found
//   - College Library
//   - College Canteen
//   - Study Partner
//
// These recommendations are strictly non-binding (PROVENANCE.SYSTEM_RECOMMENDED)
// and never overwrite or remove user-stated requirements.

import { registerPlugin, addRecommendation } from "./registry.js";
import { ITEM_CATEGORY, PRIORITY, IMPACT } from "../spec/model.js";

// Plugin 1: Lost and Found
export const lostFoundPlugin = {
  name: "college-lost-found",
  description: "Enhancement patterns for college lost-and-found services",
  match(prompt) {
    const p = prompt.toLowerCase();
    return (p.includes("lost") && p.includes("found")) || (p.includes("lost-and-found"));
  },
  enhance(spec, rawPrompt) {
    addRecommendation(spec, "Item metadata recommendation: support photo, title, description, location, and date", {
      category: ITEM_CATEGORY.DATA_ENTITY,
      priority: PRIORITY.SHOULD,
      impact: IMPACT.MEDIUM,
    });
    addRecommendation(spec, "Claim workflow recommendation: users submit claims; item owners accept/reject; accepted marks item returned", {
      category: ITEM_CATEGORY.WORKFLOW,
      priority: PRIORITY.SHOULD,
      impact: IMPACT.MEDIUM,
    });
    addRecommendation(spec, "Security recommendation: users edit/delete only own posts; report flag for suspicious posts", {
      category: ITEM_CATEGORY.SECURITY,
      priority: PRIORITY.SHOULD,
      impact: IMPACT.MEDIUM,
    });
    addRecommendation(spec, "Boundary recommendation: once an item is marked returned, block further claim submissions", {
      category: ITEM_CATEGORY.CONSTRAINT,
      priority: PRIORITY.SHOULD,
      impact: IMPACT.LOW,
    });
    return spec;
  },
};

// Plugin 2: College Library
export const libraryPlugin = {
  name: "college-library",
  description: "Enhancement patterns for college library management",
  match(prompt) {
    const p = prompt.toLowerCase();
    return p.includes("library") && (p.includes("book") || p.includes("borrow") || p.includes("college"));
  },
  enhance(spec, rawPrompt) {
    addRecommendation(spec, "Role separation recommendation: distinct portals for students (search/request) and librarians (catalog/circulation)", {
      category: ITEM_CATEGORY.SYSTEM_RECOMMENDATION,
      priority: PRIORITY.SHOULD,
      impact: IMPACT.MEDIUM,
    });
    addRecommendation(spec, "Catalog data recommendation: book availability status, copy count, and shelf location", {
      category: ITEM_CATEGORY.DATA_ENTITY,
      priority: PRIORITY.SHOULD,
      impact: IMPACT.MEDIUM,
    });
    addRecommendation(spec, "Circulation workflow: students request issued books; librarians approve upon return and manage issued/returned status", {
      category: ITEM_CATEGORY.WORKFLOW,
      priority: PRIORITY.SHOULD,
      impact: IMPACT.HIGH,
    });
    addRecommendation(spec, "Admin metrics recommendation: dashboard displaying counts of available, issued, and pending books", {
      category: ITEM_CATEGORY.SYSTEM_RECOMMENDATION,
      priority: PRIORITY.COULD,
      impact: IMPACT.LOW,
    });
    return spec;
  },
};

// Plugin 3: College Canteen
export const canteenPlugin = {
  name: "college-canteen",
  description: "Enhancement patterns for college canteen ordering",
  match(prompt) {
    const p = prompt.toLowerCase();
    return p.includes("canteen") || (p.includes("cafeteria") && p.includes("order")) || (p.includes("food") && p.includes("pickup") && p.includes("order"));
  },
  enhance(spec, rawPrompt) {
    addRecommendation(spec, "Menu data recommendation: item names, prices, and live availability (available vs sold out)", {
      category: ITEM_CATEGORY.DATA_ENTITY,
      priority: PRIORITY.SHOULD,
      impact: IMPACT.MEDIUM,
    });
    addRecommendation(spec, "Ordering workflow: pickup token/order number generation; staff status transitions (preparing -> ready -> completed)", {
      category: ITEM_CATEGORY.WORKFLOW,
      priority: PRIORITY.SHOULD,
      impact: IMPACT.MEDIUM,
    });
    addRecommendation(spec, "Operational boundary: pickup only; no delivery tracking or accounts needed for students in v1", {
      category: ITEM_CATEGORY.CONSTRAINT,
      priority: PRIORITY.SHOULD,
      impact: IMPACT.LOW,
    });
    return spec;
  },
};

// Plugin 4: Study Partner
export const studyPartnerPlugin = {
  name: "college-study-partner",
  description: "Enhancement patterns for student study-partner discovery",
  match(prompt) {
    const p = prompt.toLowerCase();
    return (p.includes("study") && (p.includes("partner") || p.includes("group") || p.includes("buddy"))) || (p.includes("partner") && p.includes("classmate"));
  },
  enhance(spec, rawPrompt) {
    addRecommendation(spec, "Profile metadata recommendation: name, course, college, and enrolled subjects", {
      category: ITEM_CATEGORY.DATA_ENTITY,
      priority: PRIORITY.SHOULD,
      impact: IMPACT.MEDIUM,
    });
    addRecommendation(spec, "Discovery recommendation: filter by college and search by shared subject", {
      category: ITEM_CATEGORY.SYSTEM_RECOMMENDATION,
      priority: PRIORITY.SHOULD,
      impact: IMPACT.MEDIUM,
    });
    addRecommendation(spec, "Connection workflow: send, accept, and reject study-partner requests; 1-on-1 chat once accepted", {
      category: ITEM_CATEGORY.WORKFLOW,
      priority: PRIORITY.SHOULD,
      impact: IMPACT.MEDIUM,
    });
    return spec;
  },
};

// Auto-register college plugins
registerPlugin(lostFoundPlugin);
registerPlugin(libraryPlugin);
registerPlugin(canteenPlugin);
registerPlugin(studyPartnerPlugin);
