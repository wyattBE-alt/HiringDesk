import { DatabaseSync } from "node:sqlite";
import path from "path";
import { fileURLToPath } from "url";

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
`);

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

    for (const c of candidates) {
      const resumeText = (resumeTexts[c.resumeIndex] || "").slice(0, 4000);
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
    return jobId;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getPastCandidates() {
  return db.prepare(`
    SELECT c.id, c.name, c.current_title, c.location, c.contact_info,
           c.years_experience, c.skills, c.certifications, c.resume_text,
           MAX(r.score) as best_score
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
    bestScore: r.best_score
  }));
}

export function getCandidateCount() {
  return db.prepare(`
    SELECT COUNT(DISTINCT COALESCE(NULLIF(contact_info, ''), CAST(id AS TEXT))) as count
    FROM candidates
  `).get().count;
}

export default db;
