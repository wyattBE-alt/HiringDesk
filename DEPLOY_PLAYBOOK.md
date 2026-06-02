# HiringDesk — Deploy Playbook
How to go from local → live website + downloadable desktop app.
Reference this every time you ship a new version.

---

## Prerequisites (one-time setup)

### Tools you need installed
```bash
brew install gh          # GitHub CLI — for uploading release files
brew install node        # Node.js runtime
```

### Accounts you need
- **GitHub** — github.com (free)
- **Railway** — railway.app (free tier, sign up with GitHub)

### GitHub token (one-time)
1. github.com → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Generate new token (classic)
3. Check **`repo`** AND **`workflow`** scopes
4. Set expiration: No expiration
5. Copy the token — looks like `ghp_xxxxxxxxxxxx`
6. Save it somewhere safe — you'll use it as your git password

---

## Part 1 — Prepare the project

### 1. package.json must have these correct
```json
{
  "scripts": {
    "start": "node server.js"   ← NOT --env-file=.env (breaks Railway)
  },
  "build": {
    "electronRebuild": ...      ← REMOVE THIS (invalid in electron-builder 25)
    "nsis": {
      "allowToChangeInstallationDirectory": true   ← NOT allowDirChange
    },
    "buildDependenciesFromSource": true,           ← replaces electronRebuild
    "publish": {
      "provider": "github",
      "releaseType": "release"
    }
  },
  "devDependencies": {
    "electron": "^28.0.0"      ← Use v28 LTS, NOT v36 (breaks native modules)
  }
}
```

### 2. dotenv must be imported in server.js
```js
import "dotenv/config";   // first line — Railway sets env vars natively, dotenv is a no-op
```

### 3. .gitignore must exist
```
node_modules/
.env
hiringdesk.db
hiringdesk.db-shm
hiringdesk.db-wal
dist/
.DS_Store
```

### 4. railway.json must exist
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": { "builder": "NIXPACKS" },
  "deploy": {
    "startCommand": "node server.js",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

### 5. Native packages must be in the project's node_modules
If you use `pdf-parse`, `pdfjs-dist`, `better-sqlite3` etc., make sure they are
in the project's own `node_modules` — NOT a parent folder.
```bash
cd ~/your-project
npm install pdfjs-dist --ignore-scripts   # --ignore-scripts skips native rebuilds
```

---

## Part 2 — Push to GitHub

```bash
cd ~/your-project

# First time only:
git init
git add -A
git commit -m "Initial commit"

# Go to github.com → New repository → Create (public, no template)
# Copy the repo URL, then:
git remote add origin https://YOUR-USERNAME:YOUR-TOKEN@github.com/YOUR-USERNAME/REPO-NAME.git
git push -u origin main
```

### Subsequent pushes (after making changes)
```bash
git add -A
git commit -m "describe what changed"
git push
```

### ⚠️ Common git auth errors
| Error | Fix |
|---|---|
| `Authentication failed` | Use your token as the password, not your GitHub password |
| `refusing to allow... workflow` | Your token is missing the `workflow` scope — edit token and add it |
| `remote rejected` | Token scope issue — same fix as above |

---

## Part 3 — Deploy to Railway (website goes live)

1. Go to **railway.app** → login with GitHub
2. **New Project → Deploy from GitHub repo** → select your repo
3. Click **Variables** tab → add:
   - `ANTHROPIC_API_KEY` = sk-ant-...
   - `JSEARCH_API_KEY` = your RapidAPI key
   - Any other secrets your app needs
4. **Settings → Networking → Generate Domain**
5. Your site is live at `yourapp.up.railway.app`

### ⚠️ Railway gotchas
| Issue | Fix |
|---|---|
| URL says `.railway.internal` | That's the private URL — generate a public domain in Settings → Networking |
| App crashes on start | Check Logs tab — usually a missing env var |
| Database resets on redeploy | Add a Railway Volume mounted at `/app` for persistence |

### Auto-redeploy
Every time you `git push`, Railway automatically redeploys. No action needed.

---

## Part 4 — Build the desktop app (.dmg)

```bash
cd ~/your-project
npm run dist:mac       # builds Mac app (arm64 + Intel)
npm run dist:win       # builds Windows .exe (run on a Windows machine or CI)
```

Files land in `dist/`:
- `YourApp-1.0.0-arm64.dmg` — Apple Silicon Macs (M1/M2/M3)
- `YourApp-1.0.0.dmg` — Intel Macs

### ⚠️ Build gotchas
| Error | Fix |
|---|---|
| `C++20 or later required` | Electron version too new — use `electron@28` in devDependencies |
| `electronRebuild unknown property` | Remove `electronRebuild` block, replace with `"buildDependenciesFromSource": true` |
| `allowDirChange unknown property` | Rename to `allowToChangeInstallationDirectory` |
| No `.icns` icon found | Use `.png` instead — `"icon": "assets/icon.png"` in mac build config |
| Code signing warning (skipped) | Normal without Apple Developer cert ($99/yr). Users right-click → Open to bypass |

---

## Part 5 — Publish download to GitHub Releases

```bash
# Log in (one-time — uses your ghp_ token)
gh auth login
# → GitHub.com → HTTPS → Paste token

# Create the release and upload files in one command
gh release create v1.0.0 \
  dist/YourApp-1.0.0-arm64.dmg \
  dist/YourApp-1.0.0.dmg \
  --title "YourApp v1.0.0" \
  --notes "First public release"
```

### For future versions
```bash
# Bump version in package.json first, then:
npm run dist:mac
gh release create v1.0.1 \
  dist/YourApp-1.0.1-arm64.dmg \
  dist/YourApp-1.0.1.dmg \
  --title "YourApp v1.0.1" \
  --notes "What changed in this version"
```

### ⚠️ Release gotchas
| Issue | Fix |
|---|---|
| Files too big to upload via GitHub web UI | Use `gh release create` command above instead |
| Download button 404s | Release not published yet, or wrong filename in the href |
| Download link returns 302 | ✅ That's correct — 302 means it redirects to the file |

---

## Part 6 — Wire download buttons in your home page

Your home page download buttons should point to:
```
https://github.com/YOUR-USERNAME/REPO-NAME/releases/latest/download/FILENAME.dmg
```

The `/releases/latest/download/` path always resolves to the most recent release,
so you never need to update the URL when you release a new version.

---

## Full checklist — going from local to live

```
[ ] package.json start script is "node server.js" (no --env-file)
[ ] dotenv imported at top of server.js
[ ] .gitignore exists and excludes .env, node_modules, dist/, *.db
[ ] railway.json exists
[ ] All packages installed in project's own node_modules (not parent folder)
[ ] Git repo initialized and pushed to GitHub
[ ] Railway project created and linked to GitHub repo
[ ] Environment variables set in Railway dashboard
[ ] Public domain generated in Railway settings
[ ] npm run dist:mac completed successfully
[ ] gh auth login completed
[ ] gh release create with .dmg files uploaded
[ ] Download button URLs in home page updated to your real GitHub username/repo
[ ] Verify download: curl -I https://github.com/YOU/REPO/releases/latest/download/App.dmg → should return 302
```

---

## Useful commands quick reference

```bash
# Push latest code (Railway auto-redeploys)
git add -A && git commit -m "update" && git push

# Build new Mac version
npm run dist:mac

# Publish new release
gh release create v1.X.X dist/*.dmg --title "v1.X.X" --notes "changelog"

# Check if your live site is up
curl -o /dev/null -w "%{http_code}" https://yourapp.up.railway.app

# Check if download link works
curl -I https://github.com/YOU/REPO/releases/latest/download/App.dmg
# → 302 = working ✅   404 = file not uploaded yet ❌

# Run locally
node --env-file=.env server.js

# Open desktop app locally (no build needed)
npm run electron
```
