// ── PathAscent shared auth module ────────────────────────────────────────────
// Included by home.html, index.html, recruiter.html, and dashboard pages.
// Handles: token storage, nav injection, modal (login + register), session init.

const HD_TOKEN_KEY = "hd_token";

// ── Token helpers ─────────────────────────────────────────────────────────────

export function getToken() {
  return localStorage.getItem(HD_TOKEN_KEY) || null;
}

function setToken(t) { localStorage.setItem(HD_TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(HD_TOKEN_KEY); }

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch(url, opts = {}) {
  const token = getToken();
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function fetchMe() {
  const { ok, data } = await apiFetch("/api/auth/me");
  return ok ? data.user : null;
}

export async function logout() {
  await apiFetch("/api/auth/logout", { method: "POST" });
  clearToken();
  window.location.reload();
}

// ── Auth modal HTML ───────────────────────────────────────────────────────────

function injectModalStyles() {
  if (document.getElementById("hd-auth-styles")) return;
  const style = document.createElement("style");
  style.id = "hd-auth-styles";
  style.textContent = `
    .hd-auth-overlay {
      position: fixed; inset: 0; z-index: 9000;
      background: rgba(0,0,0,0.72);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
      padding: 20px;
      animation: hd-fade-in 180ms ease both;
    }
    @keyframes hd-fade-in { from { opacity:0 } to { opacity:1 } }
    @keyframes hd-slide-up { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:none } }

    .hd-auth-box {
      background: #0a0c1a;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 18px;
      padding: 36px 32px 28px;
      width: 100%; max-width: 420px;
      box-shadow: 0 32px 80px rgba(0,0,0,0.8);
      animation: hd-slide-up 220ms cubic-bezier(0.23,1,0.32,1) both;
      position: relative;
    }

    .hd-auth-close {
      position: absolute; top: 16px; right: 16px;
      background: rgba(255,255,255,0.06); border: none; color: #8a96b8;
      width: 30px; height: 30px; border-radius: 50%; cursor: pointer;
      font-size: 16px; display: flex; align-items: center; justify-content: center;
      transition: background 150ms, color 150ms;
    }
    .hd-auth-close:hover { background: rgba(255,255,255,0.12); color: #fff; }

    .hd-auth-logo {
      display: inline-flex; align-items: center; gap: 7px;
      font-size: 0.65rem; font-weight: 700; letter-spacing: 0.18em;
      text-transform: uppercase; color: #8fb6ff; margin-bottom: 8px;
    }
    .hd-auth-logo svg { filter: drop-shadow(0 0 5px rgba(111,139,255,0.5)); }
    .hd-auth-title {
      font-family: 'Syne', system-ui, sans-serif;
      font-size: 1.7rem; font-weight: 800; letter-spacing: -0.03em;
      color: #eef0f8; margin-bottom: 4px;
    }
    .hd-auth-sub { font-size: 0.85rem; color: #8a96b8; margin-bottom: 24px; }

    .hd-auth-tabs {
      display: flex; gap: 4px;
      background: rgba(255,255,255,0.05);
      border-radius: 10px; padding: 3px;
      margin-bottom: 22px;
    }
    .hd-auth-tab {
      flex: 1; padding: 7px; border: none; border-radius: 8px;
      font-size: 0.82rem; font-weight: 600; cursor: pointer;
      background: transparent; color: #8a96b8; transition: background 150ms, color 150ms;
    }
    .hd-auth-tab.active { background: #1e3a8a; color: #fff; }

    .hd-field { margin-bottom: 14px; }
    .hd-field label {
      display: block; font-size: 0.75rem; font-weight: 600;
      color: #8a96b8; margin-bottom: 5px; letter-spacing: 0.04em;
    }
    .hd-field input, .hd-field select {
      width: 100%; padding: 10px 13px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 9px; color: #eef0f8; font-size: 0.9rem;
      transition: border-color 150ms, box-shadow 150ms;
      outline: none;
    }
    .hd-field input:focus, .hd-field select:focus {
      border-color: rgba(91,140,255,0.6);
      box-shadow: 0 0 0 3px rgba(91,140,255,0.15);
    }
    .hd-field select option { background: #0a0c1a; }

    .hd-auth-free-note {
      font-size: 0.75rem; color: #48506a; margin-bottom: 16px; line-height: 1.5;
    }
    .hd-auth-free-note strong { color: #8fb6ff; }

    .hd-auth-btn {
      width: 100%; padding: 12px; border: none; border-radius: 10px;
      background: linear-gradient(120deg, #35d6f0 0%, #6f8bff 52%, #8b6cff 100%);
      color: #fff; font-size: 0.92rem; font-weight: 700;
      cursor: pointer; transition: filter 150ms, transform 100ms;
      box-shadow: 0 0 22px rgba(111,139,255,0.30); margin-top: 4px;
    }
    .hd-auth-btn:hover { filter: brightness(1.08); }
    .hd-auth-btn:active { transform: scale(0.98); }
    .hd-auth-btn:disabled { opacity: 0.55; cursor: not-allowed; }

    .hd-auth-error {
      font-size: 0.82rem; color: #ef4444; margin-top: 10px;
      min-height: 18px; text-align: center;
    }
    .hd-auth-switch {
      text-align: center; margin-top: 16px;
      font-size: 0.8rem; color: #48506a;
    }
    .hd-auth-switch a { color: #8fb6ff; cursor: pointer; text-decoration: none; }
    .hd-auth-switch a:hover { text-decoration: underline; }

    /* Nav user pill */
    .hd-nav-user {
      display: flex; align-items: center; gap: 8px;
    }
    .hd-nav-avatar {
      width: 30px; height: 30px; border-radius: 50%;
      background: linear-gradient(135deg, #35d6f0, #8b6cff);
      display: flex; align-items: center; justify-content: center;
      font-size: 0.75rem; font-weight: 700; color: #fff; flex-shrink: 0;
    }
    .hd-nav-email {
      font-size: 0.8rem; color: #8a96b8;
      max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .hd-nav-dashboard-btn {
      font-size: 0.78rem; font-weight: 600; color: #eef0f8;
      padding: 6px 12px; border-radius: 999px;
      background: rgba(91,140,255,0.15); border: 1px solid rgba(91,140,255,0.25);
      text-decoration: none; transition: background 150ms;
    }
    .hd-nav-dashboard-btn:hover { background: rgba(91,140,255,0.28); }
    .hd-nav-logout-btn {
      font-size: 0.78rem; font-weight: 500; color: #8a96b8;
      padding: 6px 10px; border-radius: 999px; border: none;
      background: transparent; cursor: pointer; transition: color 150ms;
    }
    .hd-nav-logout-btn:hover { color: #ef4444; }

    /* Sidebar auth panel (index + recruiter pages) */
    .hd-sidebar-auth {
      margin-top: auto; padding-top: 16px;
      border-top: 1px solid rgba(255,255,255,0.07);
    }
    .hd-sidebar-auth-guest {
      font-size: 0.78rem; color: #48506a; line-height: 1.55; margin-bottom: 10px;
    }
    .hd-sidebar-auth-guest strong { color: #8fb6ff; }
    .hd-sidebar-login-btn {
      width: 100%; padding: 9px; border-radius: 9px; font-size: 0.83rem; font-weight: 600;
      border: 1px solid rgba(91,140,255,0.3); background: rgba(91,140,255,0.1);
      color: #8fb6ff; cursor: pointer; transition: background 150ms, border-color 150ms;
    }
    .hd-sidebar-login-btn:hover { background: rgba(91,140,255,0.18); border-color: rgba(91,140,255,0.5); }
    .hd-sidebar-user { display: flex; flex-direction: column; gap: 6px; }
    .hd-sidebar-user-email { font-size: 0.78rem; color: #8a96b8; }
    .hd-sidebar-dashboard-link {
      font-size: 0.82rem; font-weight: 600; color: #8fb6ff;
      text-decoration: none; display: flex; align-items: center; gap: 6px;
    }
    .hd-sidebar-dashboard-link:hover { text-decoration: underline; }
    .hd-sidebar-logout-btn {
      font-size: 0.75rem; color: #48506a; border: none; background: none;
      cursor: pointer; text-align: left; padding: 0; transition: color 150ms;
    }
    .hd-sidebar-logout-btn:hover { color: #ef4444; }

    /* Save-to-profile prompt banner */
    .hd-save-banner {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 13px 16px; border-radius: 11px; margin-top: 12px;
      background: rgba(91,140,255,0.1); border: 1px solid rgba(91,140,255,0.22);
    }
    .hd-save-banner-text { font-size: 0.82rem; color: #8a96b8; line-height: 1.45; }
    .hd-save-banner-text strong { color: #eef0f8; }
    .hd-save-btn {
      flex-shrink: 0; padding: 8px 14px; border-radius: 8px; font-size: 0.8rem;
      font-weight: 700; border: none; background: #5b8cff; color: #fff;
      cursor: pointer; transition: background 150ms;
      white-space: nowrap;
    }
    .hd-save-btn:hover { background: #4272e6; }
    .hd-save-btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .hd-save-btn.saved { background: #16a34a; }
    /* Auto-save status states */
    .hd-save-banner--saving { opacity: 0.85; }
    .hd-save-banner--saved {
      background: rgba(34,197,94,0.1); border-color: rgba(34,197,94,0.28);
    }
    .hd-save-banner--saved .hd-save-banner-text strong { color: #4ade80; }
    .hd-save-banner--error {
      background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.28);
    }
  `;
  document.head.appendChild(style);
}

// ── Modal ─────────────────────────────────────────────────────────────────────

let _modalEl = null;
let _activeTab = "login";

function buildModal() {
  if (_modalEl) return;
  injectModalStyles();
  _modalEl = document.createElement("div");
  _modalEl.className = "hd-auth-overlay";
  _modalEl.setAttribute("role", "dialog");
  _modalEl.setAttribute("aria-modal", "true");
  _modalEl.setAttribute("aria-label", "Sign in to PathAscent");
  _modalEl.innerHTML = `
    <div class="hd-auth-box">
      <button class="hd-auth-close" aria-label="Close">✕</button>
      <p class="hd-auth-logo"><img src="/assets/pathascent-mark.png" alt="" style="height:22px;width:auto;display:block" />PathAscent</p>
      <h2 class="hd-auth-title" id="hd-modal-title">Welcome back</h2>
      <p class="hd-auth-sub" id="hd-modal-sub">Sign in to save your progress and track applications.</p>

      <div class="hd-auth-tabs">
        <button class="hd-auth-tab active" data-tab="login">Sign In</button>
        <button class="hd-auth-tab" data-tab="register">Create Account</button>
      </div>

      <form id="hd-auth-form" autocomplete="on">
        <div class="hd-field">
          <label for="hd-email">Email</label>
          <input id="hd-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required />
        </div>
        <div class="hd-field">
          <label for="hd-password">Password</label>
          <input id="hd-password" name="password" type="password" autocomplete="current-password" placeholder="••••••••" required />
        </div>
        <div class="hd-field" id="hd-role-field" style="display:none">
          <label for="hd-role">I am a…</label>
          <select id="hd-role" name="role">
            <option value="applicant">Job Seeker — track my applications & resume score</option>
            <option value="recruiter">Recruiter — track my candidate rankings & talent pool</option>
          </select>
        </div>
        <p class="hd-auth-free-note" id="hd-free-note" style="display:none">
          <strong>PathAscent is free to use without an account.</strong> Creating one just lets you save your history and track applications over time.
        </p>
        <button type="submit" class="hd-auth-btn" id="hd-auth-submit">Sign In</button>
        <p class="hd-auth-error" id="hd-auth-error"></p>
        <a id="hd-forgot-link" style="display:block;text-align:center;margin-top:12px;font-size:0.8rem;color:#8fb6ff;cursor:pointer;text-decoration:none">Forgot password?</a>
      </form>
    </div>
  `;

  // Tab switching
  _modalEl.querySelectorAll(".hd-auth-tab").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // Close on overlay click or X
  _modalEl.addEventListener("click", e => { if (e.target === _modalEl) closeModal(); });
  _modalEl.querySelector(".hd-auth-close").addEventListener("click", closeModal);

  // Form submission
  _modalEl.querySelector("#hd-auth-form").addEventListener("submit", handleSubmit);
  _modalEl.querySelector("#hd-forgot-link").addEventListener("click", handleForgot);

  document.body.appendChild(_modalEl);
}

async function handleForgot() {
  const emailEl = _modalEl.querySelector("#hd-email");
  const email = emailEl.value.trim();
  const errEl = _modalEl.querySelector("#hd-auth-error");
  if (!email) {
    errEl.style.color = "#f59e0b";
    errEl.textContent = "Enter your email above, then click Forgot password.";
    emailEl.focus();
    return;
  }
  errEl.style.color = "#8a96b8";
  errEl.textContent = "Sending reset link…";
  try {
    const res = await fetch("/api/auth/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const data = await res.json().catch(() => ({}));
    errEl.style.color = "#22c55e";
    errEl.textContent = data.message || "If that email has an account, a reset link is on its way.";
  } catch {
    errEl.style.color = "#ef4444";
    errEl.textContent = "Network error. Please try again.";
  }
}

function switchTab(tab) {
  _activeTab = tab;
  _modalEl.querySelectorAll(".hd-auth-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  const isRegister = tab === "register";
  _modalEl.querySelector("#hd-modal-title").textContent = isRegister ? "Create your account" : "Welcome back";
  _modalEl.querySelector("#hd-modal-sub").textContent = isRegister
    ? "Free forever. Sign up to save your history."
    : "Sign in to access your saved history.";
  _modalEl.querySelector("#hd-role-field").style.display = isRegister ? "block" : "none";
  _modalEl.querySelector("#hd-free-note").style.display = isRegister ? "block" : "none";
  _modalEl.querySelector("#hd-auth-submit").textContent = isRegister ? "Create Account" : "Sign In";
  _modalEl.querySelector("#hd-password").autocomplete = isRegister ? "new-password" : "current-password";
  _modalEl.querySelector("#hd-forgot-link").style.display = isRegister ? "none" : "block";
  const err = _modalEl.querySelector("#hd-auth-error");
  err.textContent = ""; err.style.color = "";
}

async function handleSubmit(e) {
  e.preventDefault();
  const email = _modalEl.querySelector("#hd-email").value.trim();
  const password = _modalEl.querySelector("#hd-password").value;
  const role = _modalEl.querySelector("#hd-role").value;
  const errEl = _modalEl.querySelector("#hd-auth-error");
  const btn = _modalEl.querySelector("#hd-auth-submit");

  errEl.textContent = ""; errEl.style.color = "";
  btn.disabled = true;
  btn.textContent = "Working…";

  try {
    const url = _activeTab === "register" ? "/api/auth/register" : "/api/auth/login";
    const body = _activeTab === "register" ? { email, password, role } : { email, password };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || "Something went wrong."; return; }

    setToken(data.token);
    closeModal();
    // Notify any listeners (e.g. index.html can trigger save after login)
    window.dispatchEvent(new CustomEvent("hd:authed", { detail: data.user }));
    initNav(data.user);
  } catch {
    errEl.textContent = "Network error. Please try again.";
  } finally {
    btn.disabled = false;
    btn.textContent = _activeTab === "register" ? "Create Account" : "Sign In";
  }
}

export function openModal(tab = "login") {
  buildModal();
  switchTab(tab);
  document.body.style.overflow = "hidden";
  _modalEl.style.display = "flex";
  _modalEl.querySelector("#hd-email").focus();
}

function closeModal() {
  if (_modalEl) _modalEl.style.display = "none";
  document.body.style.overflow = "";
}

// ── Nav injection (home.html nav-links) ───────────────────────────────────────

export function initNav(user) {
  // Home page nav
  const navLinks = document.querySelector(".nav-links");
  if (navLinks) {
    // Remove existing auth buttons injected previously
    navLinks.querySelectorAll(".hd-nav-injected").forEach(el => el.remove());

    if (user) {
      const dashPath = user.role === "recruiter" ? "/dashboard-recruiter.html" : "/dashboard-applicant.html";
      const initial = (user.email || "?")[0].toUpperCase();
      const pill = document.createElement("div");
      pill.className = "hd-nav-user hd-nav-injected";
      pill.innerHTML = `
        <div class="hd-nav-avatar">${initial}</div>
        <span class="hd-nav-email">${user.email}</span>
        ${user.isAdmin ? `<a href="/workroom.html" class="hd-nav-dashboard-btn">Work Room</a>` : ""}
        <a href="${dashPath}" class="hd-nav-dashboard-btn">My Dashboard</a>
        <button class="hd-nav-logout-btn">Sign Out</button>
      `;
      pill.querySelector(".hd-nav-logout-btn").addEventListener("click", logout);
      navLinks.appendChild(pill);
    } else {
      const loginBtn = document.createElement("button");
      loginBtn.className = "nav-link hd-nav-injected";
      loginBtn.textContent = "Sign In";
      loginBtn.style.cssText = "cursor:pointer;background:none;border:none;";
      loginBtn.addEventListener("click", () => openModal("login"));

      const signupBtn = document.createElement("button");
      signupBtn.className = "nav-link nav-link-primary hd-nav-injected";
      signupBtn.textContent = "Sign Up";
      signupBtn.style.cssText = "cursor:pointer;border:none;";
      signupBtn.addEventListener("click", () => openModal("register"));

      // Remove existing "Get Started" primary button to avoid duplication
      const existing = navLinks.querySelector(".nav-link-primary:not(.hd-nav-injected)");
      if (existing) existing.remove();

      navLinks.appendChild(loginBtn);
      navLinks.appendChild(signupBtn);
    }
  }
}

// ── Sidebar auth panel (index.html / recruiter.html) ─────────────────────────

export function initSidebarAuth(user, { dashboardHref = "/dashboard-applicant.html" } = {}) {
  injectModalStyles();
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar) return;

  // Remove any existing panel
  sidebar.querySelector(".hd-sidebar-auth")?.remove();

  const panel = document.createElement("div");
  panel.className = "hd-sidebar-auth";

  if (user) {
    const initial = (user.email || "?")[0].toUpperCase();
    panel.innerHTML = `
      <div class="hd-sidebar-user">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <div class="hd-nav-avatar" style="width:26px;height:26px;font-size:0.7rem;">${initial}</div>
          <span class="hd-sidebar-user-email">${user.email}</span>
        </div>
        <a href="${dashboardHref}" class="hd-sidebar-dashboard-link">
          <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="4" height="4" rx="1" stroke="#8fb6ff" stroke-width="1.2"/><rect x="7" y="1" width="4" height="4" rx="1" stroke="#8fb6ff" stroke-width="1.2"/><rect x="1" y="7" width="4" height="4" rx="1" stroke="#8fb6ff" stroke-width="1.2"/><rect x="7" y="7" width="4" height="4" rx="1" stroke="#8fb6ff" stroke-width="1.2"/></svg>
          My Dashboard
        </a>
        ${user.isAdmin ? `<a href="/workroom.html" class="hd-sidebar-dashboard-link">📊 Work Room</a>` : ""}
        <button class="hd-sidebar-logout-btn">Sign out</button>
      </div>
    `;
    panel.querySelector(".hd-sidebar-logout-btn").addEventListener("click", logout);
  } else {
    panel.innerHTML = `
      <p class="hd-sidebar-auth-guest">
        <strong>Save your history</strong> — sign up free to track your score over time and log every application.
      </p>
      <button class="hd-sidebar-login-btn">Sign In / Create Account</button>
    `;
    panel.querySelector(".hd-sidebar-login-btn").addEventListener("click", () => openModal("login"));
  }

  sidebar.appendChild(panel);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

export async function initAuth({ sidebar = false, dashboardHref } = {}) {
  injectModalStyles();
  const user = await fetchMe();
  initNav(user);
  if (sidebar) initSidebarAuth(user, { dashboardHref });
  return user;
}
