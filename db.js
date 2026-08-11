import pg from "pg";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Provision a Postgres database (Railway: add a Postgres plugin) " +
    "and set DATABASE_URL. For local dev, point it at a local Postgres or Railway's DATABASE_PUBLIC_URL."
  );
}

// Railway internal hostnames + localhost don't use SSL; public/managed hosts do.
const noSsl = /railway\.internal|localhost|127\.0\.0\.1/.test(connectionString) || process.env.PGSSL === "disable";

const pool = new Pool({
  connectionString,
  ssl: noSsl ? false : { rejectUnauthorized: false },
});

// ─────────────────────────────────────────────
//  SCHEMA — created once on startup (top-level await)
// ─────────────────────────────────────────────

await pool.query(`
  CREATE TABLE IF NOT EXISTS jobs (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    department TEXT,
    location TEXT,
    required_skills TEXT,
    required_certs TEXT,
    min_years_exp INTEGER DEFAULT 0,
    additional_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS candidates (
    id SERIAL PRIMARY KEY,
    name TEXT,
    current_title TEXT,
    location TEXT,
    contact_info TEXT,
    years_experience REAL,
    skills TEXT,
    certifications TEXT,
    resume_text TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    status TEXT DEFAULT 'new',
    status_updated_at TIMESTAMPTZ,
    opt_in INTEGER DEFAULT 0,
    pool_score INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS rankings (
    id SERIAL PRIMARY KEY,
    candidate_id INTEGER REFERENCES candidates(id),
    job_id INTEGER REFERENCES jobs(id),
    score INTEGER,
    tier TEXT,
    matched_skills TEXT,
    missing_skills TEXT,
    matched_certs TEXT,
    missing_certs TEXT,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS hiring_signals (
    id SERIAL PRIMARY KEY,
    skill TEXT,
    cert TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'applicant',
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS user_sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS job_applications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    job_title TEXT NOT NULL,
    company TEXT,
    apply_url TEXT,
    score INTEGER,
    matched_skills TEXT,
    missing_skills TEXT,
    status TEXT NOT NULL DEFAULT 'applied',
    applied_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS resume_snapshots (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    resume_text TEXT,
    avg_score INTEGER,
    top_skills TEXT,
    job_query TEXT,
    top_score INTEGER,
    snapshot_label TEXT DEFAULT 'update',
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    token TEXT PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    type TEXT NOT NULL,
    path TEXT,
    session_id TEXT,
    user_id INTEGER,
    meta TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
  CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);

  -- Idempotent migration for tables created before job_query/top_score existed
  ALTER TABLE resume_snapshots ADD COLUMN IF NOT EXISTS job_query TEXT;
  ALTER TABLE resume_snapshots ADD COLUMN IF NOT EXISTS top_score INTEGER;

  -- Candidate ownership: resumes a recruiter uploads are private to that recruiter.
  -- opt_in = 1 candidates (seekers who consented) remain shared across all recruiters.
  ALTER TABLE candidates ADD COLUMN IF NOT EXISTS owner_user_id INTEGER;
  CREATE INDEX IF NOT EXISTS idx_candidates_owner ON candidates(owner_user_id);
  CREATE INDEX IF NOT EXISTS idx_candidates_optin ON candidates(opt_in);
`);

// ─────────────────────────────────────────────
//  RECRUITER — JOBS + CANDIDATES + RANKINGS
// ─────────────────────────────────────────────

export async function saveJobAndCandidates(job, candidates, resumeTexts, ownerUserId = null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const jobResult = await client.query(
      `INSERT INTO jobs (title, department, location, required_skills, required_certs, min_years_exp, additional_notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        job.title, job.department || null, job.location || null,
        job.requiredSkills || null, job.requiredCertifications || null,
        job.minYearsExp || 0, job.additionalNotes || null,
      ]
    );
    const jobId = jobResult.rows[0].id;
    const candidateIds = [];

    for (const c of candidates) {
      const resumeText = (resumeTexts[c.resumeIndex] || "").slice(0, 20000);
      const candidateResult = await client.query(
        `INSERT INTO candidates (name, current_title, location, contact_info, years_experience, skills, certifications, resume_text, owner_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          c.name || "Unknown",
          c.currentTitle || null,
          c.location || null,
          c.contactInfo || null,
          c.yearsExperience ?? null,
          JSON.stringify(c.matchedSkills || []),
          JSON.stringify(c.matchedCertifications || []),
          resumeText,
          ownerUserId,
        ]
      );
      const candidateId = candidateResult.rows[0].id;
      candidateIds.push(candidateId);

      await client.query(
        `INSERT INTO rankings (candidate_id, job_id, score, tier, matched_skills, missing_skills, matched_certs, missing_certs, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          candidateId, jobId, c.score, c.tier,
          JSON.stringify(c.matchedSkills || []),
          JSON.stringify(c.missingSkills || []),
          JSON.stringify(c.matchedCertifications || []),
          JSON.stringify(c.missingCertifications || []),
          c.reason || "",
        ]
      );
    }

    await client.query("COMMIT");
    return { jobId, candidateIds };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function updateCandidateStatus(candidateId, status) {
  await pool.query(
    `UPDATE candidates SET status = $1, status_updated_at = NOW() WHERE id = $2`,
    [status, candidateId]
  );
}

export async function recordHiringSignal(skills = [], certs = []) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const skill of skills) {
      await client.query(`INSERT INTO hiring_signals (skill, cert) VALUES ($1, $2)`, [skill.toLowerCase(), null]);
    }
    for (const cert of certs) {
      await client.query(`INSERT INTO hiring_signals (skill, cert) VALUES ($1, $2)`, [null, cert.toLowerCase()]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getHiringSignals() {
  const { rows } = await pool.query(`SELECT skill, cert FROM hiring_signals`);
  return {
    skills: new Set(rows.filter(r => r.skill).map(r => r.skill)),
    certs: new Set(rows.filter(r => r.cert).map(r => r.cert)),
  };
}

export async function getPastCandidates(recruiterId) {
  // A recruiter only resurfaces candidates they themselves uploaded (private history).
  if (!recruiterId) return [];
  // Dedupe by contact_info (fall back to id), keeping each candidate's best ranking score.
  const { rows } = await pool.query(`
    SELECT * FROM (
      SELECT DISTINCT ON (COALESCE(NULLIF(c.contact_info, ''), c.id::text))
             c.id, c.name, c.current_title, c.location, c.contact_info,
             c.years_experience, c.skills, c.certifications, c.resume_text,
             c.status, agg.best_score
      FROM candidates c
      JOIN (
        SELECT candidate_id, MAX(score) AS best_score
        FROM rankings GROUP BY candidate_id
      ) agg ON agg.candidate_id = c.id
      WHERE c.resume_text IS NOT NULL AND c.resume_text <> ''
        AND c.owner_user_id = $1
      ORDER BY COALESCE(NULLIF(c.contact_info, ''), c.id::text), agg.best_score DESC
    ) t
    ORDER BY best_score DESC
    LIMIT 300
  `, [recruiterId]);
  return rows.map(r => ({
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
    bestScore: r.best_score,
  }));
}

export async function getCandidateCount(recruiterId) {
  // Count only what this recruiter can see: shared opt-in pool + their own uploads.
  const { rows } = await pool.query(`
    SELECT COUNT(DISTINCT COALESCE(NULLIF(contact_info, ''), id::text)) AS count
    FROM candidates
    WHERE opt_in = 1 OR owner_user_id = $1
  `, [recruiterId ?? null]);
  return Number(rows[0].count);
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

export async function createUser(email, password, role = "applicant") {
  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
  if (existing.rows.length) throw new Error("EMAIL_TAKEN");
  const password_hash = hashPassword(password);
  const result = await pool.query(
    "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id",
    [email.toLowerCase(), password_hash, role]
  );
  return { id: result.rows[0].id, email: email.toLowerCase(), role };
}

export async function loginUser(email, password) {
  const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
  const user = rows[0];
  if (!user) throw new Error("INVALID_CREDENTIALS");
  if (!verifyPassword(password, user.password_hash)) throw new Error("INVALID_CREDENTIALS");
  // Create session — 30 days
  const token = generateToken();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await pool.query("INSERT INTO user_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)", [token, user.id, expires]);
  return { token, user: { id: user.id, email: user.email, role: user.role } };
}

export async function getUserFromToken(token) {
  if (!token) return null;
  const { rows } = await pool.query(`
    SELECT u.id, u.email, u.role
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = $1 AND s.expires_at > NOW()
  `, [token]);
  return rows[0] || null;
}

export async function deleteSession(token) {
  await pool.query("DELETE FROM user_sessions WHERE token = $1", [token]);
}

// Create a one-hour password-reset token. Returns { token, email } if the email
// has an account, else null (caller must NOT reveal which).
export async function createPasswordReset(email) {
  const { rows } = await pool.query("SELECT id, email FROM users WHERE email = $1", [email.toLowerCase()]);
  const user = rows[0];
  if (!user) return null;
  const token = generateToken();
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await pool.query(
    "INSERT INTO password_resets (token, user_id, expires_at) VALUES ($1, $2, $3)",
    [token, user.id, expires]
  );
  return { token, email: user.email };
}

// Consume a valid, unused, unexpired token: set the new password, invalidate the
// token, and revoke all existing sessions. Returns true on success.
export async function consumePasswordReset(token, newPassword) {
  const { rows } = await pool.query(
    `SELECT user_id FROM password_resets WHERE token = $1 AND used = 0 AND expires_at > NOW()`,
    [token]
  );
  const reset = rows[0];
  if (!reset) return false;
  const password_hash = hashPassword(newPassword);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [password_hash, reset.user_id]);
    await client.query("UPDATE password_resets SET used = 1 WHERE token = $1", [token]);
    await client.query("DELETE FROM user_sessions WHERE user_id = $1", [reset.user_id]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return true;
}

// ─────────────────────────────────────────────
//  JOB APPLICATIONS
// ─────────────────────────────────────────────

export async function saveApplication(userId, app) {
  const result = await pool.query(
    `INSERT INTO job_applications (user_id, job_title, company, apply_url, score, matched_skills, missing_skills, status, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      userId,
      app.jobTitle || "",
      app.company || "",
      app.applyUrl || "",
      app.score ?? null,
      JSON.stringify(app.matchedSkills || []),
      JSON.stringify(app.missingSkills || []),
      app.status || "applied",
      app.notes || "",
    ]
  );
  return result.rows[0].id;
}

export async function getApplications(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM job_applications WHERE user_id = $1 ORDER BY applied_at DESC`,
    [userId]
  );
  return rows.map(r => ({
    id: r.id,
    jobTitle: r.job_title,
    company: r.company,
    applyUrl: r.apply_url,
    score: r.score,
    matchedSkills: JSON.parse(r.matched_skills || "[]"),
    missingSkills: JSON.parse(r.missing_skills || "[]"),
    status: r.status,
    appliedAt: r.applied_at,
    notes: r.notes,
  }));
}

export async function updateApplicationStatus(appId, userId, status) {
  await pool.query(`UPDATE job_applications SET status = $1 WHERE id = $2 AND user_id = $3`, [status, appId, userId]);
}

export async function deleteApplication(appId, userId) {
  await pool.query(`DELETE FROM job_applications WHERE id = $1 AND user_id = $2`, [appId, userId]);
}

// ─────────────────────────────────────────────
//  RESUME SNAPSHOTS
// ─────────────────────────────────────────────

export async function saveResumeSnapshot(userId, { resumeText, avgScore, topSkills, jobQuery, topScore }) {
  // First snapshot = baseline, subsequent = update
  const { rows } = await pool.query("SELECT COUNT(*) AS c FROM resume_snapshots WHERE user_id = $1", [userId]);
  const count = Number(rows[0].c);
  const label = count === 0 ? "baseline" : `update_${count}`;
  await pool.query(
    `INSERT INTO resume_snapshots (user_id, resume_text, avg_score, top_skills, job_query, top_score, snapshot_label)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      userId,
      (resumeText || "").slice(0, 20000),
      avgScore ?? null,
      JSON.stringify(topSkills || []),
      (jobQuery || "").slice(0, 200) || null,
      Number.isFinite(topScore) ? topScore : null,
      label,
    ]
  );
}

export async function getResumeSnapshots(userId) {
  const { rows } = await pool.query(
    `SELECT id, avg_score, top_skills, job_query, top_score, snapshot_label, created_at
     FROM resume_snapshots WHERE user_id = $1 ORDER BY created_at ASC`,
    [userId]
  );
  return rows.map(r => ({
    id: r.id,
    avgScore: r.avg_score,
    topSkills: JSON.parse(r.top_skills || "[]"),
    jobQuery: r.job_query,
    topScore: r.top_score,
    label: r.snapshot_label,
    createdAt: r.created_at,
  }));
}

// ─────────────────────────────────────────────
//  RECRUITER TALENT POOL
// ─────────────────────────────────────────────

export async function getTalentPool({ recruiterId = null, skills = [], minScore = 50, limit = 100 } = {}) {
  // Visibility: the shared consented pool (opt_in = 1) PLUS this recruiter's own uploads.
  // Resumes uploaded by other recruiters are never exposed here.
  // Dedupe by contact_info (fall back to id), keeping the best available score.
  const { rows } = await pool.query(`
    SELECT * FROM (
      SELECT DISTINCT ON (COALESCE(NULLIF(c.contact_info, ''), c.id::text))
        c.id, c.name, c.current_title, c.location, c.contact_info,
        c.years_experience, c.skills, c.certifications, c.resume_text, c.status,
        CASE WHEN agg.max_score IS NOT NULL THEN agg.max_score
             ELSE COALESCE(c.pool_score, 0) END AS best_score,
        COALESCE(agg.last_job_title, 'Opt-In') AS last_job_title
      FROM candidates c
      LEFT JOIN (
        SELECT r.candidate_id, MAX(r.score) AS max_score, MAX(j.title) AS last_job_title
        FROM rankings r
        LEFT JOIN jobs j ON j.id = r.job_id
        GROUP BY r.candidate_id
      ) agg ON agg.candidate_id = c.id
      WHERE c.resume_text IS NOT NULL AND c.resume_text <> ''
        AND (agg.candidate_id IS NOT NULL OR c.opt_in = 1)
        AND (c.opt_in = 1 OR c.owner_user_id = $2)
      ORDER BY COALESCE(NULLIF(c.contact_info, ''), c.id::text), best_score DESC
    ) t
    WHERE best_score >= $1
    ORDER BY best_score DESC
    LIMIT 200
  `, [minScore, recruiterId]);

  let results = rows.map(r => ({
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
    resumeText: r.resume_text,
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

export async function saveTalentPoolCandidate({ name, currentTitle, location, contactInfo, yearsExperience, topSkills, resumeText, avgScore }) {
  // Upsert by contact_info to avoid duplicates from repeat submissions
  if (contactInfo) {
    const existing = await pool.query(`SELECT id FROM candidates WHERE contact_info = $1 AND opt_in = 1`, [contactInfo]);
    if (existing.rows.length) {
      const id = existing.rows[0].id;
      await pool.query(
        `UPDATE candidates
         SET name = $1, current_title = $2, years_experience = $3, skills = $4,
             resume_text = $5, pool_score = $6, status_updated_at = NOW()
         WHERE id = $7`,
        [
          name || "Unknown", currentTitle || null, yearsExperience ?? null,
          JSON.stringify(topSkills || []), (resumeText || "").slice(0, 20000),
          avgScore ?? 0, id,
        ]
      );
      return id;
    }
  }
  const result = await pool.query(
    `INSERT INTO candidates
       (name, current_title, location, contact_info, years_experience,
        skills, certifications, resume_text, opt_in, pool_score)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9) RETURNING id`,
    [
      name || "Unknown", currentTitle || null, location || null, contactInfo || null,
      yearsExperience ?? null, JSON.stringify(topSkills || []), "[]",
      (resumeText || "").slice(0, 20000), avgScore ?? 0,
    ]
  );
  return result.rows[0].id;
}

// ─────────────────────────────────────────────
//  ANALYTICS EVENTS
// ─────────────────────────────────────────────

// Fire-and-forget event log. Analytics must NEVER break the app, so all errors are swallowed.
export async function recordEvent({ type, path = null, sessionId = null, userId = null, meta = null }) {
  if (!type) return;
  try {
    await pool.query(
      `INSERT INTO events (type, path, session_id, user_id, meta) VALUES ($1, $2, $3, $4, $5)`,
      [
        String(type).slice(0, 60),
        path ? String(path).slice(0, 300) : null,
        sessionId ? String(sessionId).slice(0, 80) : null,
        userId ?? null,
        meta ? JSON.stringify(meta).slice(0, 2000) : null,
      ]
    );
  } catch { /* swallow — never let telemetry throw */ }
}

export async function getAnalytics({ sinceDays = 7 } = {}) {
  const days = Math.min(Math.max(parseInt(sinceDays) || 7, 1), 365);
  const since = `NOW() - ($1 || ' days')::interval`;

  const [totals, byType, daily, topPaths] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE type = 'pageview')::int              AS pageviews,
        COUNT(DISTINCT session_id) FILTER (WHERE type = 'pageview')::int AS visitors,
        COUNT(*) FILTER (WHERE type = 'signup')::int               AS signups,
        COUNT(*) FILTER (WHERE type = 'login')::int                AS logins,
        COUNT(*) FILTER (WHERE type = 'analyze')::int              AS analyses,
        COUNT(*) FILTER (WHERE type = 'rank')::int                 AS ranks,
        COUNT(*) FILTER (WHERE type = 'tailor')::int               AS tailors,
        COUNT(*) FILTER (WHERE type = 'talent_pool_optin')::int    AS optins
      FROM events WHERE created_at >= ${since}
    `, [String(days)]),
    pool.query(`
      SELECT type, COUNT(*)::int AS count
      FROM events WHERE created_at >= ${since}
      GROUP BY type ORDER BY count DESC
    `, [String(days)]),
    pool.query(`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
             COUNT(*) FILTER (WHERE type = 'pageview')::int AS views,
             COUNT(DISTINCT session_id) FILTER (WHERE type = 'pageview')::int AS visitors
      FROM events WHERE created_at >= ${since}
      GROUP BY 1 ORDER BY 1
    `, [String(days)]),
    pool.query(`
      SELECT path, COUNT(*)::int AS count
      FROM events
      WHERE type = 'pageview' AND path IS NOT NULL AND created_at >= ${since}
      GROUP BY path ORDER BY count DESC LIMIT 12
    `, [String(days)]),
  ]);

  return {
    sinceDays: days,
    totals: totals.rows[0],
    byType: byType.rows,
    daily: daily.rows,
    topPaths: topPaths.rows,
  };
}

export default pool;
