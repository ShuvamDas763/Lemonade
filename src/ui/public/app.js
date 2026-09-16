// Lemonade Control Room — Client Application Logic (Vanilla JS).
// Zero framework dependencies.

(function () {
  "use strict";

  // State
  let currentSpec = null;
  let currentValidation = null;
  let currentExports = null;
  let currentCards = [];
  let selectedCardIndex = -1;
  let activeFilter = "all";

  // Sample prompts from unseen & novel domains
  const SAMPLES = {
    saas: `Build a multi-tenant B2B customer feedback portal.
Tenants can create surveys with custom rating scales and text questions.
Customers can submit responses via public share link without creating an account.
Managers must login with company SSO and can view aggregate analytics and sentiment scores.
Data must be strictly isolated between tenants in the database.
Exporting responses to CSV and email notifications can come in v2.
Keep v1 simple and runnable locally using React and Node/Express with SQLite.`,
    ecommerce: `Build a lightweight digital download store for indie musicians.
Musicians can register, upload audio tracks with cover art, set prices in USD, and see sales counts.
Fans can browse tracks, listen to a 30-second preview, and purchase via simple token checkout.
No physical shipping or complex inventory tracking is needed.
Audio downloads must be private and generated via secure expiring URLs.
React frontend with Node/SQLite backend. Run locally first.`,
    study: `i want to make a website for college students to find study partners.
Students make a profile with name, course, and subjects.
Search for other students by subject and filter by college.
Send and accept partner requests; once accepted, students can chat.
Users can edit only their own profile.
React frontend with simple Node backend.`,
    expense: `i want to make a website for tracking expenses.
Add expenses with amount and category like food, travel, shopping.
Dashboard showing total spending and category breakdown chart.
Monthly spending view with month selection.
Income entry with remaining balance calculation.
Users must login so each user has their own private expenses.`,
  };

  // DOM Elements
  const promptInput = document.getElementById("prompt-input");
  const btnAnalyze = document.getElementById("btn-analyze");
  const btnClear = document.getElementById("btn-clear");
  const flagsList = document.getElementById("flags-list");
  const flagCount = document.getElementById("flag-count");
  const ambiguityScoreBadge = document.getElementById("ambiguity-score-badge");
  const itemsStream = document.getElementById("items-stream");
  const specTitle = document.getElementById("spec-title");
  const outputModeSelect = document.getElementById("output-mode-select");
  const toast = document.getElementById("toast");

  // Counters
  const countUser = document.getElementById("count-user");
  const countInferred = document.getElementById("count-inferred");
  const countRecommended = document.getElementById("count-recommended");
  const countQuestions = document.getElementById("count-questions");

  // Dimensions
  const overallValidBadge = document.getElementById("overall-valid-badge");
  const statusPreservation = document.getElementById("status-preservation");
  const statusInterpretation = document.getElementById("status-interpretation");
  const statusSafety = document.getElementById("status-safety");
  const statusCompleteness = document.getElementById("status-completeness");
  const detailPreservation = document.getElementById("detail-preservation");
  const detailInterpretation = document.getElementById("detail-interpretation");
  const detailSafety = document.getElementById("detail-safety");
  const detailCompleteness = document.getElementById("detail-completeness");

  // Queue & Ledger
  const questionsList = document.getElementById("questions-list");
  const queueCount = document.getElementById("queue-count");
  const coveragePercent = document.getElementById("coverage-percent");
  const coverageFill = document.getElementById("coverage-fill");
  const statImplemented = document.getElementById("stat-implemented");
  const statUnverified = document.getElementById("stat-unverified");
  const statContradicted = document.getElementById("stat-contradicted");
  const ledgerEntries = document.getElementById("ledger-entries");

  // Helper: show toast message
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 2200);
  }

  // Helper: copy to clipboard
  async function copyText(text, label) {
    if (!text) {
      showToast("No content to copy");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast(`✓ Copied ${label} to clipboard`);
    } catch (err) {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast(`✓ Copied ${label}`);
    }
  }

  // Load sample prompt
  document.querySelectorAll(".pill-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.sample;
      if (SAMPLES[key]) {
        promptInput.value = SAMPLES[key];
        runExtraction();
      }
    });
  });

  // Clear button
  btnClear.addEventListener("click", () => {
    promptInput.value = "";
    promptInput.focus();
  });

  // Analyze button
  btnAnalyze.addEventListener("click", runExtraction);

  // Keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    // Focus prompt on '/' when not in input
    if (e.key === "/" && document.activeElement !== promptInput) {
      e.preventDefault();
      promptInput.focus();
      return;
    }

    // Run on Ctrl+Enter
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      runExtraction();
      return;
    }

    // Card navigation: j / k / Down / Up
    if (document.activeElement !== promptInput && currentCards.length > 0) {
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        selectCard(selectedCardIndex + 1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        selectCard(selectedCardIndex - 1);
      } else if (e.key === "a" && selectedCardIndex >= 0) {
        e.preventDefault();
        handleCardAction(selectedCardIndex, "accept");
      } else if (e.key === "r" && selectedCardIndex >= 0) {
        e.preventDefault();
        handleCardAction(selectedCardIndex, "reject");
      } else if (e.key === "d" && selectedCardIndex >= 0) {
        e.preventDefault();
        handleCardAction(selectedCardIndex, "defer");
      } else if (e.key === "e" && selectedCardIndex >= 0) {
        e.preventDefault();
        handleCardAction(selectedCardIndex, "edit");
      }
    }
  });

  // Filter tabs
  document.querySelectorAll(".filter-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".filter-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      activeFilter = tab.dataset.filter;
      renderItemsStream();
    });
  });

  // Output mode selector
  outputModeSelect.addEventListener("change", async () => {
    if (!currentSpec) return;
    const mode = outputModeSelect.value;
    try {
      const res = await fetch(`/api/spec/${currentSpec.id}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (data.ok) {
        if (!currentExports) currentExports = {};
        currentExports[mode] = data.content;
        showToast(`Mode switched to ${mode.toUpperCase()}`);
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Export buttons
  document.getElementById("btn-copy-agent").addEventListener("click", () => {
    const text = currentExports?.agentPrompt || currentExports?.markdown || "";
    copyText(text, "Agent-Ready Prompt");
  });

  document.getElementById("btn-copy-md").addEventListener("click", () => {
    const mode = outputModeSelect.value;
    const text = currentExports?.[mode] || currentExports?.markdown || "";
    copyText(text, `${mode.toUpperCase()} Specification`);
  });

  document.getElementById("btn-export-json").addEventListener("click", () => {
    if (!currentSpec) return;
    const jsonStr = currentExports?.json || JSON.stringify(currentSpec, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spec-${currentSpec.id || "export"}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Downloaded spec JSON");
  });

  // Run Spec Extraction
  async function runExtraction() {
    const prompt = promptInput.value.trim();
    if (!prompt) {
      promptInput.focus();
      return;
    }

    btnAnalyze.innerHTML = `<span class="btn-spinner"></span> <span>Analyzing Spec...</span>`;
    btnAnalyze.disabled = true;

    try {
      // 1. Run live ambiguity detection
      const detectRes = await fetch("/api/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const detectData = await detectRes.json();
      renderAmbiguityFlags(detectData);

      // 2. Run spec extraction & validation
      const mode = outputModeSelect.value;
      const specRes = await fetch("/api/spec/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, mode }),
      });
      const specData = await specRes.json();

      if (specData.ok) {
        currentSpec = specData.spec;
        currentValidation = specData.validation;
        currentExports = specData.exports;

        renderSpecMeta();
        renderItemsStream();
        renderValidation(currentValidation);
        renderClarifications();
        renderQuotaScorecard(specData.quota);
        await refreshLedger();

        showToast("✓ Specification generated & validated");
      } else {
        showToast(`Error: ${specData.error}`);
      }
    } catch (err) {
      console.error(err);
      showToast(`Network error: ${err.message}`);
    } finally {
      btnAnalyze.innerHTML = `<svg class="btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> <span>Extract & Verify Spec</span>`;
      btnAnalyze.disabled = false;
    }
  }

  // Render Quota Intelligence & 5-Axis Scorecard
  function renderQuotaScorecard(quota) {
    if (!quota) return;

    const opt = quota.optimizedScore || {};
    const delta = quota.delta || {};
    const summary = quota.summary || {};

    const elDelta = document.getElementById("quota-value-delta");
    const elTier = document.getElementById("quota-tier-tag");
    const elTokens = document.getElementById("quota-token-count");
    const elTurns = document.getElementById("quota-turns-count");
    const elRisk = document.getElementById("quota-loop-risk");

    if (elDelta) elDelta.textContent = `+${summary.valueDelta || 0} Δ`;
    if (elTier) elTier.textContent = summary.targetTierSizing || "Free-Tier Sizing";
    if (elTokens) elTokens.textContent = `${summary.promptTokens || 0}`;
    if (elTurns) elTurns.textContent = `${typeof summary.estimatedTurns === "number" ? summary.estimatedTurns.toFixed(1) : summary.estimatedTurns || "1.0"}`;
    if (elRisk) {
      elRisk.textContent = summary.loopRisk || "SAFE";
      elRisk.className = summary.loopRisk === "SAFE" ? "kpi-badge badge-pass" : summary.loopRisk === "MODERATE" ? "kpi-badge badge-warn" : "kpi-badge badge-fail";
    }

    // 5-Axis bars
    const updateBar = (barId, valId, val) => {
      const b = document.getElementById(barId);
      const v = document.getElementById(valId);
      if (b) b.style.width = `${Math.min(100, Math.max(0, val || 0))}%`;
      if (v) v.textContent = `${val || 0}`;
    };

    updateBar("axis-clarity", "val-clarity", opt.clarity);
    updateBar("axis-completeness", "val-completeness", opt.completeness);
    updateBar("axis-efficiency", "val-efficiency", opt.efficiency);
    updateBar("axis-scope", "val-scope", opt.scopeControl);
    updateBar("axis-verifiability", "val-verifiability", opt.verifiability);
  }

  function formatProvenance(prov) {
    if (prov === "user-stated") return "User Stated";
    if (prov === "inferred") return "Inferred";
    if (prov === "system-recommended") return "Recommended";
    if (prov === "model-guess") return "Model Guess";
    return prov || "Inferred";
  }

  // Render Ambiguity Flags
  function renderAmbiguityFlags(data) {
    const flags = data.flags || [];
    flagCount.textContent = flags.length;
    ambiguityScoreBadge.textContent = `Score: ${data.ambiguity_score || 0}`;

    if (flags.length === 0) {
      flagsList.innerHTML = `<div class="empty-state"><span class="empty-icon-subtle">✨</span><span>Zero ambiguities detected! Explicit requirements verified.</span></div>`;
      return;
    }

    flagsList.innerHTML = flags
      .map(
        (f) => `
      <div class="flag-item sev-${f.severity}">
        <div class="flag-header">
          <span class="flag-title">${f.id} • ${f.category}</span>
          <span class="badge ${f.severity === 3 ? "badge-fail" : f.severity === 2 ? "badge-warn" : "badge-info"}">SEV-${f.severity}</span>
        </div>
        <div class="flag-desc">${f.resolution}</div>
      </div>
    `
      )
      .join("");
  }

  // Render Spec Header & Counters
  function renderSpecMeta() {
    if (!currentSpec) return;
    specTitle.textContent = currentSpec.title || "Project Specification";

    const items = currentSpec.items || [];
    const userCount = items.filter((i) => i.provenance === "user-stated").length;
    const inferredCount = items.filter((i) => i.provenance === "inferred").length;
    const recCount = items.filter((i) => i.provenance === "system-recommended").length;
    const questionCount = items.filter((i) => i.category === "open-question").length;

    countUser.textContent = `${userCount} User-Stated`;
    countInferred.textContent = `${inferredCount} Inferred`;
    countRecommended.textContent = `${recCount} Recommended`;
    countQuestions.textContent = `${questionCount} Questions`;
  }

  // Helper: provenance accent border
  function getProvBorderClass(prov) {
    if (prov === "user-stated") return "prov-user-border";
    if (prov === "inferred") return "prov-inferred-border";
    if (prov === "system-recommended") return "prov-rec-border";
    return "";
  }

  // Render Items Stream
  function renderItemsStream() {
    if (!currentSpec || !currentSpec.items) {
      itemsStream.innerHTML = `<div class="empty-canvas"><div class="empty-icon-geom">📐</div><h3>No Specification Active</h3><p>Enter requirements to generate spec.</p></div>`;
      return;
    }

    // Never duplicate open questions into the requirements stream
    let items = currentSpec.items.filter((i) => i.category !== "goal" && i.category !== "open-question");

    // Filter by active tab
    if (activeFilter === "user-stated") {
      items = items.filter((i) => i.provenance === "user-stated");
    } else if (activeFilter === "inferred") {
      items = items.filter((i) => i.provenance === "inferred" || i.provenance === "system-recommended");
    } else if (activeFilter === "constraint") {
      items = items.filter((i) => i.category === "constraint" || i.category === "non-negotiable");
    } else if (activeFilter === "workflow") {
      items = items.filter((i) => i.category === "workflow");
    } else if (activeFilter === "data-entity") {
      items = items.filter((i) => i.category === "data-entity");
    }

    currentCards = items;
    selectedCardIndex = -1;

    if (items.length === 0) {
      itemsStream.innerHTML = `<div class="empty-state-mini"><span>No items match filter "${activeFilter}".</span></div>`;
      return;
    }

    itemsStream.innerHTML = items
      .map(
        (item, idx) => `
      <div class="spec-card ${getProvBorderClass(item.provenance)} status-${item.status || "proposed"}" id="card-${idx}" data-index="${idx}" data-id="${item.id}">
        <div class="card-top">
          <div class="card-badges">
            <span class="prov-tag ${item.provenance}">${formatProvenance(item.provenance)}</span>
            <span class="priority-tag">${item.priority?.toUpperCase()}</span>
            <span class="card-source">${item.category}</span>
          </div>
          <span class="badge ${item.status === "accepted" ? "badge-pass" : item.status === "rejected" ? "badge-fail" : item.status === "deferred" ? "badge-warn" : "badge-neutral"}">${item.status?.toUpperCase() || "PROPOSED"}</span>
        </div>
        <div class="card-content">${item.text}</div>
        <div class="card-actions-row">
          <div class="card-status-indicator">
            <span class="spec-nav-tip">Decision:</span>
          </div>
          <div class="card-actions">
            <button class="card-btn act-accept" title="Accept requirement (a)" onclick="LemonadeUI.action(${idx}, 'accept')">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Accept</span>
              <kbd>a</kbd>
            </button>
            <button class="card-btn act-reject" title="Reject requirement (r)" onclick="LemonadeUI.action(${idx}, 'reject')">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              <span>Reject</span>
              <kbd>r</kbd>
            </button>
            <button class="card-btn act-edit" title="Edit requirement (e)" onclick="LemonadeUI.action(${idx}, 'edit')">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              <span>Edit</span>
              <kbd>e</kbd>
            </button>
            <button class="card-btn act-defer" title="Defer requirement (d)" onclick="LemonadeUI.action(${idx}, 'defer')">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <span>Defer</span>
              <kbd>d</kbd>
            </button>
          </div>
        </div>
      </div>
    `
      )
      .join("");
  }

  // Select card
  function selectCard(idx) {
    if (currentCards.length === 0) return;
    if (idx < 0) idx = 0;
    if (idx >= currentCards.length) idx = currentCards.length - 1;

    document.querySelectorAll(".spec-card").forEach((c) => c.classList.remove("focused"));
    selectedCardIndex = idx;
    const cardEl = document.getElementById(`card-${idx}`);
    if (cardEl) {
      cardEl.classList.add("focused");
      cardEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  // Handle Card Action
  async function handleCardAction(idx, action) {
    const item = currentCards[idx];
    if (!item || !currentSpec) return;

    let payload = { action };
    if (action === "edit") {
      const newText = prompt("Edit requirement text:", item.text);
      if (!newText || newText.trim() === item.text) return;
      payload.text = newText.trim();
    }

    try {
      const res = await fetch(`/api/spec/${currentSpec.id}/item/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) {
        currentSpec = data.spec;
        renderSpecMeta();
        renderItemsStream();
        selectCard(idx);
        showToast(`Item marked ${action.toUpperCase()}`);
      }
    } catch (err) {
      console.error(err);
    }
  }

  // Render 4-Dimension Validation
  function renderValidation(val) {
    if (!val) {
      overallValidBadge.className = "badge badge-pending";
      overallValidBadge.textContent = "PENDING";
      return;
    }

    overallValidBadge.className = val.valid ? "badge badge-pass" : "badge badge-warn";
    overallValidBadge.textContent = val.valid ? "PASSED (4D)" : "REVIEW ADVISORY";

    // Dim A: Preservation
    const pres = val.preservation || {};
    statusPreservation.className = pres.passed ? "dim-status badge badge-pass" : "dim-status badge badge-fail";
    statusPreservation.textContent = pres.passed ? "PASS" : "FAIL";
    detailPreservation.innerHTML = pres.failures?.length
      ? pres.failures.map((f) => `<div class="dim-item-fail">• ${f.detail}</div>`).join("")
      : "✓ Verbatim user words preserved";

    // Dim B: Interpretation
    const interp = val.interpretation || {};
    statusInterpretation.className = interp.passed ? "dim-status badge badge-pass" : "dim-status badge badge-fail";
    statusInterpretation.textContent = interp.passed ? "PASS" : "FAIL";
    detailInterpretation.innerHTML = interp.warnings?.length
      ? interp.warnings.map((w) => `<div class="dim-item-warn">• ${w.detail}</div>`).join("")
      : "✓ Semantic mapping verified";

    // Dim C: Safety
    const safe = val.safety || {};
    statusSafety.className = safe.passed ? "dim-status badge badge-pass" : "dim-status badge badge-fail";
    statusSafety.textContent = safe.passed ? "PASS" : "FAIL";
    detailSafety.innerHTML = safe.warnings?.length
      ? safe.warnings.map((w) => `<div class="dim-item-warn">• ${w.detail}</div>`).join("")
      : "✓ Zero undeclared risks";

    // Dim D: Completeness
    const comp = val.completeness || {};
    statusCompleteness.className = comp.passed ? "dim-status badge badge-pass" : "dim-status badge badge-fail";
    statusCompleteness.textContent = comp.passed ? "PASS" : "FAIL";
    detailCompleteness.innerHTML = comp.warnings?.length
      ? comp.warnings.map((w) => `<div class="dim-item-warn">• ${w.detail}</div>`).join("")
      : "✓ Decisions explicitly tracked";
  }

  // Render Clarification Queue
  function renderClarifications() {
    if (!currentSpec) return;
    const questions = (currentSpec.items || []).filter(
      (i) => i.category === "open-question" && i.status !== "accepted"
    );

    queueCount.textContent = questions.length;

    if (questions.length === 0) {
      questionsList.innerHTML = `<div class="empty-state"><span class="empty-icon-subtle">✓</span><span>No open clarification questions needed.</span></div>`;
      return;
    }

    questionsList.innerHTML = questions
      .map(
        (q) => `
      <div class="question-card" data-qid="${q.id}">
        <div class="q-text">${q.text}</div>
        <div class="q-input-row">
          <input type="text" class="q-input" id="ans-${q.id}" placeholder="Type resolution (Enter to save)..." onkeydown="if(event.key==='Enter') LemonadeUI.answer('${q.id}')">
          <button class="q-resolve-btn" title="Resolve question" onclick="LemonadeUI.answer('${q.id}')">
            Resolve ⏎
          </button>
        </div>
      </div>
    `
      )
      .join("");
  }

  // Answer Clarification Question
  async function answerQuestion(qid) {
    const input = document.getElementById(`ans-${qid}`);
    if (!input || !input.value.trim() || !currentSpec) return;
    const answer = input.value.trim();

    try {
      const res = await fetch(`/api/spec/${currentSpec.id}/question/${qid}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      });
      const data = await res.json();
      if (data.ok) {
        currentSpec = data.spec;
        renderSpecMeta();
        renderItemsStream();
        renderClarifications();
        showToast("✓ Question answered and resolved into spec");
      }
    } catch (err) {
      console.error(err);
    }
  }

  // Refresh Ledger
  async function refreshLedger() {
    try {
      const res = await fetch("/api/ledger");
      const data = await res.json();
      if (!data.ok) return;

      const rep = data.report || {};
      const stats = rep.stats || {};

      coveragePercent.textContent = `Coverage: ${rep.coveragePercent || 0}%`;
      coverageFill.style.width = `${rep.coveragePercent || 0}%`;

      statImplemented.textContent = `${stats.implemented || 0} implemented`;
      statUnverified.textContent = `${stats.unverified || 0} unverified`;
      statContradicted.textContent = `${stats.contradicted || 0} contradicted`;

      const entries = rep.details || [];
      ledgerEntries.innerHTML = entries
        .slice(0, 10)
        .map(
          (e) => `
        <div class="ledger-row">
          <span>${e.phrase}</span>
          <span class="badge ${e.status === "implemented" ? "badge-pass" : e.status === "contradicted" ? "badge-fail" : "badge-neutral"}">${e.status}</span>
        </div>
      `
        )
        .join("");
    } catch (err) {
      console.error("Ledger error:", err);
    }
  }

  // Expose global methods for inline HTML event handlers
  window.LemonadeUI = {
    action: handleCardAction,
    answer: answerQuestion,
  };

  // Initial prompt analysis on startup
  promptInput.value = SAMPLES.saas;
  runExtraction();
})();
