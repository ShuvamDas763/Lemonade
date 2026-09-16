// Lemonade — Progressive Intent Compiler & Decision Studio (Vanilla JS)
// Zero external dependencies • Local-first • Fully sanitized DOM

(function () {
  "use strict";

  // Application State
  let currentStep = 1;
  let currentSpec = null;
  let currentValidation = null;
  let currentQuota = null;
  let currentExports = null;
  let currentTarget = "coding-agent";
  let activeFilter = "all";
  let activeView = "compiled";

  // Sample prompt corpus
  const SAMPLES = {
    saas: `Build a multi-tenant B2B customer feedback portal.
Tenants can create surveys with custom rating scales and text questions.
Customers can submit responses via public share link without creating an account.
Managers must login with company SSO and can view aggregate analytics and sentiment scores.
Data must be strictly isolated between tenants in the database.
Exporting responses to CSV and email notifications can come in v2.
Keep v1 simple and runnable locally using React and Node/Express with SQLite.`,
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
    library: `i want to build a website for our college library.
Students should be able to search for books by name or author and see availability and shelf location.
There should be login for students and separate login for librarian/admin.
Students can request a book if currently issued to someone else; librarian approves request upon return.
Librarian can add, remove, and edit book catalog details and mark books issued or returned.
Show students their currently issued books and due dates.`,
  };

  // DOM References
  const tabStep1 = document.getElementById("tab-step-1");
  const tabStep2 = document.getElementById("tab-step-2");
  const tabStep3 = document.getElementById("tab-step-3");
  const panelStep1 = document.getElementById("panel-step-1");
  const panelStep2 = document.getElementById("panel-step-2");
  const panelStep3 = document.getElementById("panel-step-3");
  const decisionsBadge = document.getElementById("decisions-badge");

  const promptInput = document.getElementById("prompt-input");
  const charCount = document.getElementById("char-count");
  const targetFormatSelect = document.getElementById("target-format-select");
  const btnOptimize = document.getElementById("btn-optimize");
  const btnClear = document.getElementById("btn-clear");

  const btnProceedToCompile = document.getElementById("btn-proceed-to-compile");
  const btnBackToCapture = document.getElementById("btn-back-to-capture");
  const btnBackToDecide = document.getElementById("btn-back-to-decide");
  const btnCopyOutput = document.getElementById("btn-copy-output");
  const btnExportMarkdown = document.getElementById("btn-export-markdown");
  const btnExportJsonFile = document.getElementById("btn-export-json-file");

  const decisionsStream = document.getElementById("decisions-stream");
  const questionsSection = document.getElementById("questions-section");
  const questionsList = document.getElementById("questions-list");

  const countUser = document.getElementById("count-user");
  const countInferred = document.getElementById("count-inferred");
  const countRecommended = document.getElementById("count-recommended");
  const countQuestions = document.getElementById("count-questions");

  const compiledDisplay = document.getElementById("compiled-display");
  const diffDisplay = document.getElementById("diff-display");

  const auditDrawer = document.getElementById("audit-drawer");
  const btnToggleAudit = document.getElementById("btn-toggle-audit");
  const btnCloseDrawer = document.getElementById("btn-close-drawer");
  const toast = document.getElementById("toast");

  // ---------------------------------------------------------------------------
  // Security: Strict HTML Escaping
  // ---------------------------------------------------------------------------
  function escapeHtml(unsafe) {
    if (unsafe == null) return "";
    return String(unsafe)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 2400);
  }

  // ---------------------------------------------------------------------------
  // Step Navigation
  // ---------------------------------------------------------------------------
  function setStep(step) {
    currentStep = step;
    [panelStep1, panelStep2, panelStep3].forEach((p, idx) => {
      p.style.display = (idx + 1 === step) ? "flex" : "none";
    });
    [tabStep1, tabStep2, tabStep3].forEach((t, idx) => {
      t.classList.toggle("active", idx + 1 === step);
    });

    if (step === 3 && currentSpec) {
      renderCompiledOutput();
    }
  }

  tabStep1.addEventListener("click", () => setStep(1));
  tabStep2.addEventListener("click", () => {
    if (currentSpec) setStep(2);
    else showToast("Compile a prompt first to review decisions");
  });
  tabStep3.addEventListener("click", () => {
    if (currentSpec) setStep(3);
    else showToast("Compile a prompt first to view output");
  });

  btnBackToCapture.addEventListener("click", () => setStep(1));
  btnProceedToCompile.addEventListener("click", () => setStep(3));
  btnBackToDecide.addEventListener("click", () => setStep(2));

  // ---------------------------------------------------------------------------
  // Input Handling
  // ---------------------------------------------------------------------------
  promptInput.addEventListener("input", () => {
    const len = promptInput.value.length;
    charCount.textContent = `${len} chars`;
  });

  btnClear.addEventListener("click", () => {
    promptInput.value = "";
    charCount.textContent = "0 chars";
    promptInput.focus();
  });

  // Sample prompt selection (populates editor without auto-running)
  document.querySelectorAll(".chip-btn").forEach((chip) => {
    chip.addEventListener("click", () => {
      const key = chip.dataset.sample;
      if (SAMPLES[key]) {
        promptInput.value = SAMPLES[key];
        charCount.textContent = `${promptInput.value.length} chars`;
        promptInput.focus();
        showToast(`Loaded ${chip.textContent} sample`);
      }
    });
  });

  targetFormatSelect.addEventListener("change", (e) => {
    currentTarget = e.target.value;
    if (currentSpec) {
      renderCompiledOutput();
    }
  });

  // ---------------------------------------------------------------------------
  // Compile & Extraction Action
  // ---------------------------------------------------------------------------
  btnOptimize.addEventListener("click", executeExtraction);

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      executeExtraction();
    } else if (e.altKey && e.key.toLowerCase() === "a") {
      e.preventDefault();
      toggleAuditDrawer();
    }
  });

  async function executeExtraction() {
    const prompt = promptInput.value.trim();
    if (!prompt) {
      showToast("Please enter a prompt to compile");
      promptInput.focus();
      return;
    }

    btnOptimize.disabled = true;
    btnOptimize.querySelector("span").textContent = "Compiling...";

    try {
      const res = await fetch("/api/spec/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          mode: currentTarget,
        }),
      });

      const data = await res.json();
      if (!data.ok) {
        showToast(data.error || "Compilation failed");
        return;
      }

      currentSpec = data.spec;
      currentValidation = data.validation;
      currentQuota = data.quota;
      currentExports = data.exports;

      renderDecisions();
      renderAuditData();

      const questionsCount = (currentSpec.items || []).filter((i) => i.category === "open-question" && i.status === "proposed").length;
      const unconfirmedCount = (currentSpec.items || []).filter((i) => i.provenance !== "user-stated" && i.status === "proposed").length;
      const totalDecisions = questionsCount + unconfirmedCount;

      if (totalDecisions > 0) {
        decisionsBadge.textContent = totalDecisions;
        decisionsBadge.style.display = "inline-block";
        setStep(2); // Direct to Decide
        showToast(`Compiled: ${totalDecisions} items ready for review`);
      } else {
        setStep(3); // Directly to Compile
        showToast("Intent compiled and verified successfully");
      }
    } catch (err) {
      showToast(`Error: ${err.message}`);
    } finally {
      btnOptimize.disabled = false;
      btnOptimize.querySelector("span").textContent = "Compile & Verify Intent";
    }
  }

  // ---------------------------------------------------------------------------
  // Render Decisions (Step 2)
  // ---------------------------------------------------------------------------
  function renderDecisions() {
    if (!currentSpec || !currentSpec.items) return;

    const items = currentSpec.items;
    const userCount = items.filter((i) => i.provenance === "user-stated").length;
    const inferredCount = items.filter((i) => i.provenance === "inferred").length;
    const recCount = items.filter((i) => i.provenance === "system-recommended").length;
    const questions = items.filter((i) => i.category === "open-question" && i.status === "proposed");

    countUser.textContent = userCount;
    countInferred.textContent = inferredCount;
    countRecommended.textContent = recCount;
    countQuestions.textContent = questions.length;

    // Filter items for cards stream (excluding open questions)
    let displayItems = items.filter((i) => i.category !== "goal" && i.category !== "open-question");

    if (activeFilter === "inferred") {
      displayItems = displayItems.filter((i) => i.provenance === "inferred" || i.provenance === "system-recommended");
    } else if (activeFilter === "constraint") {
      displayItems = displayItems.filter((i) => i.category === "constraint" || i.category === "non-negotiable");
    } else if (activeFilter === "user-stated") {
      displayItems = displayItems.filter((i) => i.provenance === "user-stated");
    }

    if (displayItems.length === 0) {
      decisionsStream.innerHTML = `<div class="empty-state"><p>No specification items match "${escapeHtml(activeFilter)}".</p></div>`;
    } else {
      decisionsStream.innerHTML = displayItems.map((item) => `
        <div class="decision-card prov-${escapeHtml(item.provenance)}" data-id="${escapeHtml(item.id)}">
          <div class="card-top">
            <div class="card-badges">
              <span class="badge badge-prov ${escapeHtml(item.provenance)}">${escapeHtml(item.provenance.replace("-", " "))}</span>
              <span class="badge badge-cat">${escapeHtml(item.category)}</span>
            </div>
            <span class="badge badge-status">${escapeHtml(item.status?.toUpperCase() || "PROPOSED")}</span>
          </div>
          <div class="card-text">${escapeHtml(item.text)}</div>
          ${item.sourceMessage ? `<div class="card-rationale">Source: "${escapeHtml(item.sourceMessage)}"</div>` : ""}
          <div class="card-footer">
            <span class="card-confidence">Confidence: ${Math.round((item.confidence || 0.5) * 100)}% • Impact: ${escapeHtml(item.implementationImpact || "medium")}</span>
            <div class="card-btn-group">
              <button class="c-btn act-accept" data-action="accept" data-id="${escapeHtml(item.id)}" title="Accept requirement">Accept</button>
              <button class="c-btn act-edit" data-action="edit" data-id="${escapeHtml(item.id)}" title="Edit text">Edit</button>
              <button class="c-btn act-defer" data-action="defer" data-id="${escapeHtml(item.id)}" title="Defer for later">Defer</button>
              <button class="c-btn act-reject" data-action="reject" data-id="${escapeHtml(item.id)}" title="Reject requirement">Reject</button>
            </div>
          </div>
        </div>
      `).join("");
    }

    // Clarification Questions Section
    if (questions.length > 0) {
      questionsSection.style.display = "flex";
      questionsList.innerHTML = questions.map((q) => `
        <div class="question-row" data-qid="${escapeHtml(q.id)}">
          <div class="question-text">${escapeHtml(q.text)}</div>
          <div class="question-input-row">
            <input type="text" class="q-input" placeholder="Enter decision or resolution..." data-qid="${escapeHtml(q.id)}">
            <button class="btn btn-secondary btn-sm btn-answer" data-qid="${escapeHtml(q.id)}">Resolve</button>
          </div>
        </div>
      `).join("");
    } else {
      questionsSection.style.display = "none";
    }
  }

  // Delegated Event Listeners on Decisions Stream (Zero Inline Handlers)
  decisionsStream.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn || !currentSpec) return;

    const action = btn.dataset.action;
    const itemId = btn.dataset.id;

    if (action === "edit") {
      const item = (currentSpec.items || []).find((i) => i.id === itemId);
      const newText = prompt("Edit requirement statement:", item ? item.text : "");
      if (newText && newText.trim()) {
        await updateItemDecision(itemId, "edit", newText.trim());
      }
      return;
    }

    await updateItemDecision(itemId, action);
  });

  async function updateItemDecision(itemId, action, editedText = "") {
    try {
      const res = await fetch(`/api/spec/${currentSpec.id}/item/${itemId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, text: editedText, reason: `User ${action} in UI` }),
      });
      const data = await res.json();
      if (data.ok) {
        currentSpec = data.spec;
        renderDecisions();
        showToast(`Item ${action}ed`);
      }
    } catch (err) {
      showToast(`Failed: ${err.message}`);
    }
  }

  // Delegated Event Listener for Question Resolution
  questionsSection.addEventListener("click", async (e) => {
    const btn = e.target.closest(".btn-answer");
    if (!btn || !currentSpec) return;

    const qid = btn.dataset.qid;
    const input = questionsSection.querySelector(`input[data-qid="${qid}"]`);
    if (!input || !input.value.trim()) return;

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
        renderDecisions();
        showToast("Question resolved into spec");
      }
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  });

  // Filter Buttons
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeFilter = btn.dataset.filter;
      renderDecisions();
    });
  });

  // ---------------------------------------------------------------------------
  // Render Compiled Output (Step 3)
  // ---------------------------------------------------------------------------
  async function renderCompiledOutput() {
    if (!currentSpec) return;

    try {
      const res = await fetch(`/api/spec/${currentSpec.id}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: currentTarget }),
      });
      const data = await res.json();
      if (data.ok) {
        compiledDisplay.querySelector("code").textContent = data.content;
      }
    } catch (err) {
      compiledDisplay.querySelector("code").textContent = "Failed to load compiled output.";
    }

    // Render original vs compiled diff
    renderDiff();
  }

  function renderDiff() {
    const orig = promptInput.value.trim();
    const opt = compiledDisplay.querySelector("code").textContent;

    diffDisplay.innerHTML = `
      <div style="margin-bottom:12px;"><strong style="color:var(--text-muted)">ORIGINAL INPUT (${orig.length} chars)</strong></div>
      <div style="background:var(--bg-surface-elevated);padding:12px;border-radius:4px;margin-bottom:18px;">${escapeHtml(orig)}</div>
      <div style="margin-bottom:12px;"><strong style="color:var(--lemon-400)">COMPILED PROMPT (${opt.length} chars)</strong></div>
      <div style="background:var(--bg-surface-elevated);padding:12px;border-radius:4px;">${escapeHtml(opt)}</div>
    `;
  }

  // View toggles: compiled output vs diff
  document.querySelectorAll(".view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".view-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeView = btn.dataset.view;
      if (activeView === "diff") {
        compiledDisplay.style.display = "none";
        diffDisplay.style.display = "block";
      } else {
        compiledDisplay.style.display = "block";
        diffDisplay.style.display = "none";
      }
    });
  });

  // Copy Output button
  btnCopyOutput.addEventListener("click", async () => {
    const text = compiledDisplay.querySelector("code").textContent;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast("✓ Copied compiled prompt to clipboard");
    } catch {
      showToast("Failed to copy to clipboard");
    }
  });

  btnExportMarkdown.addEventListener("click", () => downloadFile("spec.md", compiledDisplay.querySelector("code").textContent, "text/markdown"));
  btnExportJsonFile.addEventListener("click", () => downloadFile("spec.json", JSON.stringify(currentSpec, null, 2), "application/json"));

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${filename}`);
  }

  // ---------------------------------------------------------------------------
  // Collapsible Audit Drawer
  // ---------------------------------------------------------------------------
  function toggleAuditDrawer() {
    auditDrawer.classList.toggle("collapsed");
  }

  btnToggleAudit.addEventListener("click", toggleAuditDrawer);
  btnCloseDrawer.addEventListener("click", () => auditDrawer.classList.add("collapsed"));

  document.querySelectorAll(".tab-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      document.querySelectorAll(".tab-pill").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      const targetTab = pill.dataset.tab;
      document.querySelectorAll(".drawer-tab-pane").forEach((pane) => {
        pane.style.display = pane.id === `tab-pane-${targetTab}` ? "block" : "none";
      });
    });
  });

  function renderAuditData() {
    if (currentValidation) {
      const v = currentValidation;
      document.getElementById("status-dim-p").textContent = v.preservation.passed ? "PASS" : "FAIL";
      document.getElementById("detail-dim-p").textContent = v.preservation.details || "Words preserved accurately.";
      document.getElementById("status-dim-i").textContent = v.interpretation.passed ? "PASS" : "WARN";
      document.getElementById("detail-dim-i").textContent = v.interpretation.details || "Grounded interpretations.";
      document.getElementById("status-dim-s").textContent = v.safety.passed ? "PASS" : "FAIL";
      document.getElementById("detail-dim-s").textContent = v.safety.details || "Zero ungrounded risk inventions.";
      document.getElementById("status-dim-c").textContent = v.completeness.passed ? "PASS" : "PASS";
      document.getElementById("detail-dim-c").textContent = v.completeness.details || "Acceptance criteria complete.";
    }

    if (currentQuota && currentQuota.optimizedScore) {
      const q = currentQuota.optimizedScore;
      document.getElementById("q-clarity").textContent = `${q.clarity}/100`;
      document.getElementById("q-completeness").textContent = `${q.completeness}/100`;
      document.getElementById("q-efficiency").textContent = `${q.efficiency}/100`;
      document.getElementById("q-scope").textContent = `${q.scopeControl}/100`;
      document.getElementById("q-verifiability").textContent = `${q.verifiability}/100`;
      document.getElementById("q-turns").textContent = `${q.estimatedTurns} turns`;

      document.getElementById("tag-turns").textContent = `${q.estimatedTurns} Est. Turns`;
      document.getElementById("tag-risk").textContent = `Loop Risk: ${q.loopRisk || "SAFE"}`;
    }

    if (currentSpec) {
      document.getElementById("raw-json-display").querySelector("code").textContent = JSON.stringify(currentSpec, null, 2);
    }
  }

  // Empty initial startup (Zero auto-run)
  charCount.textContent = "0 chars";
})();
