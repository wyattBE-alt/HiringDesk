// ── State ──────────────────────────────────────────────────────────────────

let currentJob = null;
let currentCandidates = [];
let previewHtml = "";
let pastMatchController = null;
let shortlistedCandidates = new Set();
let activeFilter = "all";

// ── Element refs ────────────────────────────────────────────────────────────

const rankForm = document.getElementById("rankForm");
const rankBtn = document.getElementById("rankBtn");
const rankChip = document.getElementById("rankChip");
const rankMessage = document.getElementById("rankMessage");
const emptyState = document.getElementById("emptyState");
const resultsState = document.getElementById("resultsState");
const rankedList = document.getElementById("rankedList");
const notifyBtn = document.getElementById("notifyBtn");
const previewEmailBtn = document.getElementById("previewEmailBtn");
const notifyEmailInput = document.getElementById("notifyEmailInput");
const notifyMessage = document.getElementById("notifyMessage");
const emailModal = document.getElementById("emailModal");
const emailPreviewFrame = document.getElementById("emailPreviewFrame");
const downloadEmailBtn = document.getElementById("downloadEmailBtn");
const pastSection = document.getElementById("pastSection");
const pastList = document.getElementById("pastList");
const pastChip = document.getElementById("pastChip");
const pastSubtitle = document.getElementById("pastSubtitle");
const shortlistSection = document.getElementById("shortlistSection");
const filterChipsEl = document.getElementById("filterChips");
const csvBtn = document.getElementById("csvBtn");
const integrationsToggle = document.getElementById("integrationsToggle");
const integrationsBody = document.getElementById("integrationsBody");
const integrationsChevron = document.getElementById("integrationsChevron");

// ── Form submission ──────────────────────────────────────────────────────────

rankForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const resumeFiles = document.getElementById("resumeFiles").files;
  const batchText = document.getElementById("batchText").value.trim();

  if (!resumeFiles.length && !batchText) {
    setStatus("error", "Please upload resume files or paste candidate resumes.");
    return;
  }

  const formData = new FormData();
  formData.append("jobTitle", document.getElementById("jobTitle").value.trim());
  formData.append("department", document.getElementById("department").value.trim());
  formData.append("jobLocation", document.getElementById("jobLocation").value.trim());
  formData.append("requiredSkills", document.getElementById("requiredSkills").value.trim());
  formData.append("requiredCertifications", document.getElementById("requiredCertifications").value.trim());
  formData.append("minYearsExp", document.getElementById("minYearsExp").value.trim());
  formData.append("additionalNotes", document.getElementById("additionalNotes").value.trim());
  if (batchText) formData.append("batchText", batchText);
  for (const file of resumeFiles) formData.append("resumeFiles", file);

  const fileCount = resumeFiles.length;
  const pasteCount = batchText
    ? batchText.split(/\n\s*-{3,}\s*\n/).filter((s) => s.trim()).length
    : 0;
  const totalCount = fileCount + pasteCount;

  setStatus(
    "loading",
    `Analyzing ${totalCount} candidate${totalCount !== 1 ? "s" : ""} — this takes 20–40 seconds for large pools…`
  );
  rankBtn.disabled = true;

  // Kick off past-match check in parallel
  const jobData = {
    title: document.getElementById("jobTitle").value.trim(),
    department: document.getElementById("department").value.trim(),
    location: document.getElementById("jobLocation").value.trim(),
    requiredSkills: document.getElementById("requiredSkills").value.trim(),
    requiredCertifications: document.getElementById("requiredCertifications").value.trim(),
    minYearsExp: document.getElementById("minYearsExp").value.trim(),
    additionalNotes: document.getElementById("additionalNotes").value.trim()
  };
  if (pastMatchController) pastMatchController.abort();
  pastMatchController = new AbortController();
  fetchPastMatches(jobData, pastMatchController.signal);

  try {
    const response = await fetch("/api/recruiter/rank", { method: "POST", body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Ranking failed.");
    renderResults(data);
    setStatus("success", `Ranked ${data.stats.totalAnalyzed} candidates. Showing top ${data.candidates.length}.`);
  } catch (err) {
    setStatus("error", err.message);
  } finally {
    rankBtn.disabled = false;
  }
});

// ── Status chip ─────────────────────────────────────────────────────────────

function setStatus(mode, message) {
  rankMessage.textContent = message;
  const classMap = { loading: "loading", success: "success", error: "error", neutral: "neutral" };
  const labelMap = { loading: "Working", success: "Done", error: "Error", neutral: "Ready" };
  rankChip.className = `status-chip ${classMap[mode] || "neutral"}`;
  rankChip.textContent = labelMap[mode] || "Ready";
}

// ── Render results ───────────────────────────────────────────────────────────

function renderResults(data) {
  const { job, candidates, stats } = data;
  currentJob = job;
  currentCandidates = candidates;
  previewHtml = "";
  shortlistedCandidates = new Set();
  activeFilter = "all";
  filterChipsEl.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("filter-chip--active"));
  filterChipsEl.querySelector('[data-filter="all"]').classList.add("filter-chip--active");

  // Job summary
  document.getElementById("rJobTitle").textContent = job.title;
  document.getElementById("rDepartment").textContent = job.department || "—";
  document.getElementById("rLocation").textContent = job.location || "—";
  document.getElementById("rMinExp").textContent = job.minYearsExp ? `${job.minYearsExp}+ years` : "Not specified";
  document.getElementById("rSkills").textContent = job.requiredSkills || "Not specified";
  document.getElementById("rCerts").textContent = job.requiredCertifications || "None required";

  // Stats
  document.getElementById("rTotalAnalyzed").textContent = stats.totalAnalyzed;
  document.getElementById("rHighPriority").textContent = stats.highPriority;
  document.getElementById("rQualified").textContent = stats.qualified;
  document.getElementById("rAvgScore").textContent = stats.averageScore;

  // Pre-fill notify email
  if (job.notificationEmail) notifyEmailInput.value = job.notificationEmail;

  // Ranked list
  renderShortlistSection();
  renderFilteredList();

  // Show results
  emptyState.style.display = "none";
  resultsState.classList.remove("results-hidden");
  resultsState.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Candidate card ───────────────────────────────────────────────────────────

function renderRankedCard(candidate, rank, index) {
  const { name, currentTitle, location, contactInfo, yearsExperience, score, tier,
    matchedSkills, missingSkills, matchedCertifications, missingCertifications, reason } = candidate;

  const isShortlisted = shortlistedCandidates.has(index);

  const tierClass = tier === "high_priority" ? "qualified"
    : tier === "qualified" ? "borderline"
    : "stretch";

  const tierLabel = tier === "high_priority" ? "High Priority"
    : tier === "qualified" ? "Qualified"
    : "Review";

  const tierBadgeClass = tier === "high_priority" ? "tier-badge--green"
    : tier === "qualified" ? "tier-badge--amber"
    : "tier-badge--rose";

  const certHtml = (() => {
    const parts = [];
    if (matchedCertifications?.length) {
      parts.push(matchedCertifications.map((c) =>
        `<span class="cert-pill cert-pill--ok">✓ ${escapeHtml(c)}</span>`
      ).join(""));
    }
    if (missingCertifications?.length) {
      parts.push(missingCertifications.map((c) =>
        `<span class="cert-pill cert-pill--missing">✗ ${escapeHtml(c)}</span>`
      ).join(""));
    }
    return parts.join("") || `<span class="cert-pill cert-pill--ok">No cert requirements</span>`;
  })();

  return `
    <article class="ranked-card ranked-card--${tierClass}">
      <div class="ranked-card-inner">

        <!-- Rank + score column -->
        <div class="rank-col">
          <span class="rank-num">#${rank}</span>
          <span class="rank-score ${tierClass}">${score}</span>
          <span class="tier-badge ${tierBadgeClass}">${tierLabel}</span>
        </div>

        <!-- Candidate info column -->
        <div class="cand-col">
          <div class="cand-header-row">
            <div class="cand-header">
              <h4 class="cand-name">${escapeHtml(name)}</h4>
              <div class="cand-meta-row">
                ${currentTitle ? `<span class="meta-pill">${escapeHtml(currentTitle)}</span>` : ""}
                ${location ? `<span class="meta-pill">📍 ${escapeHtml(location)}</span>` : ""}
                ${yearsExperience != null ? `<span class="meta-pill">⏱ ${yearsExperience} yr${yearsExperience !== 1 ? "s" : ""}</span>` : ""}
                ${contactInfo ? `<span class="meta-pill meta-pill--contact">✉ ${escapeHtml(contactInfo)}</span>` : ""}
              </div>
            </div>
            <button type="button" class="shortlist-btn${isShortlisted ? " shortlist-btn--active" : ""}" data-candidate-index="${index}" aria-pressed="${isShortlisted}">${isShortlisted ? "★ Shortlisted" : "☆ Shortlist"}</button>
          </div>

          <p class="cand-reason">${escapeHtml(reason || "")}</p>

          <div class="skills-row">
            ${matchedSkills?.length
              ? `<div class="skills-group skills-group--matched">
                  <span class="skills-label">✓ Matched:</span> ${matchedSkills.map((s) => `<span class="skill-tag skill-tag--matched">${escapeHtml(s)}</span>`).join("")}
                </div>`
              : ""}
            ${missingSkills?.length
              ? `<div class="skills-group skills-group--missing">
                  <span class="skills-label">✗ Missing:</span> ${missingSkills.map((s) => `<span class="skill-tag skill-tag--missing">${escapeHtml(s)}</span>`).join("")}
                </div>`
              : ""}
          </div>

          <div class="certs-row">${certHtml}</div>
        </div>

      </div>
    </article>
  `;
}

// ── Shortlist & filter ───────────────────────────────────────────────────────

function renderFilteredList() {
  if (!currentCandidates.length) {
    rankedList.innerHTML = `<div class="empty-card">No candidates matched enough to rank. Try relaxing requirements or uploading more resumes.</div>`;
    return;
  }
  const filtered = activeFilter === "all"
    ? currentCandidates
    : currentCandidates.filter(c => c.tier === activeFilter);
  if (!filtered.length) {
    rankedList.innerHTML = `<div class="empty-card">No candidates in this tier.</div>`;
    return;
  }
  rankedList.innerHTML = filtered.map(c => {
    const i = currentCandidates.indexOf(c);
    return renderRankedCard(c, i + 1, i);
  }).join("");
}

function renderShortlistSection() {
  const shortlisted = currentCandidates.filter((_, i) => shortlistedCandidates.has(i));
  if (!shortlisted.length) {
    shortlistSection.style.display = "none";
    return;
  }
  shortlistSection.style.display = "grid";
  document.getElementById("shortlistCount").textContent =
    `${shortlisted.length} candidate${shortlisted.length !== 1 ? "s" : ""}`;
  document.getElementById("shortlistList").innerHTML = shortlisted.map(c => {
    const i = currentCandidates.indexOf(c);
    return renderRankedCard(c, i + 1, i);
  }).join("");
}

resultsState.addEventListener("click", (e) => {
  const btn = e.target.closest(".shortlist-btn");
  if (!btn) return;
  const idx = parseInt(btn.dataset.candidateIndex, 10);
  if (shortlistedCandidates.has(idx)) {
    shortlistedCandidates.delete(idx);
  } else {
    shortlistedCandidates.add(idx);
  }
  renderFilteredList();
  renderShortlistSection();
});

filterChipsEl.addEventListener("click", (e) => {
  const chip = e.target.closest(".filter-chip");
  if (!chip) return;
  activeFilter = chip.dataset.filter;
  filterChipsEl.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("filter-chip--active"));
  chip.classList.add("filter-chip--active");
  renderFilteredList();
});

// ── Notify / email ───────────────────────────────────────────────────────────

notifyBtn.addEventListener("click", async () => {
  const email = notifyEmailInput.value.trim() || currentJob?.notificationEmail;
  if (!email) {
    notifyMessage.textContent = "Enter a hiring manager email first.";
    notifyMessage.className = "support-copy notify-feedback error-text";
    return;
  }

  notifyBtn.disabled = true;
  notifyMessage.textContent = "Sending…";
  notifyMessage.className = "support-copy notify-feedback";

  try {
    const response = await fetch("/api/recruiter/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job: currentJob, candidates: currentCandidates, notificationEmail: email })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Notification failed.");

    if (!data.configured) {
      previewHtml = data.emailHtml;
      notifyMessage.textContent = "SMTP not set up — showing preview instead.";
      notifyMessage.className = "support-copy notify-feedback";
      openEmailModal(data.emailHtml);
    } else {
      notifyMessage.textContent = data.message;
      notifyMessage.className = "support-copy notify-feedback success-text";
    }
  } catch (err) {
    notifyMessage.textContent = err.message;
    notifyMessage.className = "support-copy notify-feedback error-text";
  } finally {
    notifyBtn.disabled = false;
  }
});

previewEmailBtn.addEventListener("click", async () => {
  if (previewHtml) {
    openEmailModal(previewHtml);
    return;
  }

  previewEmailBtn.disabled = true;
  try {
    const response = await fetch("/api/recruiter/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job: currentJob, candidates: currentCandidates, notificationEmail: "preview@preview.com" })
    });
    const data = await response.json();
    previewHtml = data.emailHtml || "";
    if (previewHtml) openEmailModal(previewHtml);
  } catch (err) {
    notifyMessage.textContent = err.message;
    notifyMessage.className = "support-copy notify-feedback error-text";
  } finally {
    previewEmailBtn.disabled = false;
  }
});

// ── Email modal ──────────────────────────────────────────────────────────────

function openEmailModal(html) {
  emailPreviewFrame.innerHTML = `<iframe
    srcdoc="${html.replace(/"/g, "&quot;")}"
    style="width:100%;height:560px;border:none;border-radius:12px"
    sandbox="allow-same-origin"
  ></iframe>`;
  emailModal.classList.add("modal-open");
  emailModal.setAttribute("aria-hidden", "false");
}

function closeModal() {
  emailModal.classList.remove("modal-open");
  emailModal.setAttribute("aria-hidden", "true");
}

document.getElementById("modalClose").addEventListener("click", closeModal);
document.querySelector(".modal-close-btn-footer").addEventListener("click", closeModal);
emailModal.addEventListener("click", (e) => { if (e.target === emailModal) closeModal(); });

downloadEmailBtn.addEventListener("click", () => {
  if (!previewHtml) return;
  const jobTitle = currentJob?.title?.replace(/\s+/g, "-") || "report";
  const blob = new Blob([previewHtml], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hiringdesk-${jobTitle}-candidates.html`;
  a.click();
  URL.revokeObjectURL(url);
});

// ── Past applicants ──────────────────────────────────────────────────────────

async function fetchPastMatches(jobData, signal) {
  // Show the section in "checking" state
  pastSection.style.display = "block";
  pastList.innerHTML = "";
  pastChip.className = "status-chip loading";
  pastChip.textContent = "Checking";
  pastSubtitle.textContent = "Searching your candidate database…";

  try {
    const response = await fetch("/api/recruiter/past-match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jobData),
      signal
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Past match failed.");

    if (!data.candidates || data.candidates.length === 0) {
      pastSection.style.display = "none";
      return;
    }

    renderPastMatches(data);
  } catch (err) {
    if (err.name === "AbortError") return;
    pastSection.style.display = "none";
  }
}

function renderPastMatches({ candidates, totalInDb }) {
  pastChip.className = "status-chip success";
  pastChip.textContent = `${candidates.length} Found`;
  pastSubtitle.textContent = `${candidates.length} past candidate${candidates.length !== 1 ? "s" : ""} from your database of ${totalInDb} match this role's requirements.`;

  pastList.innerHTML = candidates.map((c, i) => renderPastCard(c, i + 1)).join("");
}

function renderPastCard(candidate, rank) {
  const { name, currentTitle, location, contactInfo, yearsExperience,
    score, matchedSkills, missingSkills } = candidate;

  const scoreClass = score >= 75 ? "qualified" : score >= 50 ? "borderline" : "stretch";
  const tierLabel = score >= 75 ? "Strong Match" : score >= 50 ? "Possible Match" : "Partial Match";
  const tierBadgeClass = score >= 75 ? "tier-badge--green" : score >= 50 ? "tier-badge--amber" : "tier-badge--rose";

  return `
    <article class="ranked-card ranked-card--${scoreClass} past-card">
      <div class="ranked-card-inner">
        <div class="rank-col">
          <span class="past-badge">Past</span>
          <span class="rank-score ${scoreClass}">${score}</span>
          <span class="tier-badge ${tierBadgeClass}">${tierLabel}</span>
        </div>
        <div class="cand-col">
          <div class="cand-header">
            <h4 class="cand-name">${escapeHtml(name)}</h4>
            <div class="cand-meta-row">
              ${currentTitle ? `<span class="meta-pill">${escapeHtml(currentTitle)}</span>` : ""}
              ${location ? `<span class="meta-pill">📍 ${escapeHtml(location)}</span>` : ""}
              ${yearsExperience != null ? `<span class="meta-pill">⏱ ${yearsExperience} yr${yearsExperience !== 1 ? "s" : ""}</span>` : ""}
              ${contactInfo ? `<span class="meta-pill meta-pill--contact">✉ ${escapeHtml(contactInfo)}</span>` : ""}
            </div>
          </div>
          <div class="skills-row">
            ${matchedSkills?.length
              ? `<div class="skills-group skills-group--matched">
                  <span class="skills-label">✓ Matched:</span>
                  ${matchedSkills.map((s) => `<span class="skill-tag skill-tag--matched">${escapeHtml(s)}</span>`).join("")}
                </div>`
              : ""}
            ${missingSkills?.length
              ? `<div class="skills-group skills-group--missing">
                  <span class="skills-label">✗ Missing:</span>
                  ${missingSkills.map((s) => `<span class="skill-tag skill-tag--missing">${escapeHtml(s)}</span>`).join("")}
                </div>`
              : ""}
          </div>
        </div>
      </div>
    </article>
  `;
}

// ── CSV export ───────────────────────────────────────────────────────────────

function csvCell(val) {
  const s = String(val ?? "");
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function downloadCsv() {
  const tierLabel = (t) =>
    t === "high_priority" ? "High Priority" : t === "qualified" ? "Qualified" : "Review";

  const headers = [
    "Rank", "Candidate Name", "Current Title", "Location", "Contact",
    "Years Experience", "Match Score", "Tier", "Matched Skills", "Missing Skills",
    "Matched Certifications", "Missing Certifications", "AI Summary",
    "Job Title", "Department", "Date Exported"
  ];

  const dateExported = new Date().toISOString();
  const jobTitle    = currentJob?.title      || "";
  const department  = currentJob?.department || "";

  const rows = currentCandidates.map((c, i) => [
    i + 1,
    c.name,
    c.currentTitle               || "",
    c.location                   || "",
    c.contactInfo                || "",
    c.yearsExperience            ?? "",
    c.score,
    tierLabel(c.tier),
    (c.matchedSkills          || []).join("|"),
    (c.missingSkills          || []).join("|"),
    (c.matchedCertifications  || []).join("|"),
    (c.missingCertifications  || []).join("|"),
    c.reason                     || "",
    jobTitle,
    department,
    dateExported
  ].map(csvCell).join(","));

  const csv  = [headers.join(","), ...rows].join("\r\n");
  const slug = (jobTitle || "candidates")
    .toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const date = dateExported.slice(0, 10);

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `hiringdesk-${slug}-${date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

csvBtn.addEventListener("click", () => {
  if (currentCandidates.length) downloadCsv();
});

// ── Integrations panel ───────────────────────────────────────────────────────

integrationsToggle.addEventListener("click", () => {
  const isOpen = integrationsBody.style.display !== "none";
  integrationsBody.style.display = isOpen ? "none" : "grid";
  integrationsChevron.classList.toggle("integrations-chevron--open", !isOpen);
});

function buildWebhookPayload() {
  const counts = currentCandidates.reduce(
    (acc, c) => { acc[c.tier === "high_priority" ? "high_priority" : c.tier === "qualified" ? "qualified" : "review"]++; return acc; },
    { high_priority: 0, qualified: 0, review: 0 }
  );
  const avgScore = currentCandidates.length
    ? Math.round(currentCandidates.reduce((s, c) => s + c.score, 0) / currentCandidates.length)
    : 0;
  return {
    event: "candidates_ranked",
    timestamp: new Date().toISOString(),
    job: currentJob,
    stats: { total: currentCandidates.length, ...counts, average_score: avgScore },
    candidates: currentCandidates
  };
}

async function sendWebhook(url, authToken, btnEl, msgEl) {
  if (!url) {
    msgEl.textContent = "Enter a webhook URL first.";
    msgEl.className = "support-copy notify-feedback error-text";
    return;
  }
  const originalText = btnEl.textContent;
  btnEl.disabled = true;
  btnEl.textContent = "Sending…";
  msgEl.textContent = "";
  msgEl.className = "support-copy notify-feedback";

  try {
    const body = { url, payload: buildWebhookPayload() };
    if (authToken) body.authorization = authToken;

    const response = await fetch("/api/integrations/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || "Webhook delivery failed.");

    msgEl.textContent = "Sent successfully.";
    msgEl.className = "support-copy notify-feedback success-text";
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.className = "support-copy notify-feedback error-text";
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = originalText;
  }
}

document.getElementById("zapierBtn").addEventListener("click", () => {
  sendWebhook(
    document.getElementById("zapierUrl").value.trim(),
    null,
    document.getElementById("zapierBtn"),
    document.getElementById("zapierMessage")
  );
});

document.getElementById("makeBtn").addEventListener("click", () => {
  sendWebhook(
    document.getElementById("makeUrl").value.trim(),
    null,
    document.getElementById("makeBtn"),
    document.getElementById("makeMessage")
  );
});

document.getElementById("webhookBtn").addEventListener("click", () => {
  sendWebhook(
    document.getElementById("webhookUrl").value.trim(),
    document.getElementById("webhookToken").value.trim(),
    document.getElementById("webhookBtn"),
    document.getElementById("webhookMessage")
  );
});

// ── Utilities ────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
