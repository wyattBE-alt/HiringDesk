import { DatabaseSync } from "node:sqlite";
import path from "path";
import { fileURLToPath } from "url";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.join(__dirname, "hiringdesk.db"));

db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    department TEXT,
    location TEXT,
    required_skills TEXT,
    required_certs TEXT,
    min_years_exp INTEGER DEFAULT 0,
    additional_notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    current_title TEXT,
    location TEXT,
    contact_info TEXT,
    years_experience REAL,
    skills TEXT,
    certifications TEXT,
    resume_text TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rankings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER REFERENCES candidates(id),
    job_id INTEGER REFERENCES jobs(id),
    score INTEGER,
    tier TEXT,
    matched_skills TEXT,
    missing_skills TEXT,
    matched_certs TEXT,
    missing_certs TEXT,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS hiring_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill TEXT,
    cert TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'applicant',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS job_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    job_title TEXT NOT NULL,
    company TEXT,
    apply_url TEXT,
    score INTEGER,
    matched_skills TEXT,
    missing_skills TEXT,
    status TEXT NOT NULL DEFAULT 'applied',
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS resume_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    resume_text TEXT,
    avg_score INTEGER,
    top_skills TEXT,
    snapshot_label TEXT DEFAULT 'update',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migrate existing candidates table — safe on re-run
for (const sql of [
  "ALTER TABLE candidates ADD COLUMN status TEXT DEFAULT 'new'",
  "ALTER TABLE candidates ADD COLUMN status_updated_at DATETIME",
  "ALTER TABLE candidates ADD COLUMN opt_in INTEGER DEFAULT 0",
  "ALTER TABLE candidates ADD COLUMN pool_score INTEGER DEFAULT 0",
]) {
  try { db.exec(sql); } catch { /* column already exists */ }
}

const insertJob = db.prepare(`
  INSERT INTO jobs (title, department, location, required_skills, required_certs, min_years_exp, additional_notes)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const insertCandidate = db.prepare(`
  INSERT INTO candidates (name, current_title, location, contact_info, years_experience, skills, certifications, resume_text)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertRanking = db.prepare(`
  INSERT INTO rankings (candidate_id, job_id, score, tier, matched_skills, missing_skills, matched_certs, missing_certs, reason)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export function saveJobAndCandidates(job, candidates, resumeTexts) {
  db.exec("BEGIN");
  try {
    const jobResult = insertJob.run(
      job.title, job.department || null, job.location || null,
      job.requiredSkills || null, job.requiredCertifications || null,
      job.minYearsExp || 0, job.additionalNotes || null
    );
    const jobId = jobResult.lastInsertRowid;
    const candidateIds = [];

    for (const c of candidates) {
      const resumeText = (resumeTexts[c.resumeIndex] || "").slice(0, 20000);
      const candidateResult = insertCandidate.run(
        c.name || "Unknown",
        c.currentTitle || null,
        c.location || null,
        c.contactInfo || null,
        c.yearsExperience ?? null,
        JSON.stringify(c.matchedSkills || []),
        JSON.stringify(c.matchedCertifications || []),
        resumeText
      );
      const candidateId = candidateResult.lastInsertRowid;
      candidateIds.push(Number(candidateId));

      insertRanking.run(
        candidateId, jobId, c.score, c.tier,
        JSON.stringify(c.matchedSkills || []),
        JSON.stringify(c.missingSkills || []),
        JSON.stringify(c.matchedCertifications || []),
        JSON.stringify(c.missingCertifications || []),
        c.reason || ""
      );
    }

    db.exec("COMMIT");
    return { jobId, candidateIds };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function updateCandidateStatus(candidateId, status) {
  db.prepare(
    `UPDATE candidates SET status = ?, status_updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(status, candidateId);
}

export function recordHiringSignal(skills = [], certs = []) {
  const insertSignal = db.prepare(`INSERT INTO hiring_signals (skill, cert) VALUES (?, ?)`);
  db.exec("BEGIN");
  try {
    for (const skill of skills) insertSignal.run(skill.toLowerCase(), null);
    for (const cert of certs) insertSignal.run(null, cert.toLowerCase());
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getHiringSignals() {
  const rows = db.prepare(`SELECT skill, cert FROM hiring_signals`).all();
  return {
    skills: new Set(rows.filter(r => r.skill).map(r => r.skill)),
    certs: new Set(rows.filter(r => r.cert).map(r => r.cert)),
  };
}

export function getPastCandidates() {
  return db.prepare(`
    SELECT c.id, c.name, c.current_title, c.location, c.contact_info,
           c.years_experience, c.skills, c.certifications, c.resume_text,
           c.status, MAX(r.score) as best_score
    FROM candidates c
    JOIN rankings r ON r.candidate_id = c.id
    WHERE c.resume_text IS NOT NULL AND c.resume_text != ''
    GROUP BY COALESCE(NULLIF(c.contact_info, ''), CAST(c.id AS TEXT))
    ORDER BY best_score DESC
    LIMIT 300
  `).all().map(r => ({
    id: r.id,
    name: r.name,
    currentTitle: r.current_title,
    location: r.location,
    contactInfo: r.contact_info,
    yearsExperience: r.years_experience,
    skills: JSON.parse(r.skills || "[]"),
    certifications: JSON.parse(r.certifications || "[]"),
    resumeText: r.resume_text,
    status: r.status || "new",
    bestScore: r.best_score
  }));
}

export function getCandidateCount() {
  return db.prepare(`
    SELECT COUNT(DISTINCT COALESCE(NULLIF(contact_info, ''), CAST(id AS TEXT))) as count
    FROM candidates
  `).get().count;
}

// ─────────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────────

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const attempt = scryptSync(password, salt, 64);
  return timingSafeEqual(Buffer.from(hash, "hex"), attempt);
}

function generateToken() {
  return randomBytes(32).toString("hex");
}

export function createUser(email, password, role = "applicant") {
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
  if (existing) throw new Error("EMAIL_TAKEN");
  const password_hash = hashPassword(password);
  const result = db.prepare(
    "INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)"
  ).run(email.toLowerCase(), password_hash, role);
  return { id: Number(result.lastInsertRowid), email: email.toLowerCase(), role };
}

export function loginUser(email, password) {
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
  if (!user) throw new Error("INVALID_CREDENTIALS");
  if (!verifyPassword(password, user.password_hash)) throw new Error("INVALID_CREDENTIALS");
  // Create session — 30 days
  const token = generateToken();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, user.id, expires);
  return { token, user: { id: user.id, email: user.email, role: user.role } };
}

export function getUserFromToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.email, u.role
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > CURRENT_TIMESTAMP
  `).get(token);
  return row || null;
}

export function deleteSession(token) {
  db.prepare("DELETE FROM user_sessions WHERE token = ?").run(token);
}

// ─────────────────────────────────────────────
//  JOB APPLICATIONS
// ─────────────────────────────────────────────

export function saveApplication(userId, app) {
  const result = db.prepare(`
    INSERT INTO job_applications (user_id, job_title, company, apply_url, score, matched_skills, missing_skills, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    app.jobTitle || "",
    app.company || "",
    app.applyUrl || "",
    app.score ?? null,
    JSON.stringify(app.matchedSkills || []),
    JSON.stringify(app.missingSkills || []),
    app.status || "applied",
    app.notes || ""
  );
  return Number(result.lastInsertRowid);
}

export function getApplications(userId) {
  return db.prepare(`
    SELECT * FROM job_applications WHERE user_id = ? ORDER BY applied_at DESC
  `).all(userId).map(r => ({
    id: r.id,
    jobTitle: r.job_title,
    company: r.company,
    applyUrl: r.apply_url,
    score: r.score,
    matchedSkills: JSON.parse(r.matched_skills || "[]"),
    missingSkills: JSON.parse(r.missing_skills || "[]"),
    status: r.status,
    appliedAt: r.applied_at,
    notes: r.notes
  }));
}

export function updateApplicationStatus(appId, userId, status) {
  db.prepare(`UPDATE job_applications SET status = ? WHERE id = ? AND user_id = ?`).run(status, appId, userId);
}

export function deleteApplication(appId, userId) {
  db.prepare(`DELETE FROM job_applications WHERE id = ? AND user_id = ?`).run(appId, userId);
}

// ─────────────────────────────────────────────
//  RESUME SNAPSHOTS
// ─────────────────────────────────────────────

export function saveResumeSnapshot(userId, { resumeText, avgScore, topSkills }) {
  // First snapshot = baseline, subsequent = update
  const count = db.prepare("SELECT COUNT(*) as c FROM resume_snapshots WHERE user_id = ?").get(userId).c;
  const label = count === 0 ? "baseline" : `update_${count}`;
  db.prepare(`
    INSERT INTO resume_snapshots (user_id, resume_text, avg_score, top_skills, snapshot_label)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, (resumeText || "").slice(0, 20000), avgScore ?? null, JSON.stringify(topSkills || []), label);
}

export function getResumeSnapshots(userId) {
  return db.prepare(`
    SELECT id, avg_score, top_skills, snapshot_label, created_at
    FROM resume_snapshots WHERE user_id = ? ORDER BY created_at ASC
  `).all(userId).map(r => ({
    id: r.id,
    avgScore: r.avg_score,
    topSkills: JSON.parse(r.top_skills || "[]"),
    label: r.snapshot_label,
    createdAt: r.created_at
  }));
}

// ─────────────────────────────────────────────
//  RECRUITER TALENT POOL
// ─────────────────────────────────────────────

export function getTalentPool({ skills = [], minScore = 50, limit = 100 } = {}) {
  // LEFT JOIN includes opt-in applicants who have no recruiter ranking yet
  const allCandidates = db.prepare(`
    SELECT c.id, c.name, c.current_title, c.location, c.contact_info,
           c.years_experience, c.skills, c.certifications, c.resume_text,
           c.status,
           CASE WHEN MAX(r.score) IS NOT NULL THEN MAX(r.score)
                ELSE COALESCE(c.pool_score, 0)
           END AS best_score,
           COALESCE(MAX(j.title), 'Opt-In') AS last_job_title
    FROM candidates c
    LEFT JOIN rankings r ON r.candidate_id = c.id
    LEFT JOIN jobs j ON j.id = r.job_id
    WHERE c.resume_text IS NOT NULL AND c.resume_text != ''
      AND (r.id IS NOT NULL OR c.opt_in = 1)
    GROUP BY COALESCE(NULLIF(c.contact_info, ''), CAST(c.id AS TEXT))
    HAVING best_score >= ?
    ORDER BY best_score DESC
    LIMIT 200
  `).all(minScore);

  let results = allCandidates.map(r => ({
    id: r.id,
    name: r.name,
    currentTitle: r.current_title,
    location: r.location,
    contactInfo: r.contact_info,
    yearsExperience: r.years_experience,
    skills: JSON.parse(r.skills || "[]"),
    certifications: JSON.parse(r.certifications || "[]"),
    bestScore: r.best_score,
    status: r.status || "new",
    lastJobTitle: r.last_job_title,
    resumeText: r.resume_text
  }));

  // Filter by requested skills if provided
  if (skills.length > 0) {
    const lowerSkills = skills.map(s => s.toLowerCase());
    results = results.filter(c => {
      const resumeLower = (c.resumeText || "").toLowerCase();
      const cSkills = c.skills.map(s => s.toLowerCase());
      return lowerSkills.some(sk =>
        cSkills.some(cs => cs.includes(sk) || sk.includes(cs)) || resumeLower.includes(sk)
      );
    });
  }

  return results.slice(0, limit);
}

export function saveTalentPoolCandidate({ name, currentTitle, location, contactInfo, yearsExperience, topSkills, resumeText, avgScore }) {
  // Upsert by contact_info to avoid duplicates from repeat submissions
  if (contactInfo) {
    const existing = db.prepare(`SELECT id FROM candidates WHERE contact_info = ? AND opt_in = 1`).get(contactInfo);
    if (existing) {
      db.prepare(`
        UPDATE candidates
        SET name = ?, current_title = ?, years_experience = ?, skills = ?,
            resume_text = ?, pool_score = ?, status_updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(name || "Unknown", currentTitle || null, yearsExperience ?? null,
             JSON.stringify(topSkills || []), (resumeText || "").slice(0, 20000),
             avgScore ?? 0, existing.id);
      return Number(existing.id);
    }
  }
  const result = db.prepare(`
    INSERT INTO candidates
      (name, current_title, location, contact_info, years_experience,
       skills, certifications, resume_text, opt_in, pool_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    name || "Unknown", currentTitle || null, location || null, contactInfo || null,
    yearsExperience ?? null, JSON.stringify(topSkills || []), "[]",
    (resumeText || "").slice(0, 20000), avgScore ?? 0
  );
  return Number(result.lastInsertRowid);
}

export default db;
