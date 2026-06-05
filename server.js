import "dotenv/config";   // no-op if vars already set via --env-file or Electron
import express from "express";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import nodemailer from "nodemailer";
import { fileURLToPath, pathToFileURL } from "url";
import path from "path";
import { createRequire } from "module";
import { saveJobAndCandidates, getPastCandidates, getCandidateCount } from "./db.js";
import rateLimit from "express-rate-limit";

const _require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json({ limit: "5mb" }));

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Protects against API abuse and runaway Anthropic billing.

// Heavy AI endpoints — 10 requests per 15 minutes per IP
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a few minutes and try again." }
});

// Light endpoints (notify, past-match, webhook proxy) — 30 per 15 minutes per IP
const lightLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a few minutes and try again." }
});

app.use("/api/analyze",              aiLimiter);
app.use("/api/tailor",               aiLimiter);
app.use("/api/recruiter/rank",       aiLimiter);
app.use("/api/recruiter/notify",     lightLimiter);
app.use("/api/recruiter/past-match", lightLimiter);
app.use("/api/integrations",         lightLimiter);

// Home page — must be before express.static so it intercepts "/"
// (express.static defaults "/" to index.html; we want home.html)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "home.html"));
});

app.use(express.static(__dirname));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const JSEARCH_KEY = process.env.JSEARCH_API_KEY;
const JSEARCH_HOST = "jsearch.p.rapidapi.com";

// ─────────────────────────────────────────────
//  SHARED HELPERS
// ─────────────────────────────────────────────

async function extractTextFromBuffer(buffer, originalname) {
  const ext = path.extname(originalname).toLowerCase();

  if ([".txt", ".md", ".html", ".htm"].includes(ext)) {
    return buffer.toString("utf-8");
  }

  if (ext === ".pdf") {
    try {
      // pdfjs-dist (pure JS, no native compilation)
      // Resolve absolute paths so the worker import works regardless of cwd
      const pdfJsEntry  = _require.resolve("pdfjs-dist/legacy/build/pdf.mjs");
      const pdfJsWorker = pdfJsEntry.replace("pdf.mjs", "pdf.worker.mjs");
      const pdfjsLib    = await import(pathToFileURL(pdfJsEntry).href);
      pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(pdfJsWorker).href;

      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;

      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page    = await pdf.getPage(i);
        const content = await page.getTextContent();
        const text    = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (text) pages.push(text);
      }

      return pages.join("\n\n") || null;
    } catch (err) {
      console.error("PDF extract error:", err.message);
      return null;
    }
  }

  return null;
}

// ─────────────────────────────────────────────
//  APPLICANT SIDE
// ─────────────────────────────────────────────

async function searchJobs(query, location, numResults = 10) {
  const searchQuery = location ? `${query} in ${location}` : query;
  const params = new URLSearchParams({
    query: searchQuery,
    page: "1",
    num_pages: "1",
    results_per_page: String(numResults),
    date_posted: "all"
  });

  const response = await fetch(`https://${JSEARCH_HOST}/search?${params}`, {
    headers: {
      "X-RapidAPI-Key": JSEARCH_KEY,
      "X-RapidAPI-Host": JSEARCH_HOST
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Job search failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  return (data.data || []).map((job) => ({
    id: job.job_id,
    title: job.job_title,
    company: job.employer_name || "Unknown Company",
    location: job.job_city
      ? `${job.job_city}${job.job_state ? ", " + job.job_state : ""}`
      : job.job_country || "Not specified",
    isRemote: job.job_is_remote || false,
    description: (job.job_description || "").slice(0, 1500),
    applyUrl: job.job_apply_link || "",
    salaryMin: job.job_min_salary || null,
    salaryMax: job.job_max_salary || null,
    salaryCurrency: job.job_salary_currency || "USD",
    salaryPeriod: job.job_salary_period || null,
    requiredSkills: job.job_required_skills || [],
    requiredExperience: job.job_required_experience?.required_experience_in_months
      ? Math.round(job.job_required_experience.required_experience_in_months / 12)
      : null
  }));
}

async function analyzeResume(resumeText, jobs, credentials = []) {
  const jobsPayload = jobs.map((j) => ({
    id: j.id,
    title: j.title,
    company: j.company,
    description: j.description,
    requiredSkills: j.requiredSkills,
    requiredYears: j.requiredExperience
  }));

  const credentialsBlock = credentials.length > 0
    ? `\nCANDIDATE'S CLAIMED CREDENTIALS (official numbers provided — stronger signal than resume text):\n` +
      credentials.map(c => [
        c.name,
        c.body   ? `Issued by: ${c.body}`      : null,
        c.number ? `Credential #: ${c.number}` : null,
        c.expiry ? `Expires: ${c.expiry}`       : null
      ].filter(Boolean).join(" | ")).join("\n") + "\n"
    : "";

  const credInstructions = credentials.length > 0
    ? `claimedCredentials in resumeSummary: include every credential from the CLAIMED CREDENTIALS section above with status "valid", "expired" (if expiry is in the past), or "no_number_provided" (if no credential number was given).
credentialMatches in each jobMatch: for every certification mentioned in the job description or required skills, add an entry — claimed:true if the candidate provided that credential (with credentialNumber and expiry if available), claimed:false if not. A credential with a specific number is stronger evidence than resume text alone — give it a small score boost.`
    : `claimedCredentials: return [].
credentialMatches: return [].`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: "You are an expert career coach and resume analyst. Return only valid JSON with no markdown fences or extra text.",
    messages: [
      {
        role: "user",
        content: `Analyze this resume against the provided job listings.

RESUME:
${resumeText}
${credentialsBlock}
JOB LISTINGS:
${JSON.stringify(jobsPayload, null, 2)}

Return a JSON object with this exact structure:
{
  "resumeSummary": {
    "name": "candidate full name, or 'Candidate' if not found",
    "currentTitle": "most recent job title",
    "yearsExperience": <integer>,
    "topSkills": ["up to 8 most relevant skills"],
    "education": "highest degree and field, e.g. BS Computer Science",
    "strengths": ["3 specific professional strengths based on resume content"],
    "improvements": ["3 specific, actionable resume improvements — e.g. 'Add quantified metrics to your Product Manager role at Acme'"],
    "claimedCredentials": [
      {
        "name": "credential name",
        "body": "issuing body",
        "number": "credential number or empty string",
        "expiry": "expiry date or empty string",
        "status": "valid" | "expired" | "no_number_provided"
      }
    ]
  },
  "jobMatches": [
    {
      "jobId": "<job id>",
      "score": <0-100>,
      "bucket": "qualified" | "borderline" | "stretch",
      "reason": "2-3 honest sentences on fit",
      "matchedSkills": ["skills from resume that match this role"],
      "missingSkills": ["skills required by the role not on resume"],
      "gapPlan": ["3 specific steps to close the gap — tools, courses, projects, certifications"],
      "credentialMatches": [
        {
          "required": "cert name from job description",
          "claimed": true | false,
          "credentialNumber": "number string or null",
          "expiry": "expiry string or null"
        }
      ]
    }
  ]
}

Scoring: 75-100 → qualified | 45-74 → borderline | 0-44 → stretch
Be honest. Prefer concrete technical skills over soft skills.
${credInstructions}`
      }
    ]
  });

  const text = message.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI returned an unparseable response. Please try again.");
  return JSON.parse(jsonMatch[0]);
}

app.post("/api/analyze", upload.single("resumeFile"), async (req, res) => {
  try {
    if (!JSEARCH_KEY) return res.status(500).json({ error: "JSEARCH_API_KEY is not configured on the server." });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server." });

    let resumeText = (req.body.resumeText || "").trim();

    if (req.file) {
      const extracted = await extractTextFromBuffer(req.file.buffer, req.file.originalname);
      if (extracted) resumeText = resumeText || extracted;
      else if (!resumeText) {
        return res.status(400).json({ error: "Could not read that file type. Please paste your resume text instead." });
      }
    }

    if (!resumeText) return res.status(400).json({ error: "Please paste your resume text or upload a supported file." });

    const jobQuery = (req.body.jobQuery || "").trim();
    if (!jobQuery) return res.status(400).json({ error: "Please enter a job title or keywords to search." });

    const location = (req.body.location || "").trim();

    let credentials = [];
    try { credentials = JSON.parse(req.body.credentials || "[]"); } catch { credentials = []; }

    let jobs;
    try {
      jobs = await searchJobs(jobQuery, location, 10);
    } catch (err) {
      return res.status(502).json({ error: `Job search failed: ${err.message}` });
    }

    if (!jobs.length) {
      return res.status(404).json({ error: "No jobs found for that search. Try broader keywords or a different location." });
    }

    const analysis = await analyzeResume(resumeText, jobs, credentials);

    const assessments = analysis.jobMatches
      .map((match) => ({ ...match, job: jobs.find((j) => j.id === match.jobId) }))
      .filter((a) => a.job);

    const qualified = assessments.filter((a) => a.bucket === "qualified").length;
    const borderline = assessments.filter((a) => a.bucket === "borderline").length;
    const stretch = assessments.filter((a) => a.bucket === "stretch").length;
    const averageScore = assessments.length
      ? Math.round(assessments.reduce((sum, a) => sum + a.score, 0) / assessments.length)
      : 0;

    res.json({
      resumeText,
      resumeSummary: analysis.resumeSummary,
      assessments,
      stats: { total: assessments.length, qualified, borderline, stretch, averageScore }
    });
  } catch (err) {
    console.error("Applicant analyze error:", err);
    res.status(500).json({ error: err.message || "An unexpected error occurred." });
  }
});

app.post("/api/tailor", express.json(), async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server." });
    }

    const { resumeText, jobTitle, company, jobDescription, matchedSkills = [], missingSkills = [] } = req.body;

    if (!resumeText) return res.status(400).json({ error: "Resume text is required." });
    if (!jobTitle)   return res.status(400).json({ error: "Job title is required." });

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3500,
      system: "You are an expert resume writer and career coach. Return only valid JSON with no markdown fences or extra text.",
      messages: [{
        role: "user",
        content: `Analyze this resume against the target job and return a structured tailoring package.

RESUME:
${resumeText.slice(0, 3500)}

TARGET JOB:
Title: ${jobTitle}
Company: ${company || "the company"}
Description: ${(jobDescription || "").slice(0, 1200)}

ALREADY MATCHED SKILLS: ${matchedSkills.join(", ") || "none listed"}
MISSING SKILLS (gaps to address): ${missingSkills.join(", ") || "none listed"}

RULES for rewriting:
- Never invent roles, companies, or skills not present in the resume
- Use strong action verbs: Led, Built, Reduced, Increased, Shipped, Automated, Designed, Drove
- Add plausible quantified metrics wherever the resume implies measurable impact
- Weave in matched skills naturally; address missing skills by reframing existing experience where honest
- Keep each bullet to one line
- For certRoadmap: only include entries for skills in the MISSING SKILLS list above; if list is empty return []

Return this exact JSON structure:

{
  "originalSummary": "The candidate's existing professional summary/objective verbatim from the resume, or null if not present",
  "summary": "New 2–3 sentence professional summary targeting this specific role at this company. Lead with the candidate's identity, name 2–3 strongest relevant skills, end with what unique value they bring.",
  "sections": [
    {
      "label": "Company Name · Job Title, YYYY–YYYY",
      "bullets": [
        {
          "original": "Verbatim bullet from resume (or closest paraphrase if not exact)",
          "rewritten": "Improved: Action verb + specific achievement + measurable result targeting this role"
        }
      ]
    }
  ],
  "certRoadmap": [
    {
      "skill": "Exact missing skill name",
      "cert": "Full official certification name",
      "provider": "Certifying body (e.g. AWS, Google, CompTIA, PMI, CNCF)",
      "estimatedCost": "$XXX",
      "estimatedTime": "X–Y weeks of study",
      "searchUrl": "https://www.google.com/search?q=<url-encoded cert name and provider>"
    }
  ]
}

Include 2–3 bullets per section for the 2 most relevant experience sections only. No preamble — just the JSON.`
      }]
    });

    const text = message.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: "AI returned an unparseable response. Please try again." });

    const result = JSON.parse(jsonMatch[0]);
    res.json(result);
  } catch (err) {
    console.error("Tailor error:", err);
    res.status(500).json({ error: err.message || "Tailoring failed." });
  }
});

// ─────────────────────────────────────────────
//  RECRUITER SIDE
// ─────────────────────────────────────────────

async function rankCandidatesForJob(job, resumes) {
  const candidateBlocks = resumes
    .map((text, i) => `[CANDIDATE ${i}]\n${text.slice(0, 1800)}`)
    .join("\n\n---\n\n");

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: "You are a senior technical recruiter. Rank candidates strictly by fit. Return only valid JSON with no markdown fences.",
    messages: [
      {
        role: "user",
        content: `Rank ALL of these candidates for the following job and return the top 25 (or all, if fewer than 25), ordered from best to worst fit.

JOB REQUIREMENTS:
Title: ${job.title}
Department: ${job.department || "Not specified"}
Location: ${job.location || "Any / Remote"}
Required Skills: ${job.requiredSkills || "Not specified"}
Required Certifications: ${job.requiredCertifications || "None"}
Minimum Experience: ${job.minYearsExp || 0} years
Additional Notes: ${job.additionalNotes || "None"}

CANDIDATES (${resumes.length} total):
${candidateBlocks}

Return JSON with this exact structure:
{
  "rankedCandidates": [
    {
      "resumeIndex": <number matching [CANDIDATE N] above>,
      "name": "full name or 'Unknown'",
      "currentTitle": "most recent job title",
      "location": "city/state if found in resume",
      "contactInfo": "email or phone if found — critically important",
      "yearsExperience": <integer>,
      "score": <0-100>,
      "tier": "high_priority" | "qualified" | "review",
      "matchedSkills": ["required skills found on this resume"],
      "missingSkills": ["required skills NOT found on this resume"],
      "matchedCertifications": ["required certs this candidate holds"],
      "missingCertifications": ["required certs this candidate lacks"],
      "reason": "2 concise sentences: why this ranking, key strengths/gaps"
    }
  ]
}

Scoring guide:
85–100 → high_priority: meets all or nearly all requirements
60–84 → qualified: solid fit with minor gaps
0–59 → review: significant gaps but some merit

Strictly penalize missing required certifications.
Factor in location proximity to job location: ${job.location || "not specified"}.
Return up to 25 best candidates only, ranked best-to-worst.`
      }
    ]
  });

  const text = message.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI returned an unparseable ranking response. Please try again.");
  return JSON.parse(jsonMatch[0]);
}

function buildEmailReport(job, candidates) {
  const scoreColor = (s) => (s >= 85 ? "#1f8f63" : s >= 60 ? "#cb7a18" : "#c4495f");

  const rows = candidates
    .map(
      (c, i) => `
    <tr style="background:${i % 2 === 0 ? "#f8f7f4" : "#ffffff"}">
      <td style="padding:12px 16px;font-weight:800;color:#1f2933;font-size:1.1rem">#${i + 1}</td>
      <td style="padding:12px 16px">
        <p style="margin:0;font-weight:700;font-size:1rem;color:#1f2933">${c.name}</p>
        <p style="margin:4px 0 0;color:#5f6873;font-size:0.88rem">${c.currentTitle}</p>
      </td>
      <td style="padding:12px 16px;color:#5f6873;font-size:0.9rem">${c.location || "—"}</td>
      <td style="padding:12px 16px;color:#5f6873;font-size:0.9rem">${c.yearsExperience != null ? c.yearsExperience + " yrs" : "—"}</td>
      <td style="padding:12px 16px;font-weight:800;font-size:1.2rem;color:${scoreColor(c.score)}">${c.score}</td>
      <td style="padding:12px 16px;color:#5f6873;font-size:0.88rem">${c.contactInfo || "—"}</td>
    </tr>
    <tr style="background:${i % 2 === 0 ? "#f8f7f4" : "#ffffff"}">
      <td colspan="6" style="padding:0 16px 14px;color:#5f6873;font-size:0.85rem;font-style:italic;border-bottom:1px solid #eee">
        ${c.reason}
        ${c.matchedSkills?.length ? `<br><span style="color:#1f8f63">✓ ${c.matchedSkills.join(", ")}</span>` : ""}
        ${c.missingSkills?.length ? `<br><span style="color:#c4495f">✗ Missing: ${c.missingSkills.join(", ")}</span>` : ""}
      </td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>HiringDesk Candidate Report</title>
</head>
<body style="margin:0;padding:0;background:#f3efe5;font-family:'Segoe UI',sans-serif">
  <div style="max-width:860px;margin:32px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.10)">
    <div style="background:linear-gradient(135deg,#1f8f63,#2463eb);padding:32px 36px;color:white">
      <p style="margin:0 0 6px;font-size:0.76rem;letter-spacing:0.18em;text-transform:uppercase;opacity:0.8">HiringDesk · Candidate Report</p>
      <h1 style="margin:0;font-size:2rem;font-weight:800">${job.title}</h1>
      <p style="margin:8px 0 0;opacity:0.85">
        ${job.department ? job.department + " · " : ""}${job.location || "Any location"} · Top ${candidates.length} of ${job.totalAnalyzed || candidates.length} analyzed
      </p>
    </div>

    <div style="padding:24px 36px 8px">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:2px solid #1f2933">
            <th style="padding:10px 16px;text-align:left;font-size:0.76rem;letter-spacing:0.08em;text-transform:uppercase;color:#5f6873">Rank</th>
            <th style="padding:10px 16px;text-align:left;font-size:0.76rem;letter-spacing:0.08em;text-transform:uppercase;color:#5f6873">Candidate</th>
            <th style="padding:10px 16px;text-align:left;font-size:0.76rem;letter-spacing:0.08em;text-transform:uppercase;color:#5f6873">Location</th>
            <th style="padding:10px 16px;text-align:left;font-size:0.76rem;letter-spacing:0.08em;text-transform:uppercase;color:#5f6873">Exp</th>
            <th style="padding:10px 16px;text-align:left;font-size:0.76rem;letter-spacing:0.08em;text-transform:uppercase;color:#5f6873">Score</th>
            <th style="padding:10px 16px;text-align:left;font-size:0.76rem;letter-spacing:0.08em;text-transform:uppercase;color:#5f6873">Contact</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <div style="padding:24px 36px;border-top:1px solid #eee;margin-top:12px;color:#5f6873;font-size:0.82rem">
      Generated by HiringDesk · ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
      ${job.requiredSkills ? `<br>Required skills: ${job.requiredSkills}` : ""}
      ${job.requiredCertifications ? `<br>Required certifications: ${job.requiredCertifications}` : ""}
    </div>
  </div>
</body>
</html>`;
}

app.post("/api/recruiter/rank", upload.array("resumeFiles", 100), async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server." });
    }

    const job = {
      title: (req.body.jobTitle || "").trim(),
      department: (req.body.department || "").trim(),
      location: (req.body.jobLocation || "").trim(),
      requiredSkills: (req.body.requiredSkills || "").trim(),
      requiredCertifications: (req.body.requiredCertifications || "").trim(),
      minYearsExp: parseInt(req.body.minYearsExp) || 0,
      additionalNotes: (req.body.additionalNotes || "").trim(),
      notificationEmail: (req.body.notificationEmail || "").trim()
    };

    if (!job.title) return res.status(400).json({ error: "Job title is required." });

    const resumes = [];

    // Process uploaded files
    if (req.files?.length) {
      for (const file of req.files) {
        const text = await extractTextFromBuffer(file.buffer, file.originalname);
        if (text) resumes.push(text);
        else resumes.push(`[File: ${file.originalname} — could not extract text]`);
      }
    }

    // Process pasted batch text (separated by ---- on its own line)
    const batchText = (req.body.batchText || "").trim();
    if (batchText) {
      const sections = batchText
        .split(/\n\s*-{3,}\s*\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      resumes.push(...sections);
    }

    if (!resumes.length) {
      return res.status(400).json({ error: "Please upload resume files or paste candidate resumes separated by ----." });
    }

    const capped = resumes.slice(0, 100);
    if (resumes.length > 100) {
      console.log(`Capped batch at 100 (submitted ${resumes.length})`);
    }

    const analysis = await rankCandidatesForJob(job, capped);
    const ranked = analysis.rankedCandidates || [];

    const highPriority = ranked.filter((c) => c.tier === "high_priority").length;
    const qualified = ranked.filter((c) => c.tier === "qualified").length;
    const review = ranked.filter((c) => c.tier === "review").length;
    const avgScore = ranked.length
      ? Math.round(ranked.reduce((s, c) => s + c.score, 0) / ranked.length)
      : 0;

    // Save job + all ranked candidates to the database
    try {
      saveJobAndCandidates(job, ranked, capped);
    } catch (err) {
      console.error("DB save error (non-fatal):", err.message);
    }

    res.json({
      job: { ...job, totalAnalyzed: capped.length },
      candidates: ranked,
      stats: {
        totalAnalyzed: capped.length,
        shown: ranked.length,
        highPriority,
        qualified,
        review,
        averageScore: avgScore
      }
    });
  } catch (err) {
    console.error("Recruiter rank error:", err);
    res.status(500).json({ error: err.message || "Ranking failed." });
  }
});

app.post("/api/recruiter/past-match", (req, res) => {
  try {
    const job = req.body;
    const allPast = getPastCandidates();
    const totalInDb = getCandidateCount();

    if (!allPast.length) {
      return res.json({ candidates: [], totalInDb: 0 });
    }

    const requiredSkills = (job.requiredSkills || "")
      .toLowerCase()
      .split(/[,\s]+/)
      .filter(Boolean);
    const minExp = parseInt(job.minYearsExp) || 0;
    const jobLocation = (job.location || "").toLowerCase();

    const scored = allPast.map((c) => {
      const resumeLower = (c.resumeText || "").toLowerCase();
      const candidateSkills = c.skills.map((s) => s.toLowerCase());

      // Skill match — check stored skills AND resume text
      let matchedSkills = [];
      let missingSkills = [];
      for (const skill of requiredSkills) {
        const found = candidateSkills.some((s) => s.includes(skill) || skill.includes(s))
          || resumeLower.includes(skill);
        if (found) matchedSkills.push(skill);
        else missingSkills.push(skill);
      }

      const skillScore = requiredSkills.length > 0
        ? (matchedSkills.length / requiredSkills.length) * 65
        : 50;

      // Experience score (up to 20)
      let expScore = 0;
      if (minExp === 0) {
        expScore = 15;
      } else if (c.yearsExperience >= minExp) {
        expScore = 20;
      } else if (c.yearsExperience >= minExp * 0.75) {
        expScore = 10;
      }

      // Location score (up to 15)
      let locScore = 0;
      if (!jobLocation || jobLocation.includes("remote")) {
        locScore = 15;
      } else if (c.location) {
        const candLoc = c.location.toLowerCase();
        const jobCity = jobLocation.split(/[,\s]/)[0];
        if (candLoc.includes(jobCity) || jobLocation.includes(candLoc.split(/[,\s]/)[0])) {
          locScore = 15;
        } else {
          locScore = 5;
        }
      }

      const score = Math.min(Math.round(skillScore + expScore + locScore), 100);

      return { ...c, score, matchedSkills, missingSkills };
    });

    // Only surface candidates with a meaningful match
    const matches = scored
      .filter((c) => c.score >= 40)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    res.json({ candidates: matches, totalInDb });
  } catch (err) {
    console.error("Past match error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/recruiter/notify", async (req, res) => {
  try {
    const { job, candidates, notificationEmail } = req.body;
    if (!candidates?.length) return res.status(400).json({ error: "No candidates to report." });

    const emailHtml = buildEmailReport(job, candidates);
    const recipient = notificationEmail || job?.notificationEmail;

    // If SMTP is not configured, return preview HTML
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
      return res.json({
        message: "SMTP not configured — here is the email preview.",
        emailHtml,
        configured: false
      });
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: recipient,
      subject: `HiringDesk: Top ${candidates.length} Candidates for ${job?.title || "Open Role"}`,
      html: emailHtml
    });

    res.json({
      message: `Report emailed to ${recipient}`,
      configured: true
    });
  } catch (err) {
    console.error("Notify error:", err);
    res.status(500).json({ error: err.message || "Notification failed." });
  }
});

// ─────────────────────────────────────────────
//  INTEGRATIONS
// ─────────────────────────────────────────────

app.post("/api/integrations/webhook", async (req, res) => {
  try {
    const { url, payload, authorization } = req.body;

    if (!url)
      return res.status(400).json({ success: false, error: "url is required." });
    if (!url.startsWith("https://"))
      return res.status(400).json({ success: false, error: "url must start with https://." });
    try { new URL(url); } catch {
      return res.status(400).json({ success: false, error: "url is not a valid URL." });
    }
    if (!payload)
      return res.status(400).json({ success: false, error: "payload is required." });

    const headers = { "Content-Type": "application/json" };
    if (authorization) headers["Authorization"] = `Bearer ${authorization}`;

    const destRes = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    if (!destRes.ok) {
      const text = await destRes.text().catch(() => "");
      return res.status(502).json({
        success: false,
        error: `Destination returned ${destRes.status}${text ? ": " + text.slice(0, 200) : ""}.`
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || "Webhook delivery failed." });
  }
});

// ─────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`HiringDesk running → http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) console.warn("  ⚠  ANTHROPIC_API_KEY not set");
  if (!JSEARCH_KEY) console.warn("  ⚠  JSEARCH_API_KEY not set");
  if (!process.env.SMTP_HOST) console.warn("  ⚠  SMTP not configured — email preview mode only");
});
