const $ = (id) => document.getElementById(id);
const scenarios = {
  retry: {
    description: "The first search asks for approval. Four identical retries are stopped before reaching the simulated provider.",
    requests: Array.from({ length: 5 }, () => ({ query: "fix build", cents: 125 })),
  },
  queries: {
    description: "Four different queries share the same repository state. After the first approval, distinct requests can continue within the budget.",
    requests: ["fix build", "find compiler options", "read test setup", "check package exports"].map((query) => ({ query, cents: 75 })),
  },
  budget: {
    description: "Two smaller requests total $2.00. The next $3.50 request would cross a $5.00 cap, so approval cannot override the budget.",
    requests: [{ query: "inspect error", cents: 75 }, { query: "find fix", cents: 125 }, { query: "run full sandbox", cents: 350 }],
  },
};
const shortReasons = {
  R1_PROVIDER_NOT_ALLOWED: "Provider review", R1A_NOVEL_PROVIDER: "New provider", R1B_NOVEL_TOOL: "New tool",
  R2_EXACT_DUPLICATE: "Exact duplicate", R3_NEAR_DUPLICATE_NO_PROGRESS: "Equivalent retry",
  R4_BUDGET_EXCEEDED: "Budget cap", R5_FAILED_ATTEMPTS_EXCEEDED: "Failure review",
  R6_SOFT_PRICE_THRESHOLD: "Price review", R7_ALLOWED: "Allowed", R3A_NO_PROGRESS_LIMIT: "Progress review",
  APPROVAL_GRANTED: "Approved", APPROVAL_DENIED: "Denied", INTERNAL_ERROR: "Policy error",
};
const usd = (cents) => `$${(cents / 100).toFixed(2)}`;
const integerCents = (value) => {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(String(value).trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
};
let Engine;
let selected = "retry";
let generation = 0;
let running = false;
let pending = null;
let cursor = 0;
let spentCents = 0;
let blockedCents = 0;
let executed = [];
let entries = [];
let reasonCounts = new Map();

function config() {
  return {
    task_budget_usd: integerCents($("demo-budget").value) / 100,
    soft_approval_threshold_usd: 2,
    max_failed_attempts: 3,
    provider_allowlist: ["demo.tools.local"],
    duplicate_window: "task_lifetime",
    max_calls_without_progress: 5,
  };
}
function history(input) {
  return {
    exactFingerprintSeen: executed.some((request) => request.fingerprint === input.fingerprint),
    nearDuplicateSeenWithSameState: executed.some((request) => request.nearDuplicateKey === input.nearDuplicateKey && request.repoStateHash === input.repoStateHash),
    spentUsd: spentCents / 100,
    priorFailedAttempts: 0,
    providerSeenForTask: executed.some((request) => request.provider === input.provider),
    toolSeenForTask: executed.some((request) => request.tool === input.tool),
    callsWithoutProgress: executed.length,
  };
}
function inputFor(request) {
  const query = request.query.trim().replace(/\s+/gu, " ");
  return {
    taskId: "demo-001", provider: "demo.tools.local", tool: "paid_search", price: request.cents / 100,
    fingerprint: `simulated:paid_search:${query}:repo-v1`,
    nearDuplicateKey: `simulated:paid_search:${query}`, repoStateHash: "simulated-repo-v1",
  };
}
function count(reason) { reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1); }
function addText(parent, tag, className, value) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = value;
  parent.append(element);
  return element;
}
function render() {
  const cap = integerCents($("demo-budget").value) ?? 0;
  $("spent-value").textContent = usd(spentCents);
  $("blocked-value").textContent = usd(blockedCents);
  $("cap-value").textContent = usd(cap);
  $("budget-fill").style.width = `${cap > 0 ? Math.min(100, spentCents / cap * 100) : 0}%`;
  const progress = document.querySelector(".budget-track");
  progress.setAttribute("aria-valuemax", String(Math.max(cap, 1)));
  progress.setAttribute("aria-valuenow", String(spentCents));
  progress.setAttribute("aria-valuetext", `${usd(spentCents)} of ${usd(cap)} simulated budget`);
  $("request-log").replaceChildren();
  if (!entries.length) {
    const empty = addText($("request-log"), "li", "log-empty", "Your decisions will appear here.");
    empty.append(document.createElement("br"));
    addText(empty, "span", "", "Start the selected scenario.");
  }
  for (const entry of entries) {
    const row = document.createElement("li");
    addText(row, "span", "log-query", `${entry.index + 1}. ${entry.request.query}`);
    addText(row, "span", "log-price", usd(entry.request.cents));
    const result = document.createElement("div");
    result.className = `log-result ${entry.decision}`;
    const label = entry.approved ? "APPROVED" : entry.denied ? "DENIED" : entry.decision === "allow" ? "ALLOWED" : entry.decision === "block" ? "BLOCKED" : "AWAITING APPROVAL";
    addText(result, "strong", "", label);
    addText(result, "span", "", entry.reasonCode);
    result.title = entry.reason;
    row.append(result);
    $("request-log").append(row);
  }
  $("reason-summary").replaceChildren();
  addText($("reason-summary"), "span", "tiny-label", "REASON COUNTS");
  if (!reasonCounts.size) addText($("reason-summary"), "span", "", "No decisions yet.");
  for (const [code, total] of reasonCounts) {
    const reason = addText($("reason-summary"), "span", "reason-count", `${shortReasons[code] ?? code} × ${total}`);
    reason.title = code;
  }
  $("approval-panel").hidden = !pending;
  if (pending) {
    $("approval-title").textContent = `Approve ${usd(pending.request.cents)} for “${pending.request.query}”?`;
    $("approval-reason").textContent = pending.entry.reason;
  }
  $("run-demo").disabled = running || Boolean(pending) || !Engine;
}
function reset(message = "Ready. Start the scenario.") {
  generation += 1;
  running = false;
  pending = null;
  cursor = 0;
  spentCents = 0;
  blockedCents = 0;
  executed = [];
  entries = [];
  reasonCounts = new Map();
  $("demo-status").textContent = message;
  render();
}
function execute(request, input, entry, approved = false) {
  spentCents += request.cents;
  executed.push(input);
  entry.decision = "allow";
  entry.approved = approved;
}
async function pump(token) {
  running = true;
  render();
  const engine = new Engine(config, history);
  const requests = scenarios[selected].requests;
  while (cursor < requests.length && token === generation) {
    const request = requests[cursor];
    const input = inputFor(request);
    const result = engine.evaluate(input);
    const entry = { request, index: cursor, ...result };
    entries.push(entry);
    count(result.reasonCode);
    cursor += 1;
    if (result.decision === "require_approval") {
      pending = { request, input, entry, token };
      running = false;
      $("demo-status").textContent = "Paused for your simulated approval. No purchase has been made.";
      render();
      return;
    }
    if (result.decision === "allow") execute(request, input, entry);
    else blockedCents += request.cents;
    render();
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) await new Promise((resolve) => setTimeout(resolve, 180));
  }
  if (token !== generation) return;
  running = false;
  $("demo-status").textContent = `Complete. ${executed.length} simulated request${executed.length === 1 ? "" : "s"} executed; ${usd(spentCents)} within a ${usd(integerCents($("demo-budget").value))} cap.`;
  render();
}
document.querySelectorAll("[data-scenario]").forEach((button) => {
  button.addEventListener("click", () => {
    selected = button.dataset.scenario;
    document.querySelectorAll("[data-scenario]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    $("scenario-description").textContent = scenarios[selected].description;
    reset();
  });
});
$("demo-budget").addEventListener("input", () => reset("Budget changed. Run the scenario again to apply it."));
$("reset-demo").addEventListener("click", () => reset());
$("run-demo").addEventListener("click", () => {
  const cents = integerCents($("demo-budget").value);
  if (cents === null || cents < 1 || cents > 100000 || !$("demo-budget").checkValidity()) {
    $("demo-status").textContent = "Enter a task budget between $0.01 and $1,000.00, with at most two decimal places.";
    $("demo-budget").focus();
    return;
  }
  reset("Evaluating simulated requests…");
  void pump(generation);
});
$("approve-demo").addEventListener("click", () => {
  if (!pending || pending.token !== generation) return;
  const current = pending;
  pending = null;
  const rechecked = new Engine(config, history).evaluate(current.input);
  if (rechecked.decision === "block") {
    Object.assign(current.entry, rechecked);
    blockedCents += current.request.cents;
    count(rechecked.reasonCode);
  } else {
    execute(current.request, current.input, current.entry, true);
    count("APPROVAL_GRANTED");
  }
  $("demo-status").textContent = "Approval recorded for this simulation. Continuing…";
  void pump(generation);
});
$("deny-demo").addEventListener("click", () => {
  if (!pending || pending.token !== generation) return;
  const current = pending;
  pending = null;
  current.entry.decision = "block";
  current.entry.denied = true;
  current.entry.reasonCode = "APPROVAL_DENIED";
  current.entry.reason = "You denied this simulated paid request.";
  blockedCents += current.request.cents;
  count("APPROVAL_DENIED");
  running = false;
  $("demo-status").textContent = "Request denied. The scenario is stopped; no simulated provider call was made for this request.";
  render();
});
$("run-demo").disabled = true;
import("./vendor/policy-engine.js").then((module) => {
  if (typeof module.PolicyEngine !== "function") throw new Error("Policy engine export unavailable");
  Engine = module.PolicyEngine;
  render();
}).catch(() => {
  $("demo-status").textContent = "The policy demo could not load. The local package and installation guide below are still available.";
  $("run-demo").disabled = true;
});

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    const target = $(button.dataset.copy);
    const value = target.textContent;
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        copied = true;
      }
    } catch { /* Use the selection fallback below. */ }
    if (!copied) {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.cssText = "position:fixed;top:0;left:-10000px;";
      document.body.append(textarea);
      textarea.select();
      try { copied = document.execCommand("copy"); } catch { copied = false; }
      textarea.remove();
    }
    if (copied) {
      button.textContent = "Copied";
      $("copy-status").textContent = "Command copied to clipboard.";
      setTimeout(() => { button.textContent = "Copy"; }, 1600);
    } else {
      const range = document.createRange();
      range.selectNodeContents(target);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      $("copy-status").textContent = "Clipboard access is unavailable. The command is selected; use your device's copy action.";
    }
  });
});

let contactEmail = "";
// Optional public contact configuration. It never carries visitor form data.
fetch("./site-config.json", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((configuration) => {
  const email = configuration?.contactEmail;
  if (typeof email === "string" && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u.test(email) && !/[\r\n?&#]/u.test(email)) contactEmail = email;
}).catch(() => { /* Download-only form remains fully usable. */ });
function pilotData() {
  return {
    product: "Spend Guard", requestType: "four-week-assisted-pilot", proposedFeeUsd: 149,
    name: $("pilot-name").value.trim(), email: $("pilot-email").value.trim(),
    workflow: $("pilot-workflow").value.trim(),
    monthlyPaidToolBudgetUsd: $("pilot-budget").value.trim() ? integerCents($("pilot-budget").value) / 100 : null,
    createdAt: new Date().toISOString(),
    note: "Prepared locally. No information was submitted and no payment was collected. Scope and availability require personal confirmation.",
  };
}
$("pilot-form").addEventListener("input", () => {
  $("pilot-mail").hidden = true;
  $("pilot-mail").removeAttribute("href");
});
$("pilot-form").addEventListener("submit", (event) => {
  event.preventDefault();
  $("pilot-name").setCustomValidity($("pilot-name").value.trim().length < 2 ? "Enter your name, with at least two characters." : "");
  $("pilot-workflow").setCustomValidity($("pilot-workflow").value.trim().length < 10 ? "Describe your workflow in at least ten characters." : "");
  const budget = $("pilot-budget").value.trim();
  $("pilot-budget").setCustomValidity(budget && integerCents(budget) === null ? "Use a non-negative USD amount with at most two decimal places." : "");
  if (!$("pilot-form").reportValidity()) return;
  const data = pilotData();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "spend-guard-pilot-request.json";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  $("pilot-status").textContent = "Your pilot request file is prepared for download. No information was sent, no payment was collected, and nothing was saved to browser storage.";
  if (contactEmail) {
    const subject = "Spend Guard assisted pilot request";
    const body = `Hi Vansh,\n\nI'd like to discuss the proposed $149 four-week Spend Guard pilot.\n\nName: ${data.name}\nEmail: ${data.email}\n\nWorkflow:\n${data.workflow}\n\nMonthly paid-tool spending: ${data.monthlyPaidToolBudgetUsd === null ? "Not supplied" : usd(integerCents(budget))}\n\nPlease confirm scope and availability.\n`;
    $("pilot-mail").href = `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    $("pilot-mail").hidden = false;
    $("pilot-status").textContent += " You can also open an email draft and choose whether to send it in your email app.";
  }
});
for (const id of ["pilot-name", "pilot-workflow", "pilot-budget"]) $(id).addEventListener("input", () => $(id).setCustomValidity(""));

let submissionReceipt = null;
function downloadReceipt(receipt) {
 const url=URL.createObjectURL(new Blob([JSON.stringify(receipt,null,2)],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download='spendguard-pilot-receipt.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('request-pilot').addEventListener('click',async()=>{
 if(!$('pilot-form').reportValidity())return;
 if(!$('pilot-consent').checked){$('pilot-status').textContent='Choose whether to consent before submitting. You can download a local copy without sharing details.';$('pilot-consent').focus();return;}
 const data=pilotData();const button=$('request-pilot');button.disabled=true;$('pilot-status').textContent='Saving your pilot request…';
 try{const response=await fetch('/api/pilot',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:data.name,email:data.email,workflow:data.workflow,monthlyPaidToolBudgetUsd:data.monthlyPaidToolBudgetUsd,consent:true,website:$('pilot-website').value})});
 const result=await response.json();if(!response.ok||!result.requestId)throw new Error(result.error||'Could not save your request');
 submissionReceipt=result;downloadReceipt(result);$('delete-pilot').hidden=false;$('pilot-status').textContent='Request received. No payment was collected. Keep your downloaded receipt; it contains your request ID and deletion token. Scope and availability will be confirmed personally.';
 }catch(error){$('pilot-status').textContent=error.message+' You can still download a local copy.';}finally{button.disabled=false;}
});
$('delete-pilot').addEventListener('click',async()=>{
 if(!submissionReceipt)return;const button=$('delete-pilot');button.disabled=true;
 try{const response=await fetch('/api/pilot',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:submissionReceipt.requestId,deletionToken:submissionReceipt.deletionToken})});if(!response.ok)throw new Error('Unable to delete right now. Keep your receipt and try again.');submissionReceipt=null;button.hidden=true;$('pilot-status').textContent='Your submitted request was deleted.';}catch(error){$('pilot-status').textContent=error.message;}finally{button.disabled=false;}
});

$('receipt-delete-form').addEventListener('submit',async(event)=>{
 event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;
 const status=$('receipt-delete-status');status.textContent='Processing your deletion request…';
 try{const response=await fetch('/api/pilot',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:$('receipt-id').value.trim(),deletionToken:$('receipt-token').value.trim()})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to delete now');status.textContent='Any submission matching this receipt has been deleted.';$('receipt-token').value='';}catch(error){status.textContent=error.message;}
});
