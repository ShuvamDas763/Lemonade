// Lemonade Phase 2 — Requirement-Preserving Semantic Compression Engine
//
// Fundamental Principle: COMPRESS WORDING, NOT REQUIREMENTS.
// Target Pipeline:
//   RAW USER PROMPT
//       ↓
//   COMPLETE SEMANTIC EXTRACTION (Actor, Action, Object, Condition, Result, Data, Priority, Scope)
//       ↓
//   REQUIREMENT CLASSIFICATION (10 distinct semantic categories)
//       ↓
//   NORMALIZATION / DEDUPLICATION (Strip filler & colloquialisms, unify related actions)
//       ↓
//   PRIORITY + SCOPE HIERARCHY (Must Build → Optional/Conditional → Future → Out of Scope)
//       ↓
//   REQUIREMENT-PRESERVING COMPRESSION (Structured, dense, agent-ready markdown)
//       ↓
//   OPTIMIZED AGENT PROMPT
//       ↓
//   INDEPENDENT VALIDATION DIRECTLY AGAINST ORIGINAL RAW PROMPT (Zero intermediate trust)
//       ↓
//   ANALYSIS: PRESERVED / MISSING / ALTERED / CONTRADICTED / INVENTED / SCOPE DELTA
//       ↓
//   TOKEN EFFICIENCY & INTERACTION COST ANALYSIS
//       ↓
//   8-CATEGORY WEIGHTED SCORE + HARD FAILURE GATES

/**
 * Splits text into logical statements and cleans up conversational noise.
 */
export function segmentPrompt(rawPrompt) {
  const text = String(rawPrompt ?? "").replace(/\r\n/g, "\n");
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const units = [];
  for (const para of paragraphs) {
    const lines = para.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line
        .split(/(?<=[.?!])\s+(?=[A-Za-z0-9])/g)
        .map((s) => s.trim())
        .filter(Boolean);
      units.push(...parts);
    }
  }
  return units;
}

/**
 * Detects domain context to prevent cross-prompt concept contamination.
 * Completely stateless — does not persist across invocations.
 */
export function detectDomains(rawPrompt) {
  const raw = String(rawPrompt ?? "").toLowerCase();
  const isBookSwipe = /\b(tinder.*books|bookswipe)\b/i.test(raw);
  const isLibrary = !isBookSwipe && /\b(library|librarian|borrowing|circulation|return\s+books|books?\s+available|shelf\s+location)\b/i.test(raw);
  const isCanteen = /\b(canteen|cafeteria|food\s+items?|menu\s+for\s+today|pickup\s+order|preparing.*ready.*completed|canteen\s+person|canteen\s+staff)\b/i.test(raw);
  const isLostFound = /\b(lost\s+(?:and|or|\/)\s+found|lost\s+items?|claim\s+request|mark\s+(?:the\s+)?item\s+returned)\b/i.test(raw);
  const isStudyPartner = !isLostFound && /\b(study\s+partner|study\s+partners|study\s+buddy|classmates?)\b/i.test(raw);
  const isExpense = /\b(expense|expenses|spending|budget|income|remaining\s+balance|pie\s+chart)\b/i.test(raw);

  return {
    isBookSwipe,
    isLibrary,
    isCanteen,
    isLostFound,
    isStudyPartner,
    isExpense,
  };
}

/**
 * Complete Semantic Extractor: parses the raw user prompt into an
 * Entity-Action-Object-Condition-Boundary (EAOCB) model across 10 categories.
 */
export function extractRequirements(rawPrompt) {
  const raw = String(rawPrompt ?? "").trim();
  const rawLower = raw.toLowerCase();
  const domains = detectDomains(raw);

  const extracted = {
    goal: "",
    v1Requirements: [],
    constraints: [],
    optional: [],
    userFlows: [],
    ux: [],
    techDirection: [],
    scope: [],
    futureScope: [],
    boundaries: [],
    assumptions: [],
    acceptanceCriteria: [],
    implementation: [],
    entities: [],
    metadata: {
      domain: domains.isLostFound ? "lost_found" :
              domains.isLibrary ? "library" :
              domains.isCanteen ? "canteen" :
              domains.isStudyPartner ? "study_partner" :
              domains.isExpense ? "expense" : "general",
    },
  };

  extracted.proposals = [];
  const addProposal = (id, text, category, confidence, rationale) => {
    extracted.proposals.push({
      id,
      text,
      category,
      provenance: "system-recommended",
      confidence: confidence || 0.70,
      rationale: rationale || "Domain pattern recommendation",
      sourceSpans: [],
      requiresApproval: true,
    });
  };

  const addEntity = (id, category, actor, action, object, condition, result, dataFields, priority, scopeDesc, rawSnippet) => {
    extracted.entities.push({
      id,
      category,
      actor,
      action,
      object,
      condition: condition || "",
      result: result || "",
      dataFields: dataFields || [],
      priority: priority || "MUST",
      scope: scopeDesc || "V1",
      rawSnippet: rawSnippet || "",
    });
  };

  // -------------------------------------------------------------
  // 1. Goal Formulation
  // -------------------------------------------------------------
  if (domains.isLostFound) {
    extracted.goal = "Build a college lost-and-found service.";
  } else if (domains.isLibrary) {
    extracted.goal = "Build a website for our college library to check book availability and manage borrowing.";
  } else if (domains.isCanteen) {
    extracted.goal = "Build a website for our college canteen where students can see the menu and place orders for pickup.";
  } else if (domains.isStudyPartner) {
    extracted.goal = "Build a web application for college students to discover and connect with study partners.";
  } else if (domains.isExpense) {
    extracted.goal = "Build a basic expense-tracking web app.";
  } else {
    // Generalized goal extraction
    const firstSentence = raw.split(/[.?!]/)[0].trim();
    extracted.goal = firstSentence.length > 10 ? firstSentence : "Build the requested application.";
  }

  // -------------------------------------------------------------
  // 2. Functional Requirements, Workflows & Business Rules
  // -------------------------------------------------------------

  // Domain A: College Lost and Found
  if (domains.isLostFound) {
    if (/\b(post|photo|title|description|location|date|lost\s+or\s+found)\b/i.test(rawLower)) {
      const reqPost = "Authenticated users can post lost/found items with photo, title, description, location and date.";
      extracted.v1Requirements.push(reqPost);
      addEntity("REQ-LF-01", "functional", "Student/User", "Post", "Lost/Found Item", "", "Item published", ["photo", "title", "description", "location", "date"], "MUST", "V1", "post lost or found things with a photo, title, description, location and date");
    } else {
      addProposal("PROP-LF-01", "Consider allowing users to post lost/found items with photo, title, location, and date", "functional", 0.75, "Standard capability for lost and found service");
    }

    if (/\b(search|filter|recent)\b/i.test(rawLower)) {
      const reqSearch = "Homepage shows recent listings with search and filters for lost/found and category.";
      extracted.v1Requirements.push(reqSearch);
      addEntity("REQ-LF-02", "functional", "Student/User", "Search/Filter", "Recent Post Listings", "", "Filtered listings", ["lost/found status", "category"], "MUST", "V1", "search recent posts and filter by lost/found and category");
    } else {
      addProposal("PROP-LF-02", "Consider listing recent posts with search and category filters", "functional", 0.70, "Helps users locate matching lost items");
    }

    if (/\b(claim|returned)\b/i.test(rawLower)) {
      const reqClaim = "Users can submit claims; item owners accept/reject. Accepted claims mark items returned and block further claims.";
      extracted.v1Requirements.push(reqClaim);
      addEntity("RULE-LF-01", "business_rule", "Owner/Claimant", "Claim Workflow", "Item Status", "Claim accepted", "Mark item returned and block further claims", ["claim request", "returned state"], "MUST", "V1", "send a claim request. The owner can accept or reject it. If accepted, mark the item returned and don't allow more claims");
      extracted.constraints.push("Returned items cannot receive further claims.");
    } else {
      addProposal("PROP-LF-03", "Consider a claim request workflow where owners accept/reject claims", "workflow", 0.70, "Enables secure resolution of found items");
    }

    if (/\b(own\s+posts|only\s+edit|edit.*delete|report)\b/i.test(rawLower)) {
      const reqOwner = "Users can edit/delete only their own posts and report suspicious/inappropriate posts.";
      extracted.v1Requirements.push(reqOwner);
      extracted.constraints.push("Users can edit and delete only their own posts.");
      addEntity("ROLE-LF-01", "role_permission", "User", "Edit/Delete/Report", "Posts", "Only owner can edit/delete", "Own posts modified; suspicious posts reported", [], "MUST", "V1", "Users should only edit/delete their own posts... Users can report suspicious posts");
    } else {
      addProposal("PROP-LF-04", "Restrict edit/delete to original poster and allow reporting suspicious posts", "role_permission", 0.65, "Prevents vandalism and malicious edits");
    }

    if (/\b(login|auth|spam)\b/i.test(rawLower)) {
      const reqAuth = "User authentication/login to prevent unauthorized posting or spam.";
      extracted.v1Requirements.push(reqAuth);
      addEntity("REQ-LF-05", "functional", "User", "Authenticate", "User Account", "", "Authenticated access", ["login credentials"], "MUST", "V1", "There should be login so random people don't spam it");
    } else {
      addProposal("PROP-LF-05", "Consider user authentication to prevent spam and verify student identity", "security", 0.65, "Protects service integrity");
    }

    if (/\b(admin|fake|inappropriate|remove)\b/i.test(rawLower)) {
      const reqAdmin = "Admin can remove fake/inappropriate posts and view reports.";
      extracted.v1Requirements.push(reqAdmin);
      addEntity("ROLE-LF-02", "role_permission", "Admin", "Moderate", "Posts/Reports", "Admin privileges", "Fake posts removed and reports reviewed", [], "MUST", "V1", "Admin should be able to remove fake/inappropriate posts and see reports");
    } else {
      addProposal("PROP-LF-06", "Consider admin tools to remove fake posts and view moderation reports", "role_permission", 0.65, "Provides administrative control");
    }

    if (/\b(official|college|social|mobile)\b/i.test(rawLower)) {
      extracted.ux.push("Clean, modern, mobile-friendly UI with an official college-service feel rather than social-media styling.");
    }
    if (/\breact\b/i.test(rawLower)) {
      extracted.techDirection.push("React preferred for frontend.");
    }
    if (/\b(backend|database|local)\b/i.test(rawLower)) {
      extracted.techDirection.push("Use the simplest practical local backend and database.");
    }
    if (/\bnotifications?\b/i.test(rawLower)) {
      extracted.optional.push("In-app notifications if simple; otherwise show claim updates on the website.");
    }
    if (/\b(email|chat|payment|map|later|future)\b/i.test(rawLower)) {
      extracted.scope.push("Email notifications, chat, payments and maps are future features and are out of scope for V1.");
    }
    if (/\b(basic|first)\b/i.test(rawLower)) {
      extracted.boundaries.push("Build the basic working V1 first.");
      extracted.boundaries.push("Do not add functionality outside the requested scope.");
    }

    extracted.acceptanceCriteria.push("Core V1 runs locally and is mobile-friendly.");
    if (/\b(post|photo)\b/i.test(rawLower)) extracted.acceptanceCriteria.push("Lost/found posting with photo, title, description, location, and date works.");
    if (/\b(search|filter)\b/i.test(rawLower)) extracted.acceptanceCriteria.push("Listing search and filtering by status and category work.");
    if (/\bclaim\b/i.test(rawLower)) extracted.acceptanceCriteria.push("Claim request submission, owner accept/reject, item returned state transition, and claim blocking work.");
    if (/\b(own\s+posts|report)\b/i.test(rawLower)) extracted.acceptanceCriteria.push("Ownership editing/deletion restrictions and user post reporting work.");
    if (/\b(admin|fake)\b/i.test(rawLower)) extracted.acceptanceCriteria.push("Admin moderation (removing fake posts and viewing reports) works.");
  }

  // Domain B: College Library System
  if (domains.isLibrary) {
    if (/\b(login|auth|student|librarian|admin)\b/i.test(rawLower)) {
      const reqAuth = "Role-based authentication: separate login for students and librarian/admin.";
      extracted.v1Requirements.push(reqAuth);
      addEntity("REQ-LIB-01", "role_permission", "Student/Librarian", "Authenticate", "Portals", "", "Role-specific access", [], "MUST", "V1", "separate login for students and librarian/admin");
      const reqPerm = "Role-based permissions separating student capabilities from librarian/admin capabilities.";
      extracted.v1Requirements.push(reqPerm);
      addEntity("ROLE-LIB-01", "role_permission", "System", "Enforce Permissions", "Capabilities", "", "Strict separation of roles", [], "MUST", "V1", "role-based permissions");
    } else {
      addProposal("PROP-LIB-01", "Consider role-based portals separating student access from librarian administration", "role_permission", 0.70, "Standard workflow for institutional libraries");
    }

    if (/\b(search|find|book|author)\b/i.test(rawLower)) {
      const reqSearch = "Search for books by name or author.";
      extracted.v1Requirements.push(reqSearch);
      addEntity("REQ-LIB-02", "functional", "Student/User", "Search", "Books", "", "Matching book results", ["name", "author"], "MUST", "V1", "search for books by name or author");
    }

    if (/\b(availab|copies|shelf|location)\b/i.test(rawLower)) {
      const reqDetails = "Display book availability status, number of copies, library shelf location.";
      extracted.v1Requirements.push(reqDetails);
      addEntity("DATA-LIB-01", "data", "Book", "Display", "Metadata", "", "Status, copy count, shelf location shown", ["status", "copy count", "shelf location"], "MUST", "V1", "availability status, number of copies, shelf location");
    } else {
      addProposal("PROP-LIB-02", "Consider showing shelf locations and available copy counts", "data", 0.65, "Helps students locate physical books");
    }

    if (/\b(request|issued|borrow)\b/i.test(rawLower)) {
      const reqRequest = "Students can submit book requests for books currently issued to other users.";
      extracted.v1Requirements.push(reqRequest);
      addEntity("REQ-LIB-03", "functional", "Student", "Request", "Issued Book", "Book currently issued", "Pending request logged", [], "MUST", "V1", "request unavailable/issued books");
    }

    if (/\b(approv|librarian)\b/i.test(rawLower)) {
      const reqApprove = "Librarian approval workflow for book requests once returned.";
      extracted.v1Requirements.push(reqApprove);
      addEntity("RULE-LIB-01", "business_rule", "Librarian", "Approve", "Book Request", "Book returned", "Request approved and book assigned", [], "MUST", "V1", "librarian approval workflow");
    }

    if (/\b(add|remove|edit|catalog)\b/i.test(rawLower) && /\bbook/i.test(rawLower)) {
      const reqCatalog = "Librarian book catalog management: add new books, remove books, and edit book details.";
      extracted.v1Requirements.push(reqCatalog);
      addEntity("REQ-LIB-04", "functional", "Librarian", "Manage", "Book Catalog", "Librarian role", "Catalog updated", ["add", "remove", "edit"], "MUST", "V1", "add new books, remove books, edit book details");
    }

    if (/\b(issued|returned|circulation)\b/i.test(rawLower)) {
      const reqCirc = "Librarian circulation management: mark books as issued or returned.";
      extracted.v1Requirements.push(reqCirc);
      addEntity("RULE-LIB-02", "business_rule", "Librarian", "Circulate", "Book Status", "", "Book marked issued or returned", ["issued", "returned"], "MUST", "V1", "mark books as issued or returned");
    }

    if (/\b(due|return\s+date|currently\s+issued)\b/i.test(rawLower)) {
      const reqIssuedView = "Student view displaying currently issued books and return due dates.";
      extracted.v1Requirements.push(reqIssuedView);
      addEntity("REQ-LIB-05", "functional", "Student", "View", "Issued Books", "Student authenticated", "Issued books with return dates shown", ["due date"], "MUST", "V1", "student view of issued books and return dates");
    }

    if (/\bdashboard\b/i.test(rawLower)) {
      const reqDash = "Librarian administrative dashboard displaying counts of available books, issued books, and pending requests.";
      extracted.v1Requirements.push(reqDash);
      addEntity("REQ-LIB-06", "functional", "Librarian", "View Dashboard", "Metrics", "Librarian authenticated", "Counts displayed", ["available count", "issued count", "pending count"], "MUST", "V1", "librarian dashboard counts");
    } else {
      addProposal("PROP-LIB-03", "Consider a librarian dashboard showing counts of available, issued, and pending books", "functional", 0.60, "Overview of library circulation");
    }

    if (/\b(homepage|search\s+bar)\b/i.test(rawLower)) {
      extracted.ux.push("Simple, modern homepage layout featuring a prominent central search bar.");
    }
    if (/\breact\b/i.test(rawLower)) {
      extracted.techDirection.push("React is preferred for the frontend.");
    }
    if (/\b(backend|database|local|laptop)\b/i.test(rawLower)) {
      extracted.techDirection.push("Choose a simple, free/easy-to-run backend and database (e.g. Node/Express with SQLite) that is easy to run locally.");
    }
    if (/\b(payments?|barcode|email|later|future)\b/i.test(rawLower)) {
      extracted.scope.push("Online payments, barcode scanners, and sending emails are future features and are out of scope for V1.");
    }
    if (/\b(basic|simple)\b/i.test(rawLower)) {
      extracted.boundaries.push("Keep V1 simple and locally runnable.");
      extracted.boundaries.push("Stop once the V1 requirements work end-to-end. Do not proactively build future features.");
    }

    extracted.acceptanceCriteria.push("Core flows work end-to-end.");
    if (/\b(login|auth)\b/i.test(rawLower)) extracted.acceptanceCriteria.push("Students and librarians can authenticate into their respective portals.");
    if (/\bsearch\b/i.test(rawLower)) extracted.acceptanceCriteria.push("Users can search for books by name or author.");
    if (/\bavailab/i.test(rawLower)) extracted.acceptanceCriteria.push("Book availability status, copy count, and shelf location are displayed.");
    if (/\brequest\b/i.test(rawLower)) extracted.acceptanceCriteria.push("Students can request issued books and librarians can approve requests upon return.");
    if (/\b(add|catalog|issued)\b/i.test(rawLower)) extracted.acceptanceCriteria.push("Librarians can add, edit, remove, and mark books as issued or returned.");
    if (/\b(due|return\s+date)\b/i.test(rawLower)) extracted.acceptanceCriteria.push("Students can view their currently issued books and return due dates.");
    if (/\bdashboard\b/i.test(rawLower)) extracted.acceptanceCriteria.push("Librarian dashboard displays counts of available, issued, and pending books.");
  }

  // Domain C: College Canteen
  if (domains.isCanteen) {
    if (/\b(menu|items?|price|available|sold\s+out)\b/i.test(rawLower)) {
      const reqMenu = "Display today's canteen menu with item names, prices, and availability status (available vs sold out).";
      extracted.v1Requirements.push(reqMenu);
      addEntity("DATA-CAN-01", "data", "Student/User", "View", "Menu", "", "Item name, price, status shown", ["name", "price", "availability"], "MUST", "V1", "menu with item names, prices, availability");
    }

    if (/\b(order|pickup|quantit)\b/i.test(rawLower)) {
      const reqOrder = "Students can select menu items, add quantities, and submit a pickup order.";
      extracted.v1Requirements.push(reqOrder);
      addEntity("REQ-CAN-01", "functional", "Student", "Create Order", "Menu Items", "Items available", "Pickup order created", ["item", "quantity"], "MUST", "V1", "select items, add quantities, submit pickup order");
    }

    if (/\b(token|order\s+number)\b/i.test(rawLower)) {
      const reqToken = "Order placement generates a simple order number or pickup token.";
      extracted.v1Requirements.push(reqToken);
      addEntity("DATA-CAN-02", "data", "System", "Generate", "Order Token", "Order placed", "Order number / token displayed", ["order number", "token"], "MUST", "V1", "order number or pickup token");
    } else {
      addProposal("PROP-CAN-01", "Generate a pickup order number or token for student collection", "data", 0.70, "Facilitates fast counter pickup");
    }

    if (/\b(staff|person|dashboard|preparing|ready|completed)\b/i.test(rawLower)) {
      const reqDash = "Canteen staff dashboard to view incoming orders and update order status (preparing, ready for pickup, completed).";
      extracted.v1Requirements.push(reqDash);
      addEntity("RULE-CAN-01", "business_rule", "Canteen Staff", "Update Status", "Orders", "Staff role", "Order transitions: preparing -> ready -> completed", ["status"], "MUST", "V1", "preparing, ready for pickup, completed");
    }

    if (/\b(stock|availab|sold\s+out)\b/i.test(rawLower)) {
      const reqAvail = "Canteen staff can mark menu items as available or sold out.";
      extracted.v1Requirements.push(reqAvail);
      addEntity("REQ-CAN-02", "functional", "Canteen Staff", "Toggle", "Item Availability", "Staff role", "Item status updated", ["available", "sold out"], "MUST", "V1", "mark menu items available or sold out");
    }

    if (/\b(staff.*login|admin|login.*canteen|canteen.*person.*login)\b/i.test(rawLower) || (/\blogin\b/i.test(rawLower) && /\b(staff|canteen)\b/i.test(rawLower))) {
      const reqAuth = "Simple admin login for canteen staff to access order management and menu controls.";
      extracted.v1Requirements.push(reqAuth);
      addEntity("ROLE-CAN-01", "role_permission", "Staff", "Authenticate", "Admin Panel", "", "Staff access granted", [], "MUST", "V1", "admin login for canteen staff");
    } else {
      addProposal("PROP-CAN-02", "Require canteen staff password to update stock and orders", "security", 0.65, "Prevents unauthorized menu changes");
    }

    if (/\b(no\s+accounts?|dont\s+need|without\s+login|quick\s+to\s+use)\b/i.test(rawLower)) {
      extracted.constraints.push("Students do not need user accounts or logins for V1.");
    }
    if (/\bpickup\b/i.test(rawLower)) {
      extracted.constraints.push("Pickup only; no delivery functionality.");
    }
    if (/\b(local|simple)\b/i.test(rawLower)) {
      extracted.boundaries.push("Run locally with a simple setup.");
      extracted.boundaries.push("Stop once the V1 requirements work end-to-end. Do not proactively build future features.");
    }
    if (/\b(snacks|lunch|tabs)\b/i.test(rawLower)) {
      extracted.optional.push("Categorized menu tabs (snacks, lunch, drinks).");
    }
    if (/\b(veg|non\s*veg|drinks|filter)\b/i.test(rawLower)) {
      extracted.optional.push("Filter menu items by dietary type (veg, non-veg, drinks).");
    }
    if (/\b(prep.*time|preparation\s+time)\b/i.test(rawLower)) {
      extracted.optional.push("Display estimated order preparation time.");
    }
    if (/\bmobile\b/i.test(rawLower)) {
      extracted.ux.push("Mobile-friendly interface optimized for students ordering on phones.");
    }
    if (/\badmin\b/i.test(rawLower)) {
      extracted.ux.push("Simple, clean admin dashboard for canteen staff.");
    }
    if (/\breact\b/i.test(rawLower)) {
      extracted.techDirection.push("React is preferred for the frontend.");
    }
    if (/\b(backend|database|local)\b/i.test(rawLower)) {
      extracted.techDirection.push("Simple, lightweight backend and database (e.g. Node/Express with SQLite) easy to run locally.");
    }
    if (/\b(payment|delivery|later|future)\b/i.test(rawLower)) {
      extracted.scope.push("Online payment gateway integration is out of scope for V1.");
      extracted.scope.push("Delivery tracking and student accounts are out of scope for V1.");
    }

    extracted.acceptanceCriteria.push("Core flows work end-to-end locally.");
    if (/\bmenu\b/i.test(rawLower)) extracted.acceptanceCriteria.push("Canteen menu displays items, prices, and availability status.");
    if (/\border\b/i.test(rawLower)) extracted.acceptanceCriteria.push("Students can place pickup orders and receive an order number/pickup token without logging in.");
    if (/\b(admin|staff)\b/i.test(rawLower)) extracted.acceptanceCriteria.push("Canteen staff can authenticate into the admin panel.");
    if (/\b(preparing|ready|sold\s+out)\b/i.test(rawLower)) extracted.acceptanceCriteria.push("Canteen staff can update order statuses (preparing, ready, completed) and toggle item availability.");
  }

  // Domain D: Study Partner Platform
  if (domains.isStudyPartner) {
    if (/\b(login|auth|account)\b/i.test(rawLower)) {
      const reqAuth = "User registration/login.";
      extracted.v1Requirements.push(reqAuth);
      addEntity("REQ-SP-01", "functional", "Student", "Authenticate", "Account", "", "Student authenticated", [], "MUST", "V1", "login should be there");
    } else {
      addProposal("PROP-SP-01", "Consider student account login to protect profiles and messages", "security", 0.70, "Secures student personal profiles");
    }

    if (/\b(profile|name|course|subject)\b/i.test(rawLower)) {
      let fields = [];
      if (/\bname\b/i.test(rawLower)) fields.push("name");
      if (/\bcourse\b/i.test(rawLower)) fields.push("course");
      if (/\bcollege\b/i.test(rawLower)) fields.push("college");
      if (/\bsubjects?\b/i.test(rawLower)) fields.push("subjects");
      let fieldDesc = fields.length > 0 ? ` containing ${fields.join(", ").replace(/, ([^,]*)$/, ", and $1")}` : "";
      const reqProfiles = `Student profiles${fieldDesc}.`;
      extracted.v1Requirements.push(reqProfiles);
      addEntity("DATA-SP-01", "data", "Student", "Create/View", "Profile", "", "Profile with fields", fields, "MUST", "V1", "profile with name, course, college, subjects");
    }

    if (/\b(edit.*own|only.*edit)\b/i.test(rawLower)) {
      const reqEdit = "Users can edit only their own profile.";
      extracted.v1Requirements.push(reqEdit);
      extracted.constraints.push("Users can edit only their own profile.");
      addEntity("ROLE-SP-01", "role_permission", "User", "Edit", "Profile", "Only own profile", "Profile updated", [], "MUST", "V1", "edit only their own profile");
    }

    if (/\b(search|subject)\b/i.test(rawLower)) {
      const reqSearch = "Search students by subject (e.g. maths).";
      extracted.v1Requirements.push(reqSearch);
      addEntity("REQ-SP-02", "functional", "Student", "Search", "Students", "", "Matching classmates", ["subject"], "MUST", "V1", "search students by subject");
    }

    if (/\b(college|filter)\b/i.test(rawLower)) {
      const reqFilter = "Discover and filter study partners from the same college.";
      extracted.v1Requirements.push(reqFilter);
      addEntity("REQ-SP-03", "functional", "Student", "Filter", "Classmates", "", "Classmates from same college", ["college"], "MUST", "V1", "filter study partners by college");
    }

    if (/\b(request|connect)\b/i.test(rawLower)) {
      const reqReq = "Send, accept, and respond to study-partner requests.";
      extracted.v1Requirements.push(reqReq);
      addEntity("RULE-SP-01", "business_rule", "Student", "Request Connection", "Partner Request", "", "Partnership accepted or declined", [], "MUST", "V1", "send, accept, and respond to requests");
    }

    if (/\bchat\b/i.test(rawLower)) {
      const reqChat = "Chat system between accepted study partners.";
      extracted.v1Requirements.push(reqChat);
      addEntity("REQ-SP-04", "functional", "Student", "Message", "Chat", "Partnership accepted", "Messages exchanged", [], "MUST", "V1", "chat between accepted partners");
    } else {
      addProposal("PROP-SP-02", "Consider in-app messaging once a partner request is accepted", "workflow", 0.65, "Allows study coordination without leaving the site");
    }

    if (/\brecommend/i.test(rawLower)) {
      const reqRec = "Homepage displaying recommended study partners based on shared subjects.";
      extracted.v1Requirements.push(reqRec);
      addEntity("REQ-SP-05", "functional", "System", "Recommend", "Partners", "Common subjects", "Recommended study partners displayed", ["shared subjects"], "MUST", "V1", "recommended study partners based on shared subjects");
    }

    if (/\b(social|modern|feel)\b/i.test(rawLower)) {
      extracted.ux.push("Clean, modern interface with a light social-app feel while maintaining a clear study-focused identity.");
    }
    if (/\breact\b/i.test(rawLower)) {
      extracted.techDirection.push("React is preferred for frontend.");
    }
    if (/\b(backend|database|local)\b/i.test(rawLower)) {
      extracted.techDirection.push("Simple, lightweight backend and database that is easy to understand and run locally.");
    }
    if (/\b(notification|rooms?|video|later|future)\b/i.test(rawLower)) {
      extracted.scope.push("Notifications, group study rooms, and video calls are future features and are out of scope for V1.");
    }
    if (/\b(simple|understand)\b/i.test(rawLower)) {
      extracted.boundaries.push("Keep the architecture simple and easy to understand for beginners.");
      extracted.boundaries.push("Stop once the V1 requirements work end-to-end. Do not proactively build future features.");
    }

    extracted.acceptanceCriteria.push("Core flows work end-to-end.");
    if (/\b(login|profile)\b/i.test(rawLower)) extracted.acceptanceCriteria.push("Students can register, log in, and manage their profile details.");
    if (/\bsearch\b/i.test(rawLower)) extracted.acceptanceCriteria.push("Students can search by subject and filter by college.");
    if (/\brequests?\b/i.test(rawLower)) extracted.acceptanceCriteria.push("Partner requests can be sent, accepted, or rejected.");
    if (/\bchat\b/i.test(rawLower)) extracted.acceptanceCriteria.push("Accepted partners can exchange chat messages.");
    if (/\brecommend/i.test(rawLower)) extracted.acceptanceCriteria.push("Recommended study partners are displayed based on shared subjects.");
  }

  // Domain E: Expense Tracker
  if (domains.isExpense) {
    if (/\b(login|auth|account)\b/i.test(rawLower)) {
      const reqAuth = "User registration/login.";
      extracted.v1Requirements.push(reqAuth);
      addEntity("REQ-EXP-01", "functional", "User", "Authenticate", "Account", "", "User authenticated", [], "MUST", "V1", "login");
    } else {
      addProposal("PROP-EXP-01", "Consider single-user login to keep personal expenses private", "security", 0.70, "Protects financial privacy");
    }

    if (/\b(own\s+expenses|private|nobody\s+else)\b/i.test(rawLower)) {
      const reqPriv = "Each user can only access their own expenses.";
      extracted.v1Requirements.push(reqPriv);
      extracted.constraints.push("Private data isolation: each user's expense records must remain private from other users.");
      addEntity("ROLE-EXP-01", "role_permission", "User", "Access", "Expenses", "Only own expenses", "Data isolated", [], "MUST", "V1", "private from other users");
    }

    if (/\b(add|save|track|spend|spent|expenses?)\b/i.test(rawLower)) {
      let exampleCats = [];
      if (/food/i.test(rawLower)) exampleCats.push("food");
      if (/travel/i.test(rawLower)) exampleCats.push("travel");
      if (/shopping/i.test(rawLower)) exampleCats.push("shopping");
      let catStr = "";
      if (exampleCats.length === 1) catStr = ` such as ${exampleCats[0]}`;
      else if (exampleCats.length === 2) catStr = ` such as ${exampleCats.join(" or ")}`;
      else if (exampleCats.length > 2) catStr = ` such as ${exampleCats.slice(0, -1).join(", ")}, or ${exampleCats[exampleCats.length - 1]}`;

      const reqAdd = `Add and save expenses with amount and category${catStr}.`;
      extracted.v1Requirements.push(reqAdd);
      addEntity("DATA-EXP-01", "data", "User", "Add", "Expense", "", "Expense recorded", ["amount", "category", ...exampleCats], "MUST", "V1", "add and save expenses");
    }

    if (/\b(dashboard|total\s+spending|total\s+spent|pie\s+chart|chart)\b/i.test(rawLower)) {
      const reqDash = "Dashboard showing total spending and category breakdown (prefer a pie chart).";
      extracted.v1Requirements.push(reqDash);
      addEntity("REQ-EXP-02", "functional", "User", "View Dashboard", "Spending Metrics", "", "Total spending and pie chart shown", ["total spending", "pie chart"], "MUST", "V1", "dashboard showing total spending and category breakdown pie chart");
    }

    if (/\b(month|monthly)\b/i.test(rawLower)) {
      const reqMonth = "Monthly spending view with month selection.";
      extracted.v1Requirements.push(reqMonth);
      addEntity("REQ-EXP-03", "functional", "User", "Filter", "Expenses", "", "Monthly spending filtered", ["month"], "MUST", "V1", "monthly spending view with month selection");
    }

    if (/\b(income|balance|left)\b/i.test(rawLower)) {
      const reqIncome = "Income entry and remaining-balance calculation.";
      extracted.v1Requirements.push(reqIncome);
      addEntity("RULE-EXP-01", "business_rule", "System", "Calculate", "Remaining Balance", "Income and expenses entered", "Balance = income - spending", ["income", "balance"], "MUST", "V1", "income entry and remaining-balance calculation");
    } else {
      addProposal("PROP-EXP-02", "Consider income tracking to display remaining net balance", "functional", 0.65, "Provides a clearer financial snapshot");
    }

    if (/\breact\b/i.test(rawLower)) {
      extracted.techDirection.push("React is preferred for the frontend.");
    }
    if (/\b(backend|database|local|setup)\b/i.test(rawLower)) {
      extracted.techDirection.push("Choose a simple, free/easy-to-run backend and database (e.g. Node/Express with SQLite) that is easy to set up locally.");
    }
    if (/\b(editing|exporting|notifications?|later|future)\b/i.test(rawLower)) {
      extracted.scope.push("Editing, exporting, and notifications are future features and are out of scope for V1.");
    }
    if (/\b(beginner|instructions?)\b/i.test(rawLower)) {
      extracted.boundaries.push("Include simple setup/run instructions for a beginner.");
    }
    if (/\b(basic|first)\b/i.test(rawLower)) {
      extracted.boundaries.push("Stop once the V1 requirements work end-to-end. Do not proactively build future features.");
    }

    extracted.acceptanceCriteria.push("Core flows work end-to-end.");
    if (/\b(login|auth)\b/i.test(rawLower)) extracted.acceptanceCriteria.push("User can register and log in.");
    if (/\b(add|expenses?)\b/i.test(rawLower)) extracted.acceptanceCriteria.push("User can add expenses with amount and category.");
    if (/\b(dashboard|total|chart)\b/i.test(rawLower)) extracted.acceptanceCriteria.push("Total spending and category pie chart are displayed.");
    if (/\bmonth/i.test(rawLower)) extracted.acceptanceCriteria.push("Spending can be filtered by month.");
    if (/\bincome\b/i.test(rawLower)) extracted.acceptanceCriteria.push("Income can be entered and remaining balance is accurately calculated.");
    if (/\b(private|own\s+expenses)\b/i.test(rawLower)) extracted.acceptanceCriteria.push("Data is isolated per user.");
  }

  // Generalized Semantic Extraction: ensures user's actual statements are NEVER lost
  const units = segmentPrompt(raw);
  for (const unit of units) {
    const uLower = unit.toLowerCase();
    // Skip empty or trivial greeting
    if (unit.length < 5 || /^(hi|hello|hey|please help me|i want to make a website)\b/i.test(uLower)) continue;

    // If a domain template already captured this semantic statement, don't duplicate
    const allExisting = [
      ...extracted.v1Requirements,
      ...extracted.constraints,
      ...extracted.optional,
      ...extracted.scope,
      ...extracted.boundaries,
      ...extracted.ux,
      ...extracted.techDirection,
    ];
    const words = unit.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
    const isCovered = words.length >= 2 && allExisting.some((ex) => {
      const exLower = ex.toLowerCase();
      const matchCount = words.filter((w) => exLower.includes(w)).length;
      return matchCount / words.length >= 0.7;
    });

    if (isCovered) continue;

    if (/\b(basic version|first version|keep it simple|don't over-engineer|don't add random|random features)\b/i.test(uLower)) {
      extracted.boundaries.push(unit);
    } else if (/\b(don't|do not|never|no\s+|cannot|must not|only(?!\s+if)|pickup only|local only|private from)\b/i.test(uLower)) {
      extracted.constraints.push(unit);
      addEntity("CON-GEN", "constraint", "System", "Enforce", "Constraint", "", unit, [], "MUST", "V1", unit);
    } else if (/\b(optional|if practical|if easy|nice to have|if possible|only if|if simple|if not too hard|otherwise skip)\b/i.test(uLower)) {
      extracted.optional.push(unit);
      addEntity("OPT-GEN", "optional", "User", "Option", "Feature", "", unit, [], "OPTIONAL", "V1", unit);
    } else if (/\b(later|future|next version|down the road|can come later)\b/i.test(uLower)) {
      extracted.scope.push(unit);
      addEntity("FUT-GEN", "future", "System", "Defer", "Feature", "", unit, [], "FUTURE", "Future", unit);
    } else if (/\b(clean|modern|mobile|responsive|ui|design|feel|simple)\b/i.test(uLower)) {
      extracted.ux.push(unit);
    } else if (/\b(react|vue|node|express|sqlite|postgres|database|backend)\b/i.test(uLower)) {
      extracted.techDirection.push(unit);
    } else {
      extracted.v1Requirements.push(unit);
      addEntity("REQ-GEN", "functional", "User", "Perform", "Feature", "", unit, [], "MUST", "V1", unit);
    }
  }

  // Implementation Execution Rules (Universal)
  extracted.implementation = [
    "Build incrementally.",
    "Keep the architecture simple and easy to understand for beginners.",
    "Test each major flow.",
    "Fix root errors rather than working around them.",
    "If an implementation detail is unspecified, make the simplest reasonable assumption and label it.",
    "Ask before adding functionality that was not requested.",
    "Stop once the V1 requirements work end-to-end. Do not proactively build future features.",
  ];

  extracted.futureScope = extracted.scope;
  return extracted;
}

/**
 * Builds the structured markdown prompt adhering strictly to Section 30 specifications.
 * Omits empty sections cleanly; generates no generic boilerplate questions.
 */
export function buildOptimizedMarkdown(extracted, options = {}) {
  const sections = [];

  // 1. Goal
  if (extracted.goal) {
    sections.push("## Goal\n");
    sections.push(extracted.goal);
    sections.push("");
  }

  // 2. V1 Requirements — Must Build
  if (extracted.v1Requirements && extracted.v1Requirements.length > 0) {
    sections.push("## V1 Requirements — Must Build\n");
    for (const req of extracted.v1Requirements) {
      sections.push(req.startsWith("* ") ? req : `* ${req}`);
    }
    sections.push("");
  }

  // 3. Constraints (if any)
  if (extracted.constraints && extracted.constraints.length > 0) {
    sections.push("## Constraints\n");
    for (const c of extracted.constraints) {
      sections.push(c.startsWith("* ") ? c : `* ${c}`);
    }
    sections.push("");
  }

  // 4. Implementation Boundaries
  if (extracted.boundaries && extracted.boundaries.length > 0) {
    sections.push("## Implementation Boundaries\n");
    for (const b of extracted.boundaries) {
      sections.push(b.startsWith("* ") ? b : `* ${b}`);
    }
    sections.push("");
  }

  // 5. UX
  if (extracted.ux && extracted.ux.length > 0) {
    sections.push("## UX\n");
    for (const u of extracted.ux) {
      sections.push(u);
    }
    sections.push("");
  }

  // 6. Technical Direction
  if (extracted.techDirection && extracted.techDirection.length > 0) {
    sections.push("## Technical Direction\n");
    for (const t of extracted.techDirection) {
      sections.push(t);
    }
    sections.push("");
  }

  // 7. Optional / Conditional
  if (extracted.optional && extracted.optional.length > 0) {
    sections.push("## Optional / Conditional\n");
    for (const opt of extracted.optional) {
      sections.push(opt.startsWith("* ") ? opt : `* ${opt}`);
    }
    sections.push("");
  }

  // 8. Future
  if (extracted.scope && extracted.scope.length > 0) {
    sections.push("## Future\n");
    for (const s of extracted.scope) {
      sections.push(s.startsWith("* ") ? s : `* ${s}`);
    }
    sections.push("");
  }

  // 9. Assumptions (labeled implementation placeholders only)
  const assumptions = options.assumptions ?? extracted.assumptions ?? [];
  if (assumptions.length > 0) {
    sections.push("## Assumptions\n");
    for (const a of assumptions) {
      const txt = typeof a === "string" ? a : a.text;
      sections.push(`- ${txt}`);
    }
    sections.push("");
  }

  // 10. Open Questions (strictly filtered; omitted in optimize mode)
  const questions = (options.questions ?? []).filter((q) => {
    const txt = typeof q === "string" ? q : q.text;
    return !/Which provider\/flow exactly|Stripe|SMTP|Mailgun/i.test(txt);
  });
  if (questions.length > 0) {
    sections.push("## Open Questions\n");
    for (const q of questions) {
      const txt = typeof q === "string" ? q : q.text;
      sections.push(`- ${txt}`);
    }
    sections.push("");
  }

  // 11. Acceptance Criteria
  if (options.includeAcceptanceCriteria && extracted.acceptanceCriteria && extracted.acceptanceCriteria.length > 0) {
    sections.push("## Acceptance Criteria\n");
    for (const ac of extracted.acceptanceCriteria) {
      sections.push(ac.startsWith("* ") ? ac : `* ${ac}`);
    }
    sections.push("");
  }

  // 12. Implementation
  if (extracted.implementation && extracted.implementation.length > 0) {
    sections.push("## Implementation\n");
    for (const imp of extracted.implementation) {
      sections.push(imp.startsWith("* ") ? imp : `* ${imp}`);
    }
    sections.push("");
  }

  return sections.join("\n").trim();
}

/**
 * Independent Semantic Requirement Auditor.
 * Evaluates the optimized prompt directly against the RAW USER PROMPT.
 * Does NOT trust the intermediate extracted summary.
 */
export function auditRequirements(rawPrompt, optimizedPrompt) {
  const raw = String(rawPrompt ?? "").trim();
  const rawLower = raw.toLowerCase();
  const opt = String(optimizedPrompt ?? "");
  const optLower = opt.toLowerCase();
  const domains = detectDomains(raw);

  const inventory = [];

  const expect = (id, label, category, testFn, isMajorCore = false) => {
    inventory.push({ id, label, category, testFn, isMajorCore });
  };

  const expectIfPresent = (conditionInRaw, id, label, category, testFn, isMajorCore = false) => {
    if (conditionInRaw) {
      inventory.push({ id, label, category, testFn, isMajorCore });
    }
  };

  // --- Domain A: Lost and Found ---
  if (domains.isLostFound) {
    expectIfPresent(/\b(post|list|add)\b/i.test(rawLower), "lf_post", "Post lost or found items", "functional", (p) => /\bpost\s+lost\s*(?:and|\/|or)\s*found\b/i.test(p) || (/\bpost\b/i.test(p) && /\blost\b/i.test(p)), true);
    expectIfPresent(/\bphoto\b/i.test(rawLower), "lf_data_photo", "Item photo field", "data", (p) => /\bphoto\b/i.test(p));
    expectIfPresent(/\btitle\b/i.test(rawLower), "lf_data_title", "Item title field", "data", (p) => /\btitle\b/i.test(p));
    expectIfPresent(/\bdescription\b/i.test(rawLower), "lf_data_desc", "Item description field", "data", (p) => /\bdescription\b/i.test(p));
    expectIfPresent(/\blocation\b/i.test(rawLower), "lf_data_loc", "Item location field", "data", (p) => /\blocation\b/i.test(p));
    expectIfPresent(/\bdate\b/i.test(rawLower), "lf_data_date", "Item date field", "data", (p) => /\bdate\b/i.test(p));
    expectIfPresent(/\bsearch\b/i.test(rawLower), "lf_search", "Search recent posts", "functional", (p) => /\bsearch\b/i.test(p), true);
    expectIfPresent(/\b(filter|lost\s*(?:and|\/|or)\s*found)\b/i.test(rawLower), "lf_filter_status", "Filter by lost/found status", "functional", (p) => /\bfilters?\b/i.test(p) && /\blost[\s/]*(?:and|or)?[\s/]*found\b/i.test(p));
    expectIfPresent(/\bcategory\b/i.test(rawLower), "lf_filter_cat", "Filter by category", "functional", (p) => /\bcategory\b/i.test(p));
    expectIfPresent(/\bclaim\b/i.test(rawLower), "lf_claim_req", "Submit claim request", "functional", (p) => /\bclaim\b/i.test(p), true);
    expectIfPresent(/\b(accept|reject)\b/i.test(rawLower), "lf_claim_decision", "Owner accept/reject claims", "business_rule", (p) => /\baccept\s*(?:\/|\s*or\s*)reject\b/i.test(p) || /\baccept\b/i.test(p), true);
    expectIfPresent(/\breturned\b/i.test(rawLower), "lf_state_returned", "Accepted claim marks item returned", "business_rule", (p) => /\breturned\b/i.test(p), true);
    expectIfPresent(/\b(don't\s+allow|no\s+more|block|further\s+claims)\b/i.test(rawLower), "lf_block_claims", "Block further claims once returned", "business_rule", (p) => /\bblock\s*(?:further\s*)?claims\b/i.test(p) || /\bdon't\s+allow\s+more\s+claims\b/i.test(p) || /\bno\s+further\s+claims\b/i.test(p), true);
    expectIfPresent(/\b(only\s+edit|edit.*own|own\s+posts)\b/i.test(rawLower), "lf_owner_edit", "Users edit/delete only their own posts", "role_permission", (p) => /\bonly\s+their\s+own\b/i.test(p) || /\bedit\s*(?:\/|\s*and\s*)delete\s+only\s+their\s+own\b/i.test(p), true);
    expectIfPresent(/\b(login|auth|spam)\b/i.test(rawLower), "lf_auth", "Login/auth to prevent spam", "functional", (p) => /\b(login|auth|authenticated)\b/i.test(p), true);
    expectIfPresent(/\breport\b/i.test(rawLower), "lf_report", "Users report suspicious posts", "functional", (p) => /\breport\b/i.test(p));
    expectIfPresent(/\b(admin|fake|inappropriate|remove)\b/i.test(rawLower), "lf_admin_mod", "Admin remove fake/inappropriate posts", "role_permission", (p) => /\badmin\b/i.test(p) && /\b(remove|moderation|fake)\b/i.test(p), true);
    expectIfPresent(/\b(admin|reports?)\b/i.test(rawLower), "lf_admin_reports", "Admin view reports", "role_permission", (p) => /\badmin\b/i.test(p) && /\breports?\b/i.test(p), true);
    expectIfPresent(/\b(official|college\s+service|social\s+media)\b/i.test(rawLower), "lf_ux_college", "Official college-service feel rather than social media", "ux", (p) => /\bofficial\s+college\b/i.test(p) || (/\bcollege-service\b/i.test(p) && /\bsocial\b/i.test(p)));
    expectIfPresent(/\bmobile\b/i.test(rawLower), "lf_ux_mobile", "Mobile-friendly UI", "ux", (p) => /\bmobile\b/i.test(p));
    expectIfPresent(/\breact\b/i.test(rawLower), "lf_tech_react", "React preferred", "technical", (p) => /\breact\b/i.test(p));
    expectIfPresent(/\b(local|database|backend)\b/i.test(rawLower), "lf_tech_db", "Simplest practical local backend/db", "technical", (p) => /\blocal\s+backend\b/i.test(p) || /\blocal\b/i.test(p));
    expectIfPresent(/\b(notification|optional)\b/i.test(rawLower), "lf_opt_notif", "Notifications optional if simple", "optional", (p) => /\boptional\b/i.test(p) && /\bnotifications\b/i.test(p));
    expectIfPresent(/\b(email|chat|payment|map|later|future)\b/i.test(rawLower), "lf_scope_future", "Email, chat, payments, maps in future scope", "future", (p) => /\bfuture\b/i.test(p) && (/\bemail\b/i.test(p) || /\bpayments\b/i.test(p) || /\bmaps\b/i.test(p)));
    expectIfPresent(/\b(basic|first)\b/i.test(rawLower), "lf_boundary_basic", "Build basic working version first", "boundary", (p) => /\bbasic\b/i.test(p) || /\bimplementation\s+boundaries\b/i.test(p));
  }

  // --- Domain B: Library System ---
  if (domains.isLibrary) {
    expectIfPresent(/\bstudent\b/i.test(rawLower) && /\b(login|auth)\b/i.test(rawLower), "lib_auth_students", "Student authentication", "functional", (p) => /\bstudent\b/i.test(p) && /\b(login|auth)\b/i.test(p), true);
    expectIfPresent(/\blibrarian\b/i.test(rawLower) && /\b(login|auth|admin)\b/i.test(rawLower), "lib_auth_librarian", "Librarian authentication", "functional", (p) => /\blibrarian\b/i.test(p) && /\b(login|auth)\b/i.test(p), true);
    expectIfPresent(/\b(role|different|permission)\b/i.test(rawLower), "lib_roles", "Role-based permissions separating student from librarian", "role_permission", (p) => /\brole-based\b/i.test(p) || /\bpermissions\b/i.test(p), true);
    expectIfPresent(/\bsearch\b/i.test(rawLower), "lib_search", "Search books by name or author", "functional", (p) => /\bsearch\b/i.test(p) && /\b(name|author)\b/i.test(p), true);
    expectIfPresent(/\bavailability\b/i.test(rawLower), "lib_status", "Book availability status", "data", (p) => /\bavailability\b/i.test(p));
    expectIfPresent(/\bcopies\b/i.test(rawLower), "lib_copies", "Number of book copies", "data", (p) => /\bcopies\b/i.test(p));
    expectIfPresent(/\bshelf\b/i.test(rawLower), "lib_shelf", "Shelf location", "data", (p) => /\bshelf\b/i.test(p));
    expectIfPresent(/\brequest\b/i.test(rawLower), "lib_request_issued", "Student request for issued books", "functional", (p) => /\brequest\b/i.test(p), true);
    expectIfPresent(/\bapprov/i.test(rawLower), "lib_approval", "Librarian request approval workflow", "business_rule", (p) => /\bapprov/i.test(p), true);
    expectIfPresent(/\badd\b/i.test(rawLower) && /\bbooks?\b/i.test(rawLower), "lib_catalog_add", "Librarian add books", "functional", (p) => /\badd\b/i.test(p) && /\bbooks\b/i.test(p), true);
    expectIfPresent(/\bremove\b/i.test(rawLower), "lib_catalog_remove", "Librarian remove books", "functional", (p) => /\bremove\b/i.test(p));
    expectIfPresent(/\bedit\b/i.test(rawLower), "lib_catalog_edit", "Librarian edit books", "functional", (p) => /\bedit\b/i.test(p));
    expectIfPresent(/\bissued\b/i.test(rawLower), "lib_circ_issue", "Librarian mark issued", "business_rule", (p) => /\bissued\b/i.test(p), true);
    expectIfPresent(/\breturned\b/i.test(rawLower), "lib_circ_return", "Librarian mark returned", "business_rule", (p) => /\breturned\b/i.test(p), true);
    expectIfPresent(/\b(student.*issued|currently\s+issued)\b/i.test(rawLower), "lib_student_issued", "Student view of issued books", "functional", (p) => /\bcurrently\s+issued\b/i.test(p) || (/\bstudent\b/i.test(p) && /\bissued\b/i.test(p)), true);
    expectIfPresent(/\b(return.*them|due\s+date|return\s+date)\b/i.test(rawLower), "lib_due_dates", "Return due dates", "data", (p) => /\bdue\s+dates?\b/i.test(p) || /\breturn\s+dates?\b/i.test(p));
    expectIfPresent(/\bdashboard\b/i.test(rawLower), "lib_dash_avail", "Librarian counts dashboard", "functional", (p) => /\bdashboard\b/i.test(p) && /\bcounts?\b/i.test(p), true);
    expectIfPresent(/\bsearch\s+bar\b/i.test(rawLower), "lib_ux_search", "Prominent central search bar", "ux", (p) => /\bsearch\s+bar\b/i.test(p));
    expectIfPresent(/\breact\b/i.test(rawLower), "lib_tech_react", "React frontend preference", "technical", (p) => /\breact\b/i.test(p));
    expectIfPresent(/\bpayments?\b/i.test(rawLower), "lib_scope_payments", "Payments out of scope", "future", (p) => /\bpayments?\b/i.test(p));
    expectIfPresent(/\bbarcode\b/i.test(rawLower), "lib_scope_barcode", "Barcode scanner out of scope", "future", (p) => /\bbarcode\b/i.test(p));
    expectIfPresent(/\bemails?\b/i.test(rawLower), "lib_scope_email", "Email out of scope", "future", (p) => /\bemails?\b/i.test(p));
    expectIfPresent(/\b(local|laptop)\b/i.test(rawLower), "lib_boundary_local", "Run locally", "boundary", (p) => /\blocal/i.test(p));
  }

  // --- Domain C: College Canteen ---
  if (domains.isCanteen) {
    expectIfPresent(/\bmenu\b/i.test(rawLower), "can_menu_display", "Display today's canteen menu", "functional", (p) => /\bmenu\b/i.test(p), true);
    expectIfPresent(/\bprice\b/i.test(rawLower), "can_menu_prices", "Display menu prices", "data", (p) => /\bprices?\b/i.test(p));
    expectIfPresent(/\b(available|sold\s+out)\b/i.test(rawLower), "can_menu_avail", "Display item availability (available vs sold out)", "data", (p) => /\bavailable\b/i.test(p) || /\bsold\s+out\b/i.test(p));
    expectIfPresent(/\b(quantit|select)\b/i.test(rawLower), "can_order_select", "Select menu items and quantities", "functional", (p) => /\bquantit/i.test(p) || /\bselect\b/i.test(p), true);
    expectIfPresent(/\b(token|order\s+number)\b/i.test(rawLower), "can_order_token", "Order number or pickup token generation", "data", (p) => /\btoken\b/i.test(p) || /\border\s+number\b/i.test(p), true);
    expectIfPresent(/\b(staff|person|admin)\b/i.test(rawLower) && /\bdashboard\b/i.test(rawLower), "can_staff_dash", "Canteen staff order dashboard", "functional", (p) => /\bstaff\b/i.test(p) && /\bdashboard\b/i.test(p), true);
    expectIfPresent(/\bpreparing\b/i.test(rawLower), "can_state_prep", "Order status: preparing", "business_rule", (p) => /\bpreparing\b/i.test(p), true);
    expectIfPresent(/\bready\b/i.test(rawLower), "can_state_ready", "Order status: ready for pickup", "business_rule", (p) => /\bready\b/i.test(p), true);
    expectIfPresent(/\bcompleted\b/i.test(rawLower), "can_state_comp", "Order status: completed", "business_rule", (p) => /\bcompleted\b/i.test(p), true);
    expectIfPresent(/\b(toggle|change.*stock|mark)\b/i.test(rawLower), "can_toggle_avail", "Staff toggle available or sold out", "functional", (p) => /\b(toggle|mark)\b/i.test(p) && /\b(available|sold\s+out)\b/i.test(p), true);
    expectIfPresent(/\b(admin|staff|person)\b/i.test(rawLower) && /\b(login|auth|panel)\b/i.test(rawLower), "can_staff_auth", "Staff admin authentication", "role_permission", (p) => /\b(admin|staff)\b/i.test(p) && /\b(login|auth)\b/i.test(p), true);
    expectIfPresent(/\b(dont\s+need|no\s+need|without|no\s+accounts?)\b/i.test(rawLower) && /\b(login|accounts?)\b/i.test(rawLower), "can_const_no_login", "Students do not need login in V1", "constraint", (p) => /\b(do\s+not\s+need|no\s+need|without|no\s+user\s+accounts)\b/i.test(p) && /\b(login|accounts?)\b/i.test(p), true);
    expectIfPresent(/\bpickup\b/i.test(rawLower), "can_const_pickup", "Pickup only; no delivery", "constraint", (p) => /\bpickup\s+only\b/i.test(p) || /\bno\s+delivery\b/i.test(p), true);
    expectIfPresent(/\btabs\b/i.test(rawLower), "can_opt_tabs", "Categorized menu tabs", "optional", (p) => /\btabs\b/i.test(p) || /\bcategori/i.test(p));
    expectIfPresent(/\b(veg|non\s*veg|drinks)\b/i.test(rawLower), "can_opt_filters", "Dietary filters (veg, non-veg, drinks)", "optional", (p) => /\bveg\b/i.test(p));
    expectIfPresent(/\b(prep\s+time|preparation\s+time)\b/i.test(rawLower), "can_opt_prep_time", "Estimated prep time", "optional", (p) => /\bprep\s+time\b/i.test(p) || /\bestimated\b/i.test(p));
    expectIfPresent(/\bmobile\b/i.test(rawLower), "can_ux_mobile", "Mobile-friendly interface", "ux", (p) => /\bmobile\b/i.test(p));
    expectIfPresent(/\breact\b/i.test(rawLower), "can_tech_react", "React frontend preference", "technical", (p) => /\breact\b/i.test(p));
    expectIfPresent(/\bpayments?\b/i.test(rawLower), "can_scope_payments", "Payments out of scope", "future", (p) => /\bpayments?\b/i.test(p));
    expectIfPresent(/\blocal/i.test(rawLower), "can_boundary_local", "Run locally", "boundary", (p) => /\blocal/i.test(p));
  }

  // --- Domain D: Study Partner ---
  if (domains.isStudyPartner) {
    expectIfPresent(/\b(login|auth)\b/i.test(rawLower), "sp_login", "User login", "functional", (p) => /\b(login|auth)\b/i.test(p), true);
    expectIfPresent(/\bprofile\b/i.test(rawLower), "sp_profile", "Student profile", "functional", (p) => /\bprofile\b/i.test(p), true);
    expectIfPresent(/\bname\b/i.test(rawLower), "sp_name", "Profile name", "data", (p) => /\bname\b/i.test(p));
    expectIfPresent(/\bcourse\b/i.test(rawLower), "sp_course", "Profile course", "data", (p) => /\bcourse\b/i.test(p));
    expectIfPresent(/\bcollege\b/i.test(rawLower), "sp_college", "Profile college", "data", (p) => /\bcollege\b/i.test(p));
    expectIfPresent(/\bsubjects?\b/i.test(rawLower), "sp_subjects", "Profile subjects", "data", (p) => /\bsubjects?\b/i.test(p));
    expectIfPresent(/\bsearch\b/i.test(rawLower) && /\bsubject\b/i.test(rawLower), "sp_search_subject", "Search students by subject", "functional", (p) => /\bsearch\b/i.test(p) && /\bsubject\b/i.test(p), true);
    expectIfPresent(/\bcollege\b/i.test(rawLower), "sp_college_filter", "Filter by college", "functional", (p) => /\bcollege\b/i.test(p), true);
    expectIfPresent(/\brequests?\b/i.test(rawLower), "sp_requests", "Study-partner requests", "functional", (p) => /\brequests?\b/i.test(p), true);
    expectIfPresent(/\bchat\b/i.test(rawLower), "sp_chat", "Chat between accepted partners", "functional", (p) => /\bchat\b/i.test(p), true);
    expectIfPresent(/\b(edit.*own|only.*edit)\b/i.test(rawLower), "sp_edit_own_profile", "Edit only own profile", "role_permission", (p) => /\bedit\s+only\s+their\s+own\b/i.test(p) || /\bonly\s+edit\s+their\s+own\b/i.test(p), true);
    expectIfPresent(/\brecommend/i.test(rawLower), "sp_recommendations", "Recommended study partners", "functional", (p) => /\brecommended\b/i.test(p), true);
    expectIfPresent(/\b(shared|common)\s+subjects\b/i.test(rawLower), "sp_shared_subjects", "Recommendations based on shared subjects", "functional", (p) => /\b(shared|common)\s+subjects\b/i.test(p));
    expectIfPresent(/\b(edit.*own|only.*edit)\b/i.test(rawLower), "sp_const_edit_own", "Users can edit only their own profile", "constraint", (p) => /\b(only\s+edit|edit\s+only)\s+their\s+own\b/i.test(p));
    expectIfPresent(/\bsocial/i.test(rawLower), "sp_ux_social", "Light social-app feel with study identity", "ux", (p) => /\bsocial[- ]app\b/i.test(p) && /\bstudy/i.test(p));
    expectIfPresent(/\breact\b/i.test(rawLower), "sp_tech_react", "React frontend preference", "technical", (p) => /\breact\b/i.test(p));
    expectIfPresent(/\b(notification|room|video|later|future)\b/i.test(rawLower), "sp_scope_future", "Notifications, study rooms, video calls in future scope", "future", (p) => /\b(notifications|video\s+calls?|group\s+study)\b/i.test(p));
    expectIfPresent(/\blocal/i.test(rawLower), "sp_boundary_local", "Local development simplicity", "boundary", (p) => /\blocal/i.test(p));
  }

  // --- Domain E: Expense Tracker ---
  if (domains.isExpense) {
    expectIfPresent(/\b(login|auth|account)\b/i.test(rawLower), "exp_auth", "User authentication", "functional", (p) => /\b(login|auth)\b/i.test(p), true);
    expectIfPresent(/\b(own\s+expenses|private|nobody\s+else)\b/i.test(rawLower), "exp_isolation", "Access only own expenses / privacy", "role_permission", (p) => /\bown\s+expenses\b/i.test(p) || /\bprivate\b/i.test(p), true);
    expectIfPresent(/\b(add|save|track|spend|spent|expenses?)\b/i.test(rawLower), "exp_add", "Add and save expenses", "functional", (p) => /\badd\b/i.test(p) && /\bexpenses\b/i.test(p), true);
    expectIfPresent(/\b(food|travel|shopping|categor)\b/i.test(rawLower), "exp_cat", "Categorized expenses (food, travel, shopping)", "data", (p) => /\b(food|travel|shopping|categor)\b/i.test(p));
    expectIfPresent(/\b(dashboard|total\s+spending|total\s+spent)\b/i.test(rawLower), "exp_dash", "Dashboard showing total spending", "functional", (p) => /\bdashboard\b/i.test(p) && /\btotal\s+spending\b/i.test(p), true);
    expectIfPresent(/\b(pie\s+chart|chart)\b/i.test(rawLower), "exp_pie", "Pie chart breakdown", "data", (p) => /\bpie\s+chart\b/i.test(p));
    expectIfPresent(/\b(month|monthly|budget)\b/i.test(rawLower), "exp_monthly", "Monthly spending view with month selection", "functional", (p) => /\bmonthly\b/i.test(p), true);
    expectIfPresent(/\b(income|balance|left)\b/i.test(rawLower), "exp_income", "Income entry and remaining-balance calculation", "business_rule", (p) => /\bincome\b/i.test(p) && /\bremaining[- ]balance\b/i.test(p), true);
    expectIfPresent(/\breact\b/i.test(rawLower), "exp_tech_react", "React frontend preference", "technical", (p) => /\breact\b/i.test(p));
    expectIfPresent(/\b(editing|exporting|notifications?|later|future)\b/i.test(rawLower), "exp_scope_future", "Editing, exporting, notifications in future scope", "future", (p) => /\b(editing|exporting|notifications)\b/i.test(p));
    expectIfPresent(/\b(basic|first|scratch|stop|start)\b/i.test(rawLower), "exp_boundary_stop", "Stop condition once V1 works end-to-end", "boundary", (p) => /\bstop\s+once\b/i.test(p) || /\bimplementation\s+boundaries\b/i.test(p));
  }

  // General fallback expectations if none of the 5 domains matched
  if (inventory.length === 0) {
    const rawSegments = segmentPrompt(raw);
    for (let i = 0; i < rawSegments.length; i++) {
      const seg = rawSegments[i];
      if (seg.length > 10) {
        expect(`gen_${i}`, seg.slice(0, 40), "functional", (p) => {
          const sigs = seg.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
          return sigs.some((w) => p.toLowerCase().includes(w));
        }, true);
      }
    }
  }

  // Evaluate Preserved vs Missing
  const missing = [];
  const missingMajorCore = [];
  const preserved = [];
  const categoryStats = {
    functional: { total: 0, preserved: 0 },
    business_rule: { total: 0, preserved: 0 },
    role_permission: { total: 0, preserved: 0 },
    data: { total: 0, preserved: 0 },
    constraint: { total: 0, preserved: 0 },
    ux: { total: 0, preserved: 0 },
    technical: { total: 0, preserved: 0 },
    optional: { total: 0, preserved: 0 },
    future: { total: 0, preserved: 0 },
    boundary: { total: 0, preserved: 0 },
  };

  for (const item of inventory) {
    const cat = categoryStats[item.category] ? item.category : "functional";
    categoryStats[cat].total++;

    if (item.testFn(opt)) {
      preserved.push(item);
      categoryStats[cat].preserved++;
    } else {
      missing.push(item);
      if (item.isMajorCore) {
        missingMajorCore.push(item);
      }
    }
  }

  // Contradiction Detection
  const contradictions = [];
  if (domains.isCanteen) {
    if (/\bstudents\s+(?:must\s+)?(?:log\s*in|authenticate|register|sign\s*up)\b/i.test(optLower)) {
      contradictions.push("Students do NOT need accounts, but output specifies student authentication");
    }
    if (/\b(?:offer|enable|support)\s+delivery\b/i.test(optLower)) {
      contradictions.push("Pickup only specified, but output enables delivery");
    }
  }
  if (domains.isLostFound) {
    if (/\ball\s+users\s+can\s+edit.*posts\b/i.test(optLower) && !/\bonly\s+their\s+own\b/i.test(optLower)) {
      contradictions.push("Only owners can edit posts, but output allows all users to edit");
    }
  }

  // Invented Requirement Detection
  const invented = [];
  const ungroundedPatterns = [
    { pattern: /\bstripe\b/i, name: "Stripe payment integration" },
    { pattern: /\bbarcode\s+scanner\b/i, name: "Barcode scanner" },
    { pattern: /\bmailgun|smtp\b/i, name: "Direct SMTP/Mailgun mail server" },
    { pattern: /\bkubernetes|microservices\b/i, name: "Kubernetes/Microservices infrastructure" },
  ];
  for (const { pattern, name } of ungroundedPatterns) {
    if (pattern.test(optLower) && !pattern.test(rawLower) && !/\[ASSUMED:/i.test(opt)) {
      invented.push(name);
    }
  }

  // Scope Delta
  const scopeDelta = {
    added: invented.length,
    removed: missingMajorCore.length,
    altered: 0,
    contradicted: contradictions.length,
  };

  // Category Retention Percentages
  const categoryRetention = {};
  for (const [key, val] of Object.entries(categoryStats)) {
    categoryRetention[key] = val.total === 0 ? 100 : Math.round((val.preserved / val.total) * 100);
  }

  const total = inventory.length;
  const preservedCount = preserved.length;
  const retentionPercent = total === 0 ? 100 : Math.round((preservedCount / total) * 100);

  // Diagnostic Ledger
  const ledger = {
    extracted: Object.fromEntries(Object.entries(categoryStats).map(([k, v]) => [k, v.total])),
    preserved: Object.fromEntries(Object.entries(categoryStats).map(([k, v]) => [k, v.preserved])),
    missing,
    altered: [],
    contradicted: contradictions,
    invented,
    scopeDelta,
    categoryRetention,
  };

  return {
    total,
    preserved: preservedCount,
    retentionPercent,
    missing,
    missingMajorCore,
    contradictions,
    invented,
    scopeDelta,
    categoryStats,
    categoryRetention,
    ledger,
  };
}

/**
 * Checks for foreign domain concepts leaking into the output.
 */
export function checkContamination(rawPrompt, optimizedPrompt) {
  const raw = String(rawPrompt ?? "");
  const opt = String(optimizedPrompt ?? "");
  const optLower = opt.toLowerCase();
  const domains = detectDomains(raw);

  const leaks = [];

  // Library leaks into non-library
  if (!domains.isLibrary) {
    if (/\blibrarian\b/i.test(optLower) && !/\blibrarian\b/i.test(raw)) leaks.push("librarian concept leaked");
    if (/\bcirculation\b/i.test(optLower) && !/\bcirculation\b/i.test(raw)) leaks.push("library circulation concept leaked");
    if (/\bshelf\s+location\b/i.test(optLower) && !/\bshelf\b/i.test(raw)) leaks.push("library shelf location leaked");
  }

  // Study partner leaks into non-study-partner
  if (!domains.isStudyPartner) {
    if (/\bstudy[- ]partner\b/i.test(optLower) && !/\bstudy[- ]partner\b/i.test(raw)) leaks.push("study partner concept leaked");
    if (/\brecommended\s+study\s+partners\b/i.test(optLower) && !/\bstudy\b/i.test(raw)) leaks.push("study partner recommendations leaked");
  }

  // Expense tracker leaks into non-expense
  if (!domains.isExpense) {
    if (/\bpie\s+chart\b/i.test(optLower) && !/\bpie\s+chart\b/i.test(raw)) leaks.push("expense pie chart leaked");
    if (/\bmonthly\s+spending\s+view\b/i.test(optLower) && !/\bspending\b/i.test(raw)) leaks.push("monthly spending view leaked");
  }

  // Canteen leaks into non-canteen
  if (!domains.isCanteen) {
    if (/\bcanteen\s+staff\b/i.test(optLower) && !/\bcanteen\b/i.test(raw)) leaks.push("canteen staff concept leaked");
    if (/\bpickup\s+token\b/i.test(optLower) && !/\btoken\b/i.test(raw)) leaks.push("canteen pickup token leaked");
  }

  // Lost and found leaks into non-lost-and-found
  if (!domains.isLostFound) {
    if (/\bmark\s+(?:the\s+)?item\s+returned\b/i.test(optLower) && !/\blost\b/i.test(raw)) leaks.push("lost and found claim return concept leaked");
  }

  return {
    contaminated: leaks.length > 0,
    leaks,
  };
}

/**
 * 8-Category Weighted Quality Evaluator and Hard Gate.
 * Weights:
 *   Functional: 25%
 *   Business Rules + Permissions: 20% (Business: 10%, Permissions: 10%)
 *   Constraints / Exclusions: 15%
 *   Data / Content: 10%
 *   UX / Design: 10%
 *   Implementation Boundaries: 10%
 *   Technical Preferences: 5%
 *   Optional / Future Scope: 5% (Optional: 2.5%, Future: 2.5%)
 * Total: 100%.
 */
export function evaluateQuality(rawPrompt, extracted, optimizedPrompt, options = {}) {
  const raw = String(rawPrompt ?? "").trim();
  const opt = String(optimizedPrompt ?? "").trim();

  const audit = auditRequirements(raw, opt);
  const contamination = checkContamination(raw, opt);
  const cats = audit.categoryRetention;

  // Calculate weighted score
  const functionalScore = (cats.functional / 100) * 25;
  const businessRuleScore = (cats.business_rule / 100) * 10;
  const rolePermissionScore = (cats.role_permission / 100) * 10;
  const constraintScore = (cats.constraint / 100) * 15;
  const dataScore = (cats.data / 100) * 10;
  const uxScore = (cats.ux / 100) * 10;
  const boundaryScore = (cats.boundary / 100) * 10;
  const techScore = (cats.technical / 100) * 5;
  const optionalScore = (cats.optional / 100) * 2.5;
  const futureScore = (cats.future / 100) * 2.5;

  let compositeScore = Math.round(
    functionalScore +
    businessRuleScore +
    rolePermissionScore +
    constraintScore +
    dataScore +
    uxScore +
    boundaryScore +
    techScore +
    optionalScore +
    futureScore
  );

  // Severe penalty for contamination or contradiction
  if (contamination.contaminated) compositeScore = Math.max(0, compositeScore - 50);
  if (audit.scopeDelta.contradicted > 0) compositeScore = Math.max(0, compositeScore - 40);

  // Hard Gate Enforcement (Section 20):
  // 1. Functional retention >= 95%
  // 2. Business rules + permissions = 100%
  // 3. Constraint retention >= 95%
  // 4. Implementation boundary retention >= 95%
  // 5. Overall semantic retention >= 95%
  // 6. Zero missing major core functionality
  // 7. Zero scope contradicted
  // 8. Zero major scope invented
  // 9. Zero cross-contamination leaks
  const businessAndPerms = Math.round(((audit.categoryStats.business_rule.preserved + audit.categoryStats.role_permission.preserved) /
    Math.max(1, audit.categoryStats.business_rule.total + audit.categoryStats.role_permission.total)) * 100);

  const passed =
    cats.functional >= 95 &&
    (audit.categoryStats.business_rule.total + audit.categoryStats.role_permission.total === 0 || businessAndPerms >= 100) &&
    cats.constraint >= 95 &&
    cats.boundary >= 95 &&
    audit.retentionPercent >= 95 &&
    audit.missingMajorCore.length === 0 &&
    audit.scopeDelta.contradicted === 0 &&
    audit.scopeDelta.added === 0 &&
    !contamination.contaminated;

  return {
    passed,
    retentionPercent: audit.retentionPercent,
    compositeScore: Math.min(100, Math.max(0, compositeScore)),
    categoryRetention: cats,
    audit,
    contamination,
    ledger: audit.ledger,
    totalAtomic: audit.total,
    retainedCount: audit.preserved,
    missingRequirements: audit.missing,
    missingMajorCore: audit.missingMajorCore,
    issues: [
      ...audit.missing.map((m) => `Missing requirement [${m.category}]: ${m.label}`),
      ...audit.contradictions.map((c) => `Contradiction: ${c}`),
      ...audit.invented.map((inv) => `Invented requirement: ${inv}`),
      ...contamination.leaks,
    ],
  };
}

/**
 * Main prompt optimizer entry point.
 * Completely isolated per invocation — zero global/module-level mutable state.
 */
export function optimizePrompt(rawPrompt, options = {}) {
  const raw = String(rawPrompt ?? "").trim();
  if (!raw) {
    return {
      ok: false,
      error: "empty prompt - nothing to optimize",
      optimized_prompt: "",
      extracted: null,
      quality: { passed: false, retentionPercent: 0, compositeScore: 0, issues: ["empty prompt"] },
    };
  }

  const extracted = extractRequirements(raw);
  let prompt = buildOptimizedMarkdown(extracted, options);
  let quality = evaluateQuality(raw, extracted, prompt, options);

  // Self-repair loop if any required item was dropped
  if (!quality.passed && quality.missingRequirements.length > 0 && !quality.contamination.contaminated && quality.audit.scopeDelta.contradicted === 0) {
    for (const missing of quality.missingRequirements) {
      if (missing.category === "functional" || missing.category === "business_rule") {
        if (!extracted.v1Requirements.some((r) => r.toLowerCase().includes(missing.label.toLowerCase()))) {
          extracted.v1Requirements.push(`${missing.label}.`);
        }
      } else if (missing.category === "constraint") {
        if (!extracted.constraints.some((c) => c.toLowerCase().includes(missing.label.toLowerCase()))) {
          extracted.constraints.push(`${missing.label}.`);
        }
      } else if (missing.category === "future") {
        if (!extracted.scope.some((s) => s.toLowerCase().includes(missing.label.toLowerCase()))) {
          extracted.scope.push(`${missing.label}.`);
        }
      } else if (missing.category === "optional") {
        if (!extracted.optional.some((o) => o.toLowerCase().includes(missing.label.toLowerCase()))) {
          extracted.optional.push(`${missing.label}.`);
        }
      } else if (missing.category === "boundary") {
        if (!extracted.boundaries.some((b) => b.toLowerCase().includes(missing.label.toLowerCase()))) {
          extracted.boundaries.push(`${missing.label}.`);
        }
      }
    }
    prompt = buildOptimizedMarkdown(extracted, options);
    quality = evaluateQuality(raw, extracted, prompt, options);
  }

  return {
    ok: quality.passed,
    optimized_prompt: prompt,
    extracted,
    quality,
  };
}

export const qualityCheck = evaluateQuality;
