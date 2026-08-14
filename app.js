const analyzeForm = document.getElementById("analyzeForm");
const analyzeBtn = document.getElementById("analyzeBtn");
const analyzeMessage = document.getElementById("analyzeMessage");
const resumeChip = document.getElementById("resumeChip");
const emptyState = document.getElementById("emptyState");
const resultsState = document.getElementById("resultsState");

const SCORE_HISTORY_KEY = "hiringdesk_score_history";
let lastJobQuery = "";

// ── File drop zone: show filename + drag-and-drop ────────────────────────────
(function initFileDrop() {
  const drop = document.getElementById("fileDrop");
  const input = document.getElementById("resumeFile");
  const textEl = document.getElementById("fileDropText");
  if (!drop || !input || !textEl) return;

  function showFile() {
    const f = input.files && input.files[0];
    if (f) {
      textEl.textContent = f.name;
      drop.classList.add("has-file");
    } else {
      textEl.innerHTML = 'Drop your resume or <span class="file-drop-link">browse</span>';
      drop.classList.remove("has-file");
    }
  }
  input.addEventListener("change", showFile);

  ["dragenter", "dragover"].forEach(ev =>
    drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach(ev =>
    drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("dragover"); }));
  drop.addEventListener("drop", e => {
    if (e.dataTransfer && e.dataTransfer.files.length) {
      input.files = e.dataTransfer.files;
      showFile();
    }
  });
})();

// ── "Try a sample resume" — prefill so a new user can run it instantly ───────
(function initTryDemo() {
  const btn = document.getElementById("tryDemoBtn");
  if (!btn) return;
  const SAMPLE = `Jordan Rivera
Software Engineer — San Francisco, CA

EXPERIENCE
Senior Software Engineer, Brightlane (2021–2024)
- Built and shipped customer-facing features in React and TypeScript for a SaaS platform serving 40k users.
- Designed REST and GraphQL APIs in Node.js; cut average response time 38% by adding Redis caching.
- Led migration from a monolith to AWS (ECS, Lambda, RDS), improving deploy frequency from weekly to daily.

Software Engineer, Nova Labs (2019–2021)
- Developed internal tools with React, Express, and PostgreSQL.
- Wrote unit and integration tests (Jest), raising coverage from 45% to 82%.

SKILLS
JavaScript, TypeScript, React, Node.js, Express, PostgreSQL, AWS, Docker, REST, GraphQL, CI/CD

EDUCATION
BS Computer Science, UC Davis (2019)`;
  btn.addEventListener("click", () => {
    const ta = document.getElementById("resumeText");
    const jq = document.getElementById("jobQuery");
    if (ta) ta.value = SAMPLE;
    if (jq && !jq.value.trim()) jq.value = "Software Engineer";
    if (ta) ta.focus();
    btn.textContent = "✓ Sample loaded — hit Build My Profile";
    setTimeout(() => { btn.textContent = "✨ Try a sample resume"; }, 3000);
  });
})();

// ── Credential management ────────────────────────────────────────────────────

document.getElementById("addCredentialBtn").addEventListener("click", () => {
  const list = document.getElementById("credentialList");
  const n = list.children.length + 1;
  const entry = document.createElement("div");
  entry.className = "credential-entry";
  entry.innerHTML = `
    <div class="credential-entry-head">
      <span class="credential-entry-label">Credential ${n}</span>
      <button type="button" class="cred-remove-btn" aria-label="Remove">✕</button>
    </div>
    <input class="input-shell cred-name-field" type="text" placeholder="Name  (e.g. AWS Solutions Architect)" />
    <input class="input-shell cred-body-field" type="text" placeholder="Issuing body  (e.g. Amazon Web Services)" />
    <input class="input-shell cred-number-field" type="text" placeholder="Credential #  (e.g. AWS-SAA-C03-12345)" />
    <input class="input-shell cred-expiry-field" type="month" title="Expiration date (optional)" />
  `;
  entry.querySelector(".cred-remove-btn").addEventListener("click", () => {
    entry.remove();
    document.querySelectorAll(".credential-entry").forEach((el, i) => {
      const lbl = el.querySelector(".credential-entry-label");
      if (lbl) lbl.textContent = `Credential ${i + 1}`;
    });
  });
  list.appendChild(entry);
});

function collectCredentials() {
  return Array.from(document.querySelectorAll(".credential-entry"))
    .map(el => ({
      name:   el.querySelector(".cred-name-field")?.value.trim()   || "",
      body:   el.querySelector(".cred-body-field")?.value.trim()   || "",
      number: el.querySelector(".cred-number-field")?.value.trim() || "",
      expiry: el.querySelector(".cred-expiry-field")?.value.trim() || ""
    }))
    .filter(c => c.name || c.number);
}

// Stores the resolved resume text (paste or file) and a job lookup map
let currentResumeText = "";
const assessmentMap = new Map(); // job.id → full assessment object

analyzeForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const resumeText = document.getElementById("resumeText").value.trim();
  const resumeFile = document.getElementById("resumeFile").files[0];
  const jobQuery = document.getElementById("jobQuery").value.trim();
  lastJobQuery = jobQuery;
  const jobLocation = document.getElementById("jobLocation").value.trim();

  if (!resumeText && !resumeFile) {
    setStatus("error", "Please paste your resume or upload a file.");
    return;
  }
  if (!jobQuery) {
    setStatus("error", "Please enter a job title or keywords to search.");
    return;
  }

  const formData = new FormData();
  if (resumeFile) formData.append("resumeFile", resumeFile);
  if (resumeText) formData.append("resumeText", resumeText);
  formData.append("jobQuery", jobQuery);
  formData.append("location", jobLocation);
  formData.append("datePosted", document.getElementById("datePosted")?.value || "all");
  formData.append("employmentType", document.getElementById("employmentType")?.value || "");
  if (document.getElementById("remoteOnly")?.checked) formData.append("remoteOnly", "true");
  const credentials = collectCredentials();
  if (credentials.length) formData.append("credentials", JSON.stringify(credentials));
  if (document.getElementById("allowRecruiterSearch")?.checked) formData.append("allowRecruiterSearch", "true");

  setStatus("loading", "Searching live jobs and scoring your resume against each one. This can take up to a minute, hang tight…");
  analyzeBtn.disabled = true;

  try {
    const response = await fetch("/api/analyze", { method: "POST", body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Analysis failed.");
    currentResumeText = data.resumeText || resumeText;
    renderResults(data);
    setStatus("success", `Found ${data.stats.total} matching roles across all categories.`);
    // Fire event so auth module can show save-to-profile banner
    const topScore = (data.assessments || []).length
      ? Math.max(...data.assessments.map((a) => a.score || 0))
      : 0;
    window.dispatchEvent(new CustomEvent("hd:analysis-complete", { detail: {
      resumeText: currentResumeText,
      avgScore: data.stats.averageScore,
      topSkills: data.resumeSummary?.topSkills || [],
      jobQuery: lastJobQuery,
      topScore,
      assessments: data.assessments
    }}));
  } catch (err) {
    setStatus("error", err.message);
  } finally {
    analyzeBtn.disabled = false;
  }
});

function setStatus(mode, message) {
  analyzeMessage.textContent = message;
  const chipMap = { loading: "Working", success: "Done", error: "Error", neutral: "Ready" };
  const classMap = { loading: "loading", success: "success", error: "error", neutral: "neutral" };
  resumeChip.className = `status-chip ${classMap[mode] || "neutral"}`;
  resumeChip.textContent = chipMap[mode] || "Ready";
}

function renderResults(data) {
  const { resumeSummary, assessments, stats } = data;

  document.getElementById("candidateName").textContent = resumeSummary.name;
  document.getElementById("candidateTitle").textContent = resumeSummary.currentTitle;
  document.getElementById("candidateYears").textContent =
    resumeSummary.yearsExperience != null
      ? `${resumeSummary.yearsExperience} year${resumeSummary.yearsExperience !== 1 ? "s" : ""}`
      : "Not specified";
  document.getElementById("candidateEducation").textContent = resumeSummary.education || "Not specified";
  document.getElementById("candidateSkills").textContent =
    (resumeSummary.topSkills || []).join(", ") || "Not specified";

  document.getElementById("candidateStrengths").innerHTML = (resumeSummary.strengths || [])
    .map((s) => `<li>${s}</li>`)
    .join("");
  document.getElementById("candidateImprovements").innerHTML = (resumeSummary.improvements || [])
    .map((i) => `<li>${i}</li>`)
    .join("");

  const topScore = assessments.length ? Math.max(...assessments.map(a => a.score || 0)) : 0;
  saveScoreSession(lastJobQuery, topScore, resumeSummary.improvements || []);
  renderScoreHistory();

  // Claimed credentials
  const claimedCreds = resumeSummary.claimedCredentials || [];
  const credSection = document.getElementById("claimedCredentialsSection");
  if (claimedCreds.length) {
    document.getElementById("claimedCredentialsList").innerHTML = claimedCreds.map(c => {
      const hasNumber = c.number && c.number.trim();
      const expired = c.status === "expired";
      const pillClass = expired ? "cred-pill cred-pill--expired" : hasNumber ? "cred-pill cred-pill--verified" : "cred-pill cred-pill--no-number";
      const icon = expired ? "⚠" : hasNumber ? "🔑" : "○";
      const expiryText = c.expiry ? ` · exp ${c.expiry}` : "";
      const numberText = hasNumber ? `<span class="cred-number-tag"># ${escapeHtml(c.number)}</span>` : `<span class="cred-number-tag cred-number-missing">no number entered</span>`;
      return `
        <div class="${pillClass}">
          <span class="cred-pill-icon">${icon}</span>
          <div class="cred-pill-body">
            <span class="cred-pill-name">${escapeHtml(c.name || "Unknown")}${c.body ? ` <span class="cred-pill-body-name">· ${escapeHtml(c.body)}</span>` : ""}${expiryText}</span>
            ${numberText}
          </div>
        </div>`;
    }).join("");
    credSection.style.display = "block";
  } else {
    credSection.style.display = "none";
  }

  animateCount(document.getElementById("averageScore"), stats.averageScore);
  animateCount(document.getElementById("qualifiedCount"), stats.qualified);
  animateCount(document.getElementById("borderlineCount"), stats.borderline);
  animateCount(document.getElementById("stretchCount"), stats.stretch);
  document.getElementById("qualifiedBadge").textContent = stats.qualified;
  document.getElementById("borderlineBadge").textContent = stats.borderline;
  document.getElementById("stretchBadge").textContent = stats.stretch;

  assessmentMap.clear();
  assessments.forEach((a) => assessmentMap.set(a.job.id, a));

  renderLane("qualifiedLane", assessments.filter((a) => a.bucket === "qualified"),
    "No fully qualified matches in this search — check the other columns.");
  renderLane("borderlineLane", assessments.filter((a) => a.bucket === "borderline"),
    "No close-match roles found.");
  renderLane("stretchLane", assessments.filter((a) => a.bucket === "stretch"),
    "No stretch roles returned.");

  emptyState.style.display = "none";
  resultsState.classList.remove("results-hidden");
  animateScoreRings();
  resultsState.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Entrance animations (respect reduced-motion) ──────────────────────────────

const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function animateCount(el, target) {
  if (!el) return;
  target = Number(target) || 0;
  if (prefersReducedMotion()) { el.textContent = target; return; }
  const duration = 700, start = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(eased * target);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Fill each score ring from 0 → its real value, and count the centered number up.
function animateScoreRings() {
  const rings = document.querySelectorAll(".score-ring[data-pct]");
  const apply = () => rings.forEach((ring) => {
    ring.style.setProperty("--pct", `${ring.dataset.pct}%`);
    animateCount(ring.querySelector(".score-ring-value[data-count]"),
      ring.querySelector(".score-ring-value")?.dataset.count);
  });
  if (prefersReducedMotion()) { apply(); return; }
  // Two rAFs so the 0% start value is painted before transitioning up.
  requestAnimationFrame(() => requestAnimationFrame(apply));
}

function renderLane(containerId, items, emptyMessage) {
  const container = document.getElementById(containerId);
  container.innerHTML = items.length
    ? items.map(renderJobCard).join("")
    : `<div class="empty-card">${emptyMessage}</div>`;
}

function renderJobCard(assessment) {
  const { job, score, bucket, reason, matchedSkills, missingSkills, gapPlan, credentialMatches } = assessment;

  const salary = formatSalary(job);

  const gapMarkup =
    gapPlan && gapPlan.length
      ? `<div class="candidate-detail">
          <p class="detail-title">Gap-Closing Plan</p>
          <p class="detail-copy">${gapPlan.map((step) => `• ${step}`).join("<br>")}</p>
        </div>`
      : "";

  const credMatchMarkup = (() => {
    if (!credentialMatches || !credentialMatches.length) return "";
    const rows = credentialMatches.map(cm => {
      if (cm.claimed && cm.credentialNumber) {
        return `<div class="cred-match-row cred-match--claimed">
          <span class="cred-match-icon">🔑</span>
          <span class="cred-match-name">${escapeHtml(cm.required)}</span>
          <span class="cred-match-number"># ${escapeHtml(cm.credentialNumber)}</span>
          <span class="cred-match-status">claimed · unverified</span>
        </div>`;
      } else if (cm.claimed) {
        return `<div class="cred-match-row cred-match--claimed-no-number">
          <span class="cred-match-icon">○</span>
          <span class="cred-match-name">${escapeHtml(cm.required)}</span>
          <span class="cred-match-status">claimed · no number</span>
        </div>`;
      } else {
        return `<div class="cred-match-row cred-match--missing">
          <span class="cred-match-icon">✗</span>
          <span class="cred-match-name">${escapeHtml(cm.required)}</span>
          <span class="cred-match-status">not claimed</span>
        </div>`;
      }
    }).join("");
    return `<div class="cred-matches-block">
      <p class="cred-matches-label">Credential Requirements</p>
      ${rows}
    </div>`;
  })();

  const applyButton = job.applyUrl
    ? `<a href="${escapeAttr(job.applyUrl)}" target="_blank" rel="noopener noreferrer" class="button-link">Apply Now ↗</a>`
    : "";

  const logAppBtn = `<button
    class="button-link hd-log-app-btn"
    style="background:rgba(37,99,235,0.12);border:1px solid rgba(37,99,235,0.22);border-radius:8px;padding:6px 12px;cursor:pointer;color:#60a5fa;font-size:0.78rem;font-weight:600;"
    data-job-title="${escapeAttr(job.title || "")}"
    data-company="${escapeAttr(job.company || "")}"
    data-apply-url="${escapeAttr(job.applyUrl || "")}"
    data-score="${score}"
    data-matched-skills="${escapeAttr(JSON.stringify(matchedSkills || []))}"
    data-missing-skills="${escapeAttr(JSON.stringify(missingSkills || []))}"
  >+ Log Application</button>`;

  const remotePill = job.isRemote
    ? `<span class="remote-pill">Remote</span>`
    : "";

  const matchedHtml = (matchedSkills || []).length
    ? matchedSkills.map((s) => `<span class="skill-chip chip--matched">${escapeHtml(s)}</span>`).join("")
    : `<span class="skill-chip chip--none">None identified</span>`;

  const missingHtml = (missingSkills || []).length
    ? missingSkills.map((s) => `<span class="skill-chip chip--missing">${escapeHtml(s)}</span>`).join("")
    : `<span class="skill-chip chip--ok">None — you're a great fit!</span>`;

  return `
    <section class="candidate-card ${bucket}">
      <div class="candidate-top">
        <div class="candidate-top-info">
          <p class="candidate-name">${escapeHtml(job.title)}</p>
          <p class="candidate-role">${escapeHtml(job.company)} · ${escapeHtml(job.location)} ${remotePill}</p>
          ${salary ? `<p class="candidate-role salary-line">${salary}</p>` : ""}
        </div>
        <div class="score-ring ${bucket}" style="--pct:0%" data-pct="${score}" aria-label="Match score: ${score}">
          <span class="score-ring-value ${bucket}" data-count="${score}">0</span>
        </div>
      </div>

      <p class="candidate-reason">${escapeHtml(reason)}</p>

      <div class="candidate-skills-block">
        <div class="skills-group-header">
          <span class="skills-group-label matched">✓ Matched</span>
          <div class="skill-chips">${matchedHtml}</div>
        </div>
        <div class="skills-group-header">
          <span class="skills-group-label missing">✕ Missing</span>
          <div class="skill-chips">${missingHtml}</div>
        </div>
      </div>

      ${credMatchMarkup}
      ${gapMarkup ? `<div class="candidate-grid">${gapMarkup}</div>` : ""}

      <div class="action-row">
        ${applyButton}
        ${logAppBtn}
        <button
          class="action-button tailor-action"
          onclick="tailorResume('${escapeAttr(job.id)}', this)"
        >✦ Tailor My Resume</button>
        <button
          class="action-button secondary-action"
          onclick="copyToClipboard('${escapeAttr(job.title)} at ${escapeAttr(job.company)}', this)"
        >Copy Title</button>
      </div>
    </section>
  `;
}

// ── Tailor resume ────────────────────────────────────────────────────────────

const TAILOR_CACHE_KEY = (jobId) => `hd_tailor_${jobId}`;

async function tailorResume(jobId, button) {
  const card = button.closest(".candidate-card");

  // Toggle off if already open
  const existing = card.querySelector(".tailor-panel");
  if (existing) {
    existing.remove();
    button.textContent = "✦ Tailor My Resume";
    button.classList.remove("tailor-action--active");
    return;
  }

  if (!currentResumeText) {
    button.textContent = "Paste your resume first";
    setTimeout(() => (button.textContent = "✦ Tailor My Resume"), 2500);
    return;
  }

  const assessment = assessmentMap.get(jobId);
  if (!assessment) return;

  // Check localStorage cache first — skip API call if already tailored
  const cached = localStorage.getItem(TAILOR_CACHE_KEY(jobId));
  if (cached) {
    try {
      const data = JSON.parse(cached);
      // Discard old-format cache (had flat `bullets`, no `sections`) so we re-fetch with new format
      if (data.bullets && !data.sections) {
        localStorage.removeItem(TAILOR_CACHE_KEY(jobId));
      } else {
        renderTailorPanel(card, data, assessment.job);
        button.textContent = "✦ Hide Tailored";
        button.classList.add("tailor-action--active");
        return;
      }
    } catch { /* cache corrupted — fall through to API */ }
  }

  button.disabled = true;
  button.textContent = "Tailoring…";

  try {
    const response = await fetch("/api/tailor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resumeText: currentResumeText,
        jobTitle: assessment.job.title,
        company: assessment.job.company,
        jobDescription: assessment.job.description || "",
        matchedSkills: assessment.matchedSkills || [],
        missingSkills: assessment.missingSkills || []
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Tailoring failed.");

    // Cache the result so it survives refresh
    try { localStorage.setItem(TAILOR_CACHE_KEY(jobId), JSON.stringify(data)); } catch { /* quota */ }

    renderTailorPanel(card, data, assessment.job);
    button.textContent = "✦ Hide Tailored";
    button.classList.add("tailor-action--active");
  } catch (err) {
    button.textContent = "Failed — try again";
    setTimeout(() => {
      button.textContent = "✦ Tailor My Resume";
      button.classList.remove("tailor-action--active");
    }, 2500);
  } finally {
    button.disabled = false;
  }
}

function buildTailorPlainText(data, job) {
  const sep = "─".repeat(52);
  const lines = [
    "TAILORED RESUME CONTENT",
    `Generated by PathAscent for ${job.company} — ${job.title}`,
    sep,
    "",
  ];

  if (data.summary) {
    lines.push("PROFESSIONAL SUMMARY", data.summary, "");
  }

  // New format: sections with {label, bullets:[{original, rewritten}]}
  if (data.sections?.length) {
    lines.push(sep, "EXPERIENCE BULLETS (paste into your resume)", "");
    for (const sec of data.sections) {
      lines.push(sec.label || "Experience");
      for (const b of sec.bullets || []) {
        lines.push(`  • ${b.rewritten || b.original || ""}`);
      }
      lines.push("");
    }
  // Old/cached format: flat bullets array — backward compat
  } else if (data.bullets?.length) {
    lines.push(sep, "EXPERIENCE BULLETS (paste into your resume)", "");
    for (const b of data.bullets) {
      lines.push(`  • ${String(b).replace(/^[•\-]\s*/, "")}`);
    }
    lines.push("");
  }

  if (data.certRoadmap?.length) {
    lines.push(sep, "QUALIFICATIONS TO BUILD", "");
    for (const c of data.certRoadmap) {
      lines.push(`• ${c.cert} — ${c.provider}`);
      lines.push(`  Cost: ${c.estimatedCost}  ·  Time: ${c.estimatedTime}`);
      lines.push(`  ${c.searchUrl}`, "");
    }
  }

  return lines.join("\n");
}

function renderTailorPanel(card, data, job) {
  const panel = document.createElement("div");
  panel.className = "tailor-panel";

  // ── Summary diff ──
  const summaryHtml = data.summary ? `
    <div class="tailor-block">
      <p class="tailor-block-label">Professional Summary</p>
      ${data.originalSummary ? `
        <div class="diff-pair">
          <div class="diff-original">
            <span class="diff-tag diff-tag--was">was</span>
            <span class="diff-text">${escapeHtml(data.originalSummary)}</span>
          </div>
          <div class="diff-divider">↓</div>
          <div class="diff-rewritten">
            <span class="diff-tag diff-tag--now">now</span>
            <span class="diff-text">${escapeHtml(data.summary)}</span>
          </div>
        </div>` : `<p class="tailor-summary">${escapeHtml(data.summary)}</p>`}
    </div>` : "";

  // ── Section bullet diffs ──
  const sectionsHtml = (data.sections || []).map((sec) => `
    <div class="tailor-section">
      <p class="tailor-section-label">${escapeHtml(sec.label || "Experience")}</p>
      ${(sec.bullets || []).map((b) => `
        <div class="diff-pair">
          <div class="diff-original">
            <span class="diff-tag diff-tag--was">was</span>
            <span class="diff-text">${escapeHtml(b.original || "")}</span>
          </div>
          <div class="diff-divider">↓</div>
          <div class="diff-rewritten">
            <span class="diff-tag diff-tag--now">now</span>
            <span class="diff-text">${escapeHtml(b.rewritten || "")}</span>
          </div>
        </div>`).join("")}
    </div>`).join("");

  // ── Cert roadmap ──
  const certHtml = (data.certRoadmap || []).length ? `
    <div class="cert-roadmap">
      <p class="tailor-block-label">Close the Gap — Qualifications to Build</p>
      <div class="cert-card-grid">
        ${data.certRoadmap.map((c) => `
          <div class="cert-card">
            <div class="cert-card-top">
              <p class="cert-card-name">${escapeHtml(c.cert)}</p>
              <span class="cert-card-provider">${escapeHtml(c.provider)}</span>
            </div>
            <div class="cert-card-meta">
              <span class="cert-meta-item">💰 ${escapeHtml(c.estimatedCost)}</span>
              <span class="cert-meta-item">⏱ ${escapeHtml(c.estimatedTime)}</span>
            </div>
            <a href="${escapeAttr(c.searchUrl)}" target="_blank" rel="noopener noreferrer"
               class="cert-card-link">Find this cert ↗</a>
          </div>`).join("")}
      </div>
    </div>` : "";

  const plainText = buildTailorPlainText(data, job);
  const safeFilename = job.company.replace(/[^a-z0-9]/gi, "_").toLowerCase() + "_tailored.txt";

  panel.innerHTML = `
    <div class="tailor-header">
      <div class="tailor-header-left">
        <span class="tailor-badge">✦ Tailored for ${escapeHtml(job.company)}</span>
        <p class="tailor-note">Each bullet shows what changed — paste the "now" versions into your resume.</p>
      </div>
      <div class="tailor-header-actions">
        <button class="action-button secondary-action js-tailor-copy">Copy All</button>
        <button class="action-button secondary-action js-tailor-download">Download .txt</button>
      </div>
    </div>
    ${summaryHtml}
    ${sectionsHtml}
    ${certHtml}
  `;

  // Bind events directly — avoids the double-quote / onclick-attribute conflict
  panel.querySelector(".js-tailor-copy").addEventListener("click", async function () {
    try {
      await navigator.clipboard.writeText(plainText);
      const orig = this.textContent;
      this.textContent = "Copied!";
      setTimeout(() => (this.textContent = orig), 1800);
    } catch {
      this.textContent = "Copy failed";
    }
  });

  panel.querySelector(".js-tailor-download").addEventListener("click", function () {
    const btn = this;
    try {
      // data: URI approach — works without blob: URL support or CSP issues
      const a = document.createElement("a");
      a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(plainText);
      a.download = safeFilename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      btn.textContent = "Downloaded ✓";
      setTimeout(() => (btn.textContent = "Download .txt"), 2000);
    } catch (err) {
      // Fallback: open text in a new tab so the user can File → Save
      console.warn("Download failed, opening in new tab:", err);
      const win = window.open("", "_blank");
      if (win) {
        win.document.write("<pre style='font-family:monospace;padding:20px;white-space:pre-wrap'>"
          + plainText.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</pre>");
        win.document.title = safeFilename;
        win.document.close();
      } else {
        btn.textContent = "Pop-ups blocked — use Copy All";
        setTimeout(() => (btn.textContent = "Download .txt"), 3000);
      }
    }
  });

  card.appendChild(panel);
}

function formatSalary(job) {
  if (!job.salaryMin && !job.salaryMax) return "";
  const fmt = (n) => n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${n}`;
  const period = job.salaryPeriod === "YEAR" || !job.salaryPeriod ? "/yr" : `/${job.salaryPeriod.toLowerCase()}`;
  if (job.salaryMin && job.salaryMax) return `${fmt(job.salaryMin)}–${fmt(job.salaryMax)}${period}`;
  if (job.salaryMin) return `From ${fmt(job.salaryMin)}${period}`;
  return `Up to ${fmt(job.salaryMax)}${period}`;
}

async function copyToClipboard(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = "Copied!";
    setTimeout(() => (button.textContent = original), 1800);
  } catch {
    // clipboard unavailable
  }
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return String(str ?? "").replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

// ── Score history ─────────────────────────────────────────────────────────────

function saveScoreSession(jobQuery, topScore, improvements) {
  let history = [];
  try { history = JSON.parse(localStorage.getItem(SCORE_HISTORY_KEY) || "[]"); } catch { /* ignore */ }
  history.unshift({ timestamp: new Date().toISOString(), jobQuery, topScore, improvements });
  if (history.length > 20) history = history.slice(0, 20);
  try { localStorage.setItem(SCORE_HISTORY_KEY, JSON.stringify(history)); } catch { /* quota */ }
}

const normalizeQuery = (q) => String(q || "").trim().toLowerCase();
const bucketForScore = (s) => (s >= 75 ? "qualified" : s >= 50 ? "borderline" : "stretch");

// Build an inline SVG sparkline from an ordered (oldest→newest) score series.
function buildSparkline(scores) {
  const w = 232, h = 46, pad = 5;
  if (scores.length < 2) return "";
  const min = Math.min(...scores, 0);
  const max = Math.max(...scores, 100);
  const span = max - min || 1;
  const stepX = (w - pad * 2) / (scores.length - 1);
  const pts = scores.map((s, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((s - min) / span) * (h - pad * 2);
    return [x, y];
  });
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts.at(-1)[0].toFixed(1)},${h - pad} L${pts[0][0].toFixed(1)},${h - pad} Z`;
  const last = pts.at(-1);
  const cls = bucketForScore(scores.at(-1));
  return `
    <svg class="sparkline ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-hidden="true">
      <path class="spark-area" d="${area}" />
      <path class="spark-line" d="${line}" pathLength="1" />
      <circle class="spark-dot" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.2" />
    </svg>`;
}

function loadLocalHistory() {
  try { return JSON.parse(localStorage.getItem(SCORE_HISTORY_KEY) || "[]"); } catch { return []; }
}

// Render the score-history panel. Pass a history array (newest-first) to render a
// specific source; omit it to read this device's localStorage. `synced` flags that
// the data came from the user's account (shown across devices).
function renderScoreHistory(history, { synced = false } = {}) {
  const panel = document.getElementById("scoreHistoryPanel");
  const list = document.getElementById("scoreHistoryList");
  if (!panel || !list) return;
  if (!Array.isArray(history)) history = loadLocalHistory();
  if (!history.length) { panel.style.display = "none"; return; }
  panel.style.display = "";

  // ── Per-role trend: only compare runs for the SAME role (apples to apples) ──
  const latestQuery = normalizeQuery(history[0].jobQuery);
  const sameRole = history
    .filter((h) => normalizeQuery(h.jobQuery) === latestQuery)
    .slice()
    .reverse(); // oldest → newest
  const series = sameRole.map((h) => h.topScore || 0);

  let trendHtml = "";
  if (series.length >= 2) {
    const latest = series.at(-1);
    const prev = series.at(-2);
    const delta = latest - prev;
    const dirClass = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "—";
    trendHtml = `
      <div class="score-trend">
        <div class="score-trend-head">
          <span class="score-trend-role" title="${escapeAttr(history[0].jobQuery || "")}">${escapeHtml(history[0].jobQuery || "Role")}</span>
          <span class="trend-delta trend-delta--${dirClass}">${arrow} ${delta > 0 ? "+" : ""}${delta}</span>
        </div>
        ${buildSparkline(series)}
        <p class="score-trend-caption">${series.length} runs · best fit now <strong>${latest}</strong>${synced ? ` · <span class="score-trend-synced">☁ synced</span>` : ""}</p>
      </div>`;
  } else {
    trendHtml = `<p class="score-trend-hint">Re-scan <strong>${escapeHtml(history[0].jobQuery || "this role")}</strong> after editing your resume to watch your fit score climb.</p>`;
  }

  // ── Full recent list (all roles), de-emphasized below the trend ──
  const listHtml = history.map(({ timestamp, jobQuery, topScore }) => {
    const date = new Date(timestamp);
    const label = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `<li class="score-history-item">
      <span class="score-history-date">${label}</span>
      <span class="score-history-query">${escapeHtml(jobQuery || "—")}</span>
      <span class="rank-score ${bucketForScore(topScore)}" style="font-size:.75rem;padding:.1rem .35rem">${topScore}</span>
    </li>`;
  }).join("");

  list.innerHTML = `${trendHtml}<div class="score-history-rows">${listHtml}</div>`;
}

// For logged-in users, render the trend from account-saved snapshots so it syncs
// across devices. Anonymous (or on any error) → this device's localStorage.
async function refreshScoreHistory() {
  const token = (() => { try { return localStorage.getItem("hd_token"); } catch { return null; } })();
  if (!token) { renderScoreHistory(); return; }
  try {
    const res = await fetch("/api/user/snapshots", { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error("snapshots fetch failed");
    const { snapshots = [] } = await res.json();
    // Only snapshots that carry the per-role fields can drive the trend.
    const usable = snapshots
      .filter((s) => s.jobQuery && Number.isFinite(s.topScore))
      .map((s) => ({ timestamp: s.createdAt, jobQuery: s.jobQuery, topScore: s.topScore }))
      .reverse(); // API returns oldest→newest; panel wants newest-first
    if (usable.length) { renderScoreHistory(usable, { synced: true }); return; }
  } catch { /* fall through to local */ }
  renderScoreHistory();
}

// Expose so the auth/save flow in index.html can re-sync after login or save.
window.refreshScoreHistory = refreshScoreHistory;

refreshScoreHistory();
