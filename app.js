const analyzeForm = document.getElementById("analyzeForm");
const analyzeBtn = document.getElementById("analyzeBtn");
const analyzeMessage = document.getElementById("analyzeMessage");
const resumeChip = document.getElementById("resumeChip");
const emptyState = document.getElementById("emptyState");
const resultsState = document.getElementById("resultsState");

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
  const credentials = collectCredentials();
  if (credentials.length) formData.append("credentials", JSON.stringify(credentials));

  setStatus("loading", "Searching live job listings and analyzing your resume — this takes about 15–20 seconds…");
  analyzeBtn.disabled = true;

  try {
    const response = await fetch("/api/analyze", { method: "POST", body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Analysis failed.");
    currentResumeText = data.resumeText || resumeText;
    renderResults(data);
    setStatus("success", `Found ${data.stats.total} matching roles across all categories.`);
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

  document.getElementById("averageScore").textContent = stats.averageScore;
  document.getElementById("qualifiedCount").textContent = stats.qualified;
  document.getElementById("borderlineCount").textContent = stats.borderline;
  document.getElementById("stretchCount").textContent = stats.stretch;
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
  resultsState.scrollIntoView({ behavior: "smooth", block: "start" });
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
        <div class="score-ring ${bucket}" style="--pct:${score}%" aria-label="Match score: ${score}">
          <span class="score-ring-value ${bucket}">${score}</span>
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
    `Generated by HiringDesk for ${job.company} — ${job.title}`,
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
