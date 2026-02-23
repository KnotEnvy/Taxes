const elements = {
  bootstrapBtn: document.querySelector("#bootstrapBtn"),
  scanBtn: document.querySelector("#scanBtn"),
  processBtn: document.querySelector("#processBtn"),
  processAllBtn: document.querySelector("#processAllBtn"),
  refreshBtn: document.querySelector("#refreshBtn"),
  tenantSelect: document.querySelector("#tenantSelect"),
  yearSelect: document.querySelector("#yearSelect"),
  statementCount: document.querySelector("#statementCount"),
  transactionCount: document.querySelector("#transactionCount"),
  reviewCount: document.querySelector("#reviewCount"),
  statementRows: document.querySelector("#statementRows"),
  reviewRows: document.querySelector("#reviewRows"),
  summaryBtn: document.querySelector("#summaryBtn"),
  summaryRows: document.querySelector("#summaryRows"),
  csvLink: document.querySelector("#csvLink"),
  reloadReviewsBtn: document.querySelector("#reloadReviewsBtn"),
  reloadRulesBtn: document.querySelector("#reloadRulesBtn"),
  ruleRows: document.querySelector("#ruleRows"),
  ruleCategoryInput: document.querySelector("#ruleCategoryInput"),
  rulePatternInput: document.querySelector("#rulePatternInput"),
  ruleScopeInput: document.querySelector("#ruleScopeInput"),
  ruleAccountInput: document.querySelector("#ruleAccountInput"),
  createRuleBtn: document.querySelector("#createRuleBtn"),
  logPanel: document.querySelector("#logPanel"),
};

function selectedTenant() {
  return elements.tenantSelect.value || null;
}

function selectedYear() {
  return Number.parseInt(elements.yearSelect.value, 10);
}

function appendLog(message, payload) {
  const stamp = new Date().toISOString();
  const line = payload ? `[${stamp}] ${message}\n${JSON.stringify(payload, null, 2)}\n` : `[${stamp}] ${message}\n`;
  elements.logPanel.textContent = `${line}${elements.logPanel.textContent}`.slice(0, 10000);
}

async function api(pathname, options = {}) {
  const tenantId = selectedTenant();
  const headers = {
    "content-type": "application/json",
    ...(options.headers ?? {}),
  };
  if (tenantId) {
    headers["x-tenant-id"] = tenantId;
  }

  const response = await fetch(pathname, {
    ...options,
    headers,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

function renderTenants(tenants) {
  elements.tenantSelect.innerHTML = "";
  for (const tenant of tenants) {
    const opt = document.createElement("option");
    opt.value = tenant.id;
    opt.textContent = `${tenant.name} (${tenant.id})`;
    elements.tenantSelect.appendChild(opt);
  }
}

function renderStatements(statements) {
  elements.statementRows.innerHTML = "";
  for (const statement of statements) {
    const tr = document.createElement("tr");
    const period = `${statement.statementYear ?? "?"}-${String(statement.statementMonth ?? 0).padStart(2, "0")}`;
    let diag = "-";
    if (statement.parseDiagnostics) {
      const parsed = statement.parseDiagnostics.parsedTransactions ?? 0;
      const lines = statement.parseDiagnostics.textLines ?? 0;
      const method = statement.parseDiagnostics.parseMethod ?? "UNKNOWN";
      const confidence = Number.isFinite(statement.parseDiagnostics.parserConfidence)
        ? statement.parseDiagnostics.parserConfidence.toFixed(2)
        : "n/a";
      diag = `${parsed} tx / ${lines} lines | ${method} (${confidence})`;
    }

    tr.innerHTML = `
      <td>${statement.institution}</td>
      <td>${statement.accountLabel}</td>
      <td>${period}</td>
      <td>${statement.status}</td>
      <td>${diag}</td>
      <td><button class="tiny secondary" data-process="${statement.id}">Process</button></td>
    `;
    elements.statementRows.appendChild(tr);
  }
}

function renderReviews(items) {
  elements.reviewRows.innerHTML = "";
  for (const item of items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.reason}</td>
      <td>${item.detail ?? "-"}</td>
      <td>${item.statementId ?? "-"}</td>
      <td>${item.transactionId ?? "-"}</td>
      <td>${item.status}</td>
      <td><button class="tiny" data-resolve="${item.id}" data-transaction="${item.transactionId ?? ""}">Resolve</button></td>
    `;
    elements.reviewRows.appendChild(tr);
  }
}

function renderSummary(summary) {
  elements.summaryRows.innerHTML = "";
  for (const row of summary.rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.displayName}</td>
      <td>${row.irsLineRef}</td>
      <td>${row.count}</td>
      <td>${row.total.toFixed(2)}</td>
    `;
    elements.summaryRows.appendChild(tr);
  }
}

function renderRules(rules) {
  elements.ruleRows.innerHTML = "";
  for (const rule of rules) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${rule.name ?? "-"}</td>
      <td>${rule.scope}${rule.accountLabel ? ` (${rule.accountLabel})` : ""}</td>
      <td>${rule.categoryCode}</td>
      <td><code>${rule.pattern}</code></td>
      <td>${rule.priority}</td>
      <td><button class="tiny secondary" data-disable-rule="${rule.id}">Disable</button></td>
    `;
    elements.ruleRows.appendChild(tr);
  }
}

async function refreshStats() {
  const tenantId = selectedTenant();
  if (!tenantId) {
    return;
  }
  const stats = await api(`/v1/stats?tenantId=${encodeURIComponent(tenantId)}`, { method: "GET" });
  elements.statementCount.textContent = String(stats.statementCount);
  elements.transactionCount.textContent = String(stats.transactionCount);
  elements.reviewCount.textContent = String(stats.openReviewCount);
}

async function refreshStatements() {
  const tenantId = selectedTenant();
  if (!tenantId) {
    return;
  }
  const payload = await api(`/v1/statements?tenantId=${encodeURIComponent(tenantId)}`, { method: "GET" });
  renderStatements(payload.statements);
}

async function refreshReviews() {
  const tenantId = selectedTenant();
  if (!tenantId) {
    return;
  }
  const payload = await api(`/v1/review-queue?tenantId=${encodeURIComponent(tenantId)}&status=OPEN`, { method: "GET" });
  renderReviews(payload.reviewItems);
}

async function refreshRules() {
  const tenantId = selectedTenant();
  if (!tenantId) {
    return;
  }
  const payload = await api(`/v1/rules?tenantId=${encodeURIComponent(tenantId)}`, { method: "GET" });
  renderRules(payload.rules);
}

async function refreshAll() {
  await refreshStats();
  await refreshStatements();
  await refreshReviews();
  await refreshRules();
}

async function bootstrapDefaultTenant() {
  const payload = await api("/v1/bootstrap", { method: "POST", body: JSON.stringify({}) });
  appendLog("Bootstrap complete", payload);
}

async function loadTenants() {
  const { tenants } = await api("/v1/tenants", { method: "GET" });
  renderTenants(tenants);
  return tenants;
}

async function scanLocal() {
  const tenantId = selectedTenant();
  const payload = await api("/v1/statements/scan-local", {
    method: "POST",
    body: JSON.stringify({
      tenantId,
    }),
  });
  appendLog("Local scan complete", payload);
  await refreshAll();
}

async function processPending() {
  const payload = await api("/v1/statements/process-pending", {
    method: "POST",
    body: JSON.stringify({
      limit: 50,
    }),
  });
  appendLog("Process pending complete", payload);
  await refreshAll();
}

async function processOne(statementId) {
  const payload = await api(`/v1/statements/${statementId}/process`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  appendLog(`Statement processed: ${statementId}`, payload);
  await refreshAll();
}

async function resolveReview(reviewId, transactionId) {
  let categoryCode = null;
  let createRuleFromTransaction = false;
  let ruleScope = "TENANT";
  if (transactionId) {
    categoryCode = prompt(
      "Optional category code for manual classification (e.g., supplies, wages, advertising). Leave blank to only resolve.",
      "",
    );
    if (categoryCode) {
      createRuleFromTransaction = confirm("Create a reusable rule from this decision?");
      if (createRuleFromTransaction) {
        ruleScope = confirm("Create account-scoped rule? OK=ACCOUNT, Cancel=TENANT") ? "ACCOUNT" : "TENANT";
      }
    }
  }

  const payload = await api(`/v1/review-queue/${reviewId}/resolve`, {
    method: "POST",
    body: JSON.stringify({
      note: "Resolved from dashboard",
      categoryCode: categoryCode || undefined,
      createRuleFromTransaction,
      ruleScope,
    }),
  });
  appendLog(`Review resolved: ${reviewId}`, payload);
  await refreshAll();
}

async function createRule() {
  const tenantId = selectedTenant();
  const categoryCode = elements.ruleCategoryInput.value.trim();
  const pattern = elements.rulePatternInput.value.trim();
  const scope = elements.ruleScopeInput.value;
  const accountLabel = elements.ruleAccountInput.value.trim();

  const payload = await api("/v1/rules", {
    method: "POST",
    body: JSON.stringify({
      tenantId,
      categoryCode,
      pattern,
      scope,
      accountLabel: scope === "ACCOUNT" ? accountLabel : undefined,
    }),
  });

  appendLog("Rule created", payload);
  elements.rulePatternInput.value = "";
  await refreshRules();
}

async function disableRule(ruleId) {
  const tenantId = selectedTenant();
  const payload = await api(`/v1/rules/${ruleId}?tenantId=${encodeURIComponent(tenantId)}`, {
    method: "DELETE",
  });
  appendLog(`Rule disabled: ${ruleId}`, payload);
  await refreshRules();
}

async function generateSummary() {
  const tenantId = selectedTenant();
  const year = selectedYear();
  const summary = await api(`/v1/reports/tax-summary?tenantId=${encodeURIComponent(tenantId)}&year=${year}`, {
    method: "GET",
  });
  renderSummary(summary);
  elements.csvLink.href = `/v1/reports/export?tenantId=${encodeURIComponent(tenantId)}&year=${year}&format=csv`;
  appendLog(`Summary generated for ${year}`, summary);
}

function wireEvents() {
  elements.bootstrapBtn.addEventListener("click", async () => {
    try {
      await bootstrapDefaultTenant();
      const tenants = await loadTenants();
      if (tenants.length > 0) {
        elements.tenantSelect.value = tenants[0].id;
      }
      await refreshAll();
    } catch (error) {
      appendLog("Bootstrap error", { message: error.message });
    }
  });

  elements.scanBtn.addEventListener("click", async () => {
    try {
      await scanLocal();
    } catch (error) {
      appendLog("Scan error", { message: error.message });
    }
  });

  elements.processBtn.addEventListener("click", async () => {
    try {
      await processPending();
    } catch (error) {
      appendLog("Process error", { message: error.message });
    }
  });

  elements.processAllBtn.addEventListener("click", async () => {
    try {
      await processPending();
    } catch (error) {
      appendLog("Process error", { message: error.message });
    }
  });

  elements.refreshBtn.addEventListener("click", async () => {
    try {
      await refreshAll();
    } catch (error) {
      appendLog("Refresh error", { message: error.message });
    }
  });

  elements.reloadReviewsBtn.addEventListener("click", async () => {
    try {
      await refreshReviews();
    } catch (error) {
      appendLog("Review reload error", { message: error.message });
    }
  });

  elements.reloadRulesBtn.addEventListener("click", async () => {
    try {
      await refreshRules();
    } catch (error) {
      appendLog("Rules reload error", { message: error.message });
    }
  });

  elements.createRuleBtn.addEventListener("click", async () => {
    try {
      await createRule();
    } catch (error) {
      appendLog("Create rule error", { message: error.message });
    }
  });

  elements.summaryBtn.addEventListener("click", async () => {
    try {
      await generateSummary();
    } catch (error) {
      appendLog("Summary error", { message: error.message });
    }
  });

  elements.tenantSelect.addEventListener("change", async () => {
    try {
      await refreshAll();
    } catch (error) {
      appendLog("Tenant change error", { message: error.message });
    }
  });

  elements.statementRows.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const statementId = target.dataset.process;
    if (!statementId) {
      return;
    }
    try {
      await processOne(statementId);
    } catch (error) {
      appendLog("Process statement error", { message: error.message, statementId });
    }
  });

  elements.reviewRows.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const reviewId = target.dataset.resolve;
    if (!reviewId) {
      return;
    }
    const transactionId = target.dataset.transaction || null;
    try {
      await resolveReview(reviewId, transactionId);
    } catch (error) {
      appendLog("Resolve review error", { message: error.message, reviewId });
    }
  });

  elements.ruleRows.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const ruleId = target.dataset.disableRule;
    if (!ruleId) {
      return;
    }
    try {
      await disableRule(ruleId);
    } catch (error) {
      appendLog("Disable rule error", { message: error.message, ruleId });
    }
  });
}

async function init() {
  wireEvents();
  try {
    await bootstrapDefaultTenant();
  } catch (error) {
    appendLog("Bootstrap skipped", { message: error.message });
  }

  try {
    const tenants = await loadTenants();
    if (tenants.length > 0) {
      elements.tenantSelect.value = tenants[0].id;
      await refreshAll();
      appendLog("Dashboard ready", { tenantId: tenants[0].id });
    }
  } catch (error) {
    appendLog("Initialization error", { message: error.message });
  }
}

await init();
