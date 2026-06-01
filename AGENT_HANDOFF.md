# HiringDesk — Agent Handoff Document

> Give this file to any new AI agent working on this project. It covers what the app is, what has been built, the current state of every feature, known issues, and exactly what to build next.

---

## What This App Is

**HiringDesk** is a local Node.js web app with two sides:

- **Job Seeker side** (`index.html` / `app.js`): The user pastes or uploads their resume and enters a job title/keywords. The app searches live job listings via the JSearch API (RapidAPI), sends the resume + job descriptions to Claude for scoring, and returns a kanban board of results split into three buckets: **Ready to Apply**, **Apply with Tailoring**, and **Stretch Goals**. Each job card shows a fit score (0–100), the reason for the score, matched vs. missing skills as chips, and a gap-closing plan. A **"Tailor My Resume"** button rewrites the user's resume bullets for that specific role using another Claude call.

- **Recruiter side** (`recruiter.html` / `recruiter.js`): The recruiter defines a job (title, location, required skills, certs, experience) and uploads up to 100 resumes. Claude ranks the top 25 candidates with scores, tiers, skill matches, and a reason. Results can be emailed as an HTML report or previewed in a modal. A SQLite database (`db.js`) stores past candidates and resurfaces them for new roles.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ESM modules) |
| Server | Express.js |
| AI | Anthropic Claude (`claude-sonnet-4-6`) via `@anthropic-ai/sdk` |
| Job Search | JSearch API (RapidAPI) |
| File parsing | `pdf-parse` for PDF resumes |
| File upload | `multer` |
| Email | `nodemailer` (SMTP optional — falls back to preview) |
| Database | Better-SQLite3 (local `.db` file) |
| Frontend | Vanilla HTML/CSS/JS — no framework |
| Fonts | Syne (display/headings) + Space Grotesk (body) — Google Fonts via `@import` |

### Environment Variables Required (`.env`)

```
ANTHROPIC_API_KEY=sk-ant-...
JSEARCH_API_KEY=...          # RapidAPI key for JSearch
SMTP_HOST=                   # optional — email report feature
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
```

### Start the server

```bash
cd hiringdesk
npm install
node server.js
# → http://localhost:3000
```

---

## File Structure

```
hiringdesk/
├── index.html         # Job seeker UI
├── recruiter.html     # Recruiter UI
├── styles.css         # All CSS (dark mode design system, ~1660 lines)
├── app.js             # Job seeker frontend JS (~458 lines)
├── recruiter.js       # Recruiter frontend JS (~411 lines)
├── server.js          # Express backend — all API endpoints (~641 lines)
├── db.js              # SQLite helpers (save/query past candidates)
├── package.json
└── AGENT_HANDOFF.md   # This file
```

---

## Design System

The app uses a **bold, dark-mode design** (Linear/Vercel aesthetic). Key tokens in `styles.css`:

```css
--bg:        #07090f   /* page background */
--surface:   #0d1220   /* cards, sidebar */
--surface-2: #131929   /* job cards, ranked cards */
--surface-3: #1b2338   /* inputs */
--text:      #d4ddf5
--muted:     #5a6a8a
--blue:      #4f8ef5
--green:     #00d49a
--amber:     #f5a623
--rose:      #f54268
```

**Fonts:** `Syne` (700/800) for headings and brand name. `Space Grotesk` (400–700) for all body text.

**Score rings:** CSS `conic-gradient` circles showing the match score as a filled arc. Color changes by tier (green/amber/rose). Class: `.score-ring` with `style="--pct:XX%"`.

**Skill chips:** Color-coded inline tags (`.chip--matched` = green, `.chip--missing` = rose).

**Board lanes:** Top border color coded by tier (green = ready, amber = borderline, rose = stretch).

---

## All Changes Made in This Session

### 1. Complete CSS Rewrite (`styles.css`)
- Switched from warm parchment/cream palette to dark navy theme
- Added Google Fonts (`Syne` + `Space Grotesk`) via `@import`
- Redesigned all components: sidebar, inputs, buttons, stat cards, lanes, job cards, recruiter ranked list, modal, notify bar, past applicants section
- Added animated rotating orbit rings in the empty state (`#emptyState::before/::after` + `@keyframes orbit-spin`)
- Added `--line-strong`, `--shadow-lg` CSS variables
- Responsive: stacks to single column at 1200px, full mobile layout at 720px

### 2. Updated `index.html`
- Added Google Fonts `<link rel="preconnect">` tags
- Updated brand eyebrow: "Career Match Platform" → "AI Match Engine"
- Updated h1 tagline and brand copy (punchier, more specific)
- Updated empty state h2: "Find roles that fit you" → "Stop guessing. See your actual fit score."
- Rewrote step indicators as `.hero-step` elements with numbered `.step-num` circles
- Updated primary button text: "Find My Matches" → "Scan & Score →"
- Note: The user also added PWA meta tags (`manifest.json`, theme-color, apple-mobile) — these already exist in the file

### 3. Updated `recruiter.html`
- Added Google Fonts preconnect
- Updated eyebrow, brand copy, and empty state heading to match new tone
- Mode toggle labels shortened: "For Job Seekers/Recruiters" → "Job Seekers/Recruiters"

### 4. Updated `app.js` — Score Ring + Skill Chips
- Replaced flat `<div class="candidate-score">` with `<div class="score-ring">` using `--pct` CSS variable for conic-gradient fill
- Replaced comma-separated matched/missing skills text with colored `.skill-chip` elements
- Skills section restructured as `.candidate-skills-block` with labeled groups

### 5. Updated `app.js` + `server.js` — Tailor My Resume (major upgrade)
**What the Tailor feature does:**
- Button on every job card: **"✦ Tailor My Resume"**
- Calls `/api/tailor` with the user's resume text + the job's description, matched skills, and missing skills
- Claude rewrites the resume optimized for that specific role
- Panel slides in below the card with before/after diff view, cert roadmap, and download

**Server changes (`/api/tailor` endpoint):**
- Increased `max_tokens` to 3500
- New response format:
  ```json
  {
    "originalSummary": "existing summary from resume or null",
    "summary": "new tailored summary",
    "sections": [
      {
        "label": "Company · Role, YYYY–YYYY",
        "bullets": [
          { "original": "old bullet text", "rewritten": "improved bullet" }
        ]
      }
    ],
    "certRoadmap": [
      {
        "skill": "missing skill",
        "cert": "Full Certification Name",
        "provider": "AWS / CompTIA / etc.",
        "estimatedCost": "$XXX",
        "estimatedTime": "X–Y weeks",
        "searchUrl": "https://www.google.com/search?q=..."
      }
    ]
  }
  ```

**Frontend changes (`renderTailorPanel`):**
- **Before/After diff view**: every bullet shows "was" (muted, strikethrough) above "now" (bright green)
- **Section grouping**: bullets labeled by company+role so user knows exactly where to paste
- **Cert roadmap**: "Close the Gap" section — cards per missing skill with cert name, provider, cost, time, and search link
- **localStorage cache**: results saved by job ID (`hd_tailor_<jobId>`), restored instantly on re-open — no second API call
- **Old format migration**: stale cache in old `bullets` format auto-cleared and re-fetched
- **Copy All** button: copies full formatted text to clipboard
- **Download .txt** button: uses `data:` URI approach (not `blob:` — avoids CSP/browser compatibility issues), shows "Downloaded ✓" confirmation, fallback opens text in new tab if anchor download blocked

**Bug fixes in Tailor:**
1. `onclick` attribute bug: `JSON.stringify` wrapped in double quotes broke the HTML attribute. Fixed by switching to `addEventListener` bindings.
2. Blob download bug: `<a>` was clicked without being in the DOM. Fixed by appending/removing from `document.body` — then later replaced with `data:` URI to eliminate blob: URL issues entirely.
3. Cache format migration: old `bullets` array format detected and cleared so users get the new diff format.

### 6. Added Tailor CSS (`styles.css`)
- `.tailor-action`, `.tailor-action--active` — button states
- `.tailor-panel` with slide-in animation (`@keyframes tailor-in`)
- `.tailor-header`, `.tailor-badge`, `.tailor-note`, `.tailor-header-actions`
- `.tailor-section`, `.tailor-section-label` — experience section grouping
- `.diff-pair`, `.diff-original`, `.diff-rewritten`, `.diff-tag--was/now`, `.diff-divider`, `.diff-text` — before/after diff display
- `.cert-roadmap`, `.cert-card-grid`, `.cert-card`, `.cert-card-top`, `.cert-card-name`, `.cert-card-provider`, `.cert-card-meta`, `.cert-meta-item`, `.cert-card-link` — certification roadmap cards

---

## Current Feature Status

| Feature | Status | Notes |
|---|---|---|
| Resume upload (PDF/TXT/MD) | ✅ Working | PDF via `pdf-parse` |
| Live job search (JSearch) | ✅ Working | Requires `JSEARCH_API_KEY` |
| AI fit scoring (Claude) | ✅ Working | Returns score, bucket, reason, skills, gap plan |
| Score ring visualization | ✅ Working | `conic-gradient` based on score % |
| Skill chips (matched/missing) | ✅ Working | Color-coded chips per job card |
| Tailor My Resume — diff view | ✅ Working | Before/after per bullet, section-grouped |
| Tailor My Resume — cert roadmap | ✅ Working | Cards with cost, time, search link |
| Tailor My Resume — localStorage cache | ✅ Working | Persists across refresh, auto-clears old format |
| Tailor My Resume — Copy All | ✅ Working | Clipboard write |
| Tailor My Resume — Download .txt | ✅ Working | `data:` URI approach |
| Recruiter candidate ranking | ✅ Working | Top 25, scored + tiered |
| Recruiter email report | ✅ Working | HTML email or preview modal |
| Past applicant database | ✅ Working | SQLite, resurfaces on new role |
| Dark mode design | ✅ Complete | Full design system in `styles.css` |
| Responsive layout | ✅ Working | 1200px and 720px breakpoints |
| PWA manifest | ⚠️ Partial | `manifest.json` referenced but file may not exist |
| PWA icons | ⚠️ Missing | `/assets/icon-192.png` referenced but may not exist |

---

## Known Issues & Technical Debt

1. **PWA assets missing**: `index.html` references `/manifest.json` and `/assets/icon-192.png` (added by the user). These files need to be created for PWA install to work.

2. **No session persistence for scan results**: If the user refreshes after a scan, the job results are gone. The tailor results are cached but the scan itself is not. Fix: save the full `/api/analyze` response to `sessionStorage` and restore on load.

3. **Score credibility — no feedback loop**: The app has no way to know if a high-scoring job resulted in an interview. Adding outcome tracking (a simple "I got a callback / rejected" button per card) would enable future model improvements and add social proof.

4. **JSearch API rate limits**: At high usage, JSearch can throttle or return stale/duplicate listings. Adding a simple dedup step (`job.id` dedup) in `searchJobs()` in `server.js` would help.

5. **Resume text truncation**: In `/api/tailor`, the resume is truncated to 3500 chars and job description to 1200 chars. Long resumes lose their later sections. Consider using Claude's full 200k context instead.

6. **No user accounts**: Every session starts fresh. All data (resume, results, tailor cache) lives in `localStorage` — lost when the user clears their browser or switches devices. Accounts + a real DB would unlock history, saved jobs, and the career dashboard vision.

7. **`recruiter.js` not updated**: The recruiter side still uses the old color palette references and doesn't have the score ring component. If the recruiter side gets a card redesign, `recruiter.js` will need the same treatment as `app.js`.

---

## Prioritized Next Steps

These are ordered by effort-to-impact, smallest first.

### Tier 1 — Ship This Week (hours each)

**1. Session persistence for scan results**
- After a successful `/api/analyze`, save `data` to `sessionStorage`
- On page load, check `sessionStorage` and call `renderResults(data)` if found
- File: `app.js` — add ~15 lines around the `renderResults` call
- Impact: users stop losing work on accidental refresh

**2. "I Applied" outcome tracker per job card**
- Add a small "Mark Applied" button to each job card
- Stores `hd_applied_<jobId>` in localStorage with a timestamp
- Card gets a subtle "Applied" badge when marked
- Files: `app.js` (button + handler), `styles.css` (`.applied-badge`)
- Impact: starts building the feedback loop the Contrarian identified

**3. Fix PWA assets**
- Create `/manifest.json` with correct app name, icons, display: standalone
- Generate icon PNGs (192×192 and 512×512) using any online tool or Canvas API
- File: new `manifest.json`, new `assets/` folder
- Impact: app becomes installable on mobile (especially useful for job searching on the go)

### Tier 2 — High Value (days each)

**4. One-click Cover Letter generator**
- Add a "Generate Cover Letter" button to each job card (alongside Tailor)
- New `/api/coverletter` endpoint: same inputs as `/api/tailor`, returns a 3-paragraph cover letter
- Render in the same panel style as the tailor panel
- Files: `server.js` (new endpoint), `app.js` (button + render), `styles.css` (minimal — reuses tailor styles)
- Impact: completes the "application kit" — resume + cover letter from one click

**5. Interview Prep per job**
- "Prep for Interview" button that generates 5 likely interview questions + suggested answers based on the job description and the user's resume
- New `/api/interview-prep` endpoint
- Modal or expandable panel below the job card
- Files: `server.js`, `app.js`, `styles.css`
- Impact: extends the product lifecycle — users stay in HiringDesk through the full hiring cycle, not just the search

**6. Skills market trend indicator**
- On the Resume Analysis hero card, add a "Skills Trending" row
- After the initial scan, fire a second lightweight Claude call: "Which of these skills are increasing in demand in job postings right now?"
- Display as up/flat/down arrows per top skill chip
- Files: `server.js` (new endpoint or add to `/api/analyze`), `app.js`, `styles.css`
- Impact: starts the "career intelligence" story — the market is telling you what to learn

### Tier 3 — Platform Vision (weeks)

**7. User accounts + history**
- Add authentication (simplest: email magic link via `nodemailer`, or Google OAuth)
- Store scan results and tailor history in SQLite (extend `db.js`)
- "My History" panel in the sidebar showing past searches
- Unblocks everything that requires persistence across devices/sessions

**8. Saved jobs board**
- Allow users to pin any job to a persistent "My Jobs" list (separate from the session board)
- Stages: Interested → Applied → Interview → Offer → Rejected
- Becomes a personal ATS replacement
- Requires user accounts (see #7)

**9. Weekly skills gap report**
- Scheduled job (node-cron) that re-scans the market for the user's target roles
- Compares to their last resume scan and emails a "what changed this week" digest
- "Python demand up 8% for Product Manager roles — 3 new listings you qualify for"
- Requires user accounts + email (SMTP already configured)

---

## API Reference (internal endpoints)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/analyze` | Seeker: scan jobs + score resume. Body: FormData with `resumeText\|resumeFile`, `jobQuery`, `location` |
| `POST` | `/api/tailor` | Seeker: tailor resume for one job. Body: JSON `{resumeText, jobTitle, company, jobDescription, matchedSkills[], missingSkills[]}` |
| `POST` | `/api/recruiter/rank` | Recruiter: rank candidate pool. Body: FormData with job fields + `resumeFiles[]` or `batchText` |
| `POST` | `/api/recruiter/past-match` | Recruiter: resurface past DB candidates for a new role. Body: JSON job object |
| `POST` | `/api/recruiter/notify` | Recruiter: email the ranked report. Body: JSON `{job, candidates[], notificationEmail}` |

---

## Context from Design Discussions

The product was analyzed through a five-advisor council framework multiple times. Key conclusions:

**On overall differentiation from LinkedIn:**
- LinkedIn shows jobs. HiringDesk shows whether you qualify and exactly why. The match score + gap plan is the product, not discovery.
- The biggest differentiation opportunity is conversion (getting the resume to match the JD) — which is why Tailor My Resume is the core feature.

**On the Tailor feature:**
- Accept/reject UI (like BeBee) creates decision fatigue. Before/after diff is the right model — shows what changed without requiring granular decisions.
- The cert roadmap should be separate from the rewritten bullets — it's a different time horizon (weeks vs. today).
- localStorage cache is critical — users lose trust if their work disappears on refresh.

**On what all analyses missed:**
- No post-application lifecycle — the app drops users the moment they click Apply. Interview prep closes that gap.
- No social proof — no "X users analyzed" counter, no outcome data. Should be added once outcome tracking (#2 above) is in place.
- No network effects — LinkedIn's moat is its social graph, not its job listings. HiringDesk currently has no network component at all.

---

*Last updated: session covering design overhaul, Tailor My Resume upgrade, and download bug fixes.*
