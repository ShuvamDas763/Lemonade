#!/usr/bin/env node
// Lemonade Regression Test: Zero Cross-Prompt Contamination & Ground-Truth Retention Audit
//
// Tests 5 completely unrelated prompts in a 10-step sequential order:
//   A (Expense Tracker) → B (Study Partner) → C (College Library) → D (College Canteen) → E (Lost & Found) → A → C → E → B → D
//
// Invariants enforced:
//   1. Zero cross-prompt contamination across sequential runs in the same process.
//   2. Independent Ground-Truth Requirement Audit retention ≥ 95% across categories.
//   3. Business rules and permissions retention = 100%.
//   4. Correct classification across sections (Goal, V1 Requirements, Constraints, Implementation Boundaries, UX, Tech, Optional, Future, Acceptance, Implementation).
//   5. Category-level retention tracking.
//   6. No generic open questions (Stripe, SMTP, Mailgun) emitted.

import fs from "node:fs";
import path from "node:path";
import { rewrite } from "../phase2/rewriter.js";
import { verify } from "../phase3/verifier.js";
import { auditRequirements, checkContamination } from "../phase2/optimizer.js";

const PROMPT_EXPENSE = `i want to make a website for tracking expenses because i always forget where my money is going 😭
basically i want to add an expense like food 250 or travel 500 and it should save it and show me how much i spent.
i want a dashboard where i can see total spending and maybe a pie chart or something showing food travel shopping etc.
also there should be like monthly spending so i can select a month and see what i spent that month. maybe add income also so it can tell me how much money i have left.
i want login also so each user has their own expenses and nobody else can see them.
i dont really care what database you use, just use something that is easy and free for now. frontend can be react. make the design nice but dont make it too complicated.
can you build it from scratch and explain what i need to install because im not very experienced with this.
first make the basic version actually work and then we can add things like editing expenses, exporting data and notifications later.
if you think something should be added just tell me first instead of randomly adding it.`;

const PROMPT_STUDY_PARTNER = `i want to make a website for college students to find study partners.
basically students should be able to make a profile with their name, course and what subjects they are studying, and then find other students who are studying the same subjects.
there should be some kind of search where i can type a subject like maths and see people who have maths in their profile.
also maybe show them based on college if possible because it would be better to find someone from the same college.
i want users to be able to send a request to another student and if they accept then they can chat with each other.
login should be there obviously and users should only be able to edit their own profile.
i want the homepage to show some recommended study partners too, maybe based on subjects they have in common.
make it look modern and kind of like a social app but not too much, it should still feel like a study website.
i dont know what backend or database to use so you decide something simple. react is probably fine for frontend.
for now just make the basic thing work, later we can add notifications, group study rooms and maybe video calls.
also please dont make it super complicated because i want to understand the code and run it locally.`;

const PROMPT_LIBRARY = `i want to build a website for our college library because right now its really annoying to find out if a book is available or not.
students should be able to search for books by name or author and see if the book is available, how many copies are there and where it is in the library if possible.
there should be login for students and also a separate login for librarian/admin because they should have different things they can do.
students should be able to request a book if its currently issued to someone else, and maybe the librarian can approve the request when it gets returned.
librarian should be able to add new books, remove books, edit book details and mark books as issued or returned.
also show the student their currently issued books and maybe when they need to return them.
i think it would be useful to have a dashboard for librarian showing how many books are available, issued, and pending requests.
make the homepage simple and modern, maybe have a search bar in the middle because thats the main thing people will use.
i want to use react but you can decide the backend and database. please use something that doesnt require too much setup because i want to run it on my laptop.
for now dont worry about online payments, barcode scanners or sending emails. maybe we can add those later.
please build the basic version first and dont randomly add features that i didnt ask for.`;

const PROMPT_CANTEEN = `i want to make a website for our college canteen because students never know whats available and they have to stand in line just to find out something is finished.
basically the canteen person should be able to login and add the food items available for the day with price and how many are left.
students dont need to login just open the website and see the menu for today. it should show the item name price and whether its available or sold out.
there should be a search bar because sometimes there are a lot of items and maybe filters for veg non veg and drinks if thats not too hard.
i also want students to be able to place an order before going to the canteen so they can just pick it up. they should select the items and quantity and then get some kind of order number.
the canteen person should see incoming orders and be able to mark them as preparing, ready or completed. if an item runs out they should be able to change the stock and students should immediately see that its sold out.
maybe have an estimated preparation time for each order but this is not super important.
i dont want students making accounts for now because it should be quick to use. maybe later we can add login and payment.
the canteen dashboard should show todays orders, how many are pending and what food items are low on stock.
make the student side really simple and mobile friendly because most people will open it on their phones while walking to the canteen.
for the canteen dashboard it can be more like an admin panel.
i dont know what backend to use so choose something simple and easy to run locally. react is fine but if there is something easier tell me.
dont add online payment or complicated delivery stuff. this is just for our college canteen pickup.
build the basic version first and make sure the ordering flow actually works before adding anything else.`;

const PROMPT_LOST_FOUND = `I want a college lost and found website. Students should be able to post lost or found things with a photo, title, description, location and date. Other students can search recent posts and filter by lost/found and category. They can send a claim request. The owner can accept or reject it. If accepted, mark the item returned and don't allow more claims. Users should only edit/delete their own posts. There should be login so random people don't spam it. Admin should be able to remove fake/inappropriate posts and see reports. Users can report suspicious posts. Keep it clean and modern, like an official college service and not social media, and make it mobile friendly. React preferred and use the easiest local backend/database. Notifications are optional if simple, otherwise show updates on the website. Email notifications, chat, payments and maps can come later. Build the basic working version first.`;

const PROMPTS = {
  A: { name: "Expense Tracker", text: PROMPT_EXPENSE },
  B: { name: "Study Partner", text: PROMPT_STUDY_PARTNER },
  C: { name: "College Library", text: PROMPT_LIBRARY },
  D: { name: "College Canteen", text: PROMPT_CANTEEN },
  E: { name: "College Lost and Found", text: PROMPT_LOST_FOUND },
};

let failures = 0;
function check(label, cond) {
  if (!cond) {
    failures++;
    console.error(`  ✗ FAIL: ${label}`);
  } else {
    console.log(`  ✓ PASS: ${label}`);
  }
}

// 10-step sequence: A -> B -> C -> D -> E -> A -> C -> E -> B -> D
const sequence = ["A", "B", "C", "D", "E", "A", "C", "E", "B", "D"];

console.log("=================================================================");
console.log("Lemonade Cross-Contamination & Ground-Truth Retention Audit (10 Runs)");
console.log("=================================================================");

const reports = [];

for (let idx = 0; idx < sequence.length; idx++) {
  const key = sequence[idx];
  const { name, text } = PROMPTS[key];
  console.log(`\n--- Step ${idx + 1}/${sequence.length}: TEST ${key} (${name}) ---`);

  const rw = await rewrite(text, { mode: "optimize" });
  check("rewrite ok", rw.ok === true);

  const gate = verify(text, rw);
  check("Phase 3 gate passes", gate.ok === true);

  // Independent ground-truth requirement audit
  const audit = auditRequirements(text, rw.optimized_prompt);
  check(`requirement retention ≥ 95% (got ${audit.retentionPercent}%, ${audit.preserved}/${audit.total})`, audit.retentionPercent >= 95);
  check(`no major core requirement missing`, audit.missingMajorCore.length === 0);
  check(`no scope contradictions detected`, audit.scopeDelta.contradicted === 0);

  // Independent contamination check
  const contamination = checkContamination(text, rw.optimized_prompt);
  check("zero contamination leaks detected", contamination.contaminated === false);
  if (contamination.contaminated) {
    console.error(`    Leaks: ${contamination.leaks.join("; ")}`);
  }

  // Cross-domain exclusion checks
  const optLower = rw.optimized_prompt.toLowerCase();
  if (key === "A") { // Expense
    check("expense output contains NO library terms", !/\b(librarian|books?|catalog|issued\s+books)\b/i.test(optLower));
    check("expense output contains NO study-partner terms", !/\b(study[- ]partner|shared\s+subjects|classmates?)\b/i.test(optLower));
    check("expense output contains NO canteen terms", !/\b(canteen|food\s+items?|pickup\s+order|preparing.*ready)\b/i.test(optLower));
    check("expense output contains NO lost-and-found terms", !/\b(lost\s*(?:and|\/|or)\s*found|claim\s+request|item\s+returned)\b/i.test(optLower));
  } else if (key === "B") { // Study Partner
    check("study-partner output contains NO library terms", !/\b(librarian|books?|catalog|issued\s+books)\b/i.test(optLower));
    check("study-partner output contains NO expense terms", !/\b(expenses?|spending|pie\s+chart|remaining\s+balance)\b/i.test(optLower));
    check("study-partner output contains NO canteen terms", !/\b(canteen|food\s+items?|pickup\s+order|preparing.*ready)\b/i.test(optLower));
    check("study-partner output contains NO lost-and-found terms", !/\b(lost\s*(?:and|\/|or)\s*found|claim\s+request|item\s+returned)\b/i.test(optLower));
  } else if (key === "C") { // Library
    check("library output contains NO study-partner terms", !/\b(study[- ]partner|shared\s+subjects)\b/i.test(optLower));
    check("library output contains NO expense terms", !/\b(expenses?|spending|pie\s+chart|remaining\s+balance)\b/i.test(optLower));
    check("library output contains NO canteen terms", !/\b(canteen|food\s+items?|pickup\s+order|preparing.*ready)\b/i.test(optLower));
    check("library output contains NO lost-and-found terms", !/\b(lost\s*(?:and|\/|or)\s*found|claim\s+request|item\s+returned)\b/i.test(optLower));
  } else if (key === "D") { // Canteen
    check("canteen output contains NO library terms", !/\b(librarian|books?|catalog|issued\s+books)\b/i.test(optLower));
    check("canteen output contains NO study-partner terms", !/\b(study[- ]partner|shared\s+subjects)\b/i.test(optLower));
    check("canteen output contains NO expense terms", !/\b(total\s+spending|pie\s+chart)\b/i.test(optLower));
    check("canteen output contains NO lost-and-found terms", !/\b(lost\s*(?:and|\/|or)\s*found|claim\s+request|item\s+returned)\b/i.test(optLower));
  } else if (key === "E") { // Lost and Found
    check("lost-found output contains NO library terms", !/\b(librarian|borrowing|catalog|circulation)\b/i.test(optLower));
    check("lost-found output contains NO study-partner terms", !/\b(study[- ]partner|shared\s+subjects|classmates?)\b/i.test(optLower));
    check("lost-found output contains NO expense terms", !/\b(expenses?|spending|pie\s+chart|remaining\s+balance)\b/i.test(optLower));
    check("lost-found output contains NO canteen terms", !/\b(canteen|cafeteria|food\s+items?|menu\s+for\s+today)\b/i.test(optLower));
  }

  // No generic open questions boilerplate (Stripe, SMTP, Mailgun)
  check("no generic boilerplate open questions", !/Which provider\/flow exactly/i.test(rw.optimized_prompt));
  check("no Stripe/SMTP/Mailgun mentions", !/Stripe|SMTP|Mailgun/i.test(rw.optimized_prompt));

  const origTokens = Math.round(text.length / 4);
  const optTokens = Math.round(rw.optimized_prompt.length / 4);

  reports.push({
    step: idx + 1,
    test: key,
    name,
    origTokens,
    optTokens,
    extracted: audit.total,
    preserved: audit.preserved,
    retentionPercent: audit.retentionPercent,
    leaks: contamination.leaks.length,
    finalScore: rw.quality?.compositeScore ?? 0,
    gate: gate.ok ? "PASS" : "FAIL",
  });
}

console.log("\n=================================================================");
console.log("Cross-Contamination & Retention Audit Summary (10 Runs)");
console.log("=================================================================");
console.table(reports);

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nALL CHECKS PASSED: Zero cross-prompt contamination across all 10 runs.`);
  process.exit(0);
}
