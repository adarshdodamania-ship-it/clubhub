// frontend/src/App.js
import React, { useEffect, useState } from "react";
import Home from "./pages/Home";
import "./App.css";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:4000";

function Logo() {
  return (
    <div className="auth-logo">
      <img
        src="/kle-logo.png"
        alt="KLE Tech"
        onError={(e) => {
          e.target.style.display = 'none';
        }}
      />
    </div>
  );
}

function Input({ label, type = "text", icon, ...props }) {
  return (
    <div className="input-field">
      <label className="input-label">{label}</label>
      <div className="input-wrapper">
        {icon && <span className="input-icon">{icon}</span>}
        <input className="input" type={type} {...props} />
      </div>
    </div>
  );
}

function AuthCard({
  onSendCode,
  onVerifyAndSetPassword,
  onLogin,
  state,
  actions,
}) {
  const { view, email, code, password, confirm, msg } = state;
  const { setEmail, setCode, setPassword, setConfirm, setView } = actions;

  return (
    <div className="auth-card">
      <Logo />

      <div className="auth-header">
        <h1 className="auth-title">Club Hub</h1>
        <p className="auth-subtitle">KLE Technological University</p>
      </div>

      {view === "choose" && (
        <>
          <p className="auth-description">
            Your central hub for club announcements, events, and campus activities.
            Connect with clubs and stay updated.
          </p>
          <div className="auth-buttons">
            <button className="btn btn-primary btn-large" onClick={() => setView("login")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M15 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H15M10 17L15 12L10 7M15 12H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Log in
            </button>
            <button className="btn btn-secondary btn-large" onClick={() => setView("signup-email")}>
              Sign up
            </button>
          </div>
          <p className="auth-footer-text">
            By signing up, you agree to follow KLE Tech campus guidelines and club policies.
          </p>
        </>
      )}

      {view === "login" && (
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            onLogin();
          }}
        >
          <p className="form-title">Welcome back!</p>

          <Input
            label="Email Address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your.email@kletech.ac.in"
            required
            icon="📧"
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
            icon="🔒"
          />

          <div className="auth-buttons">
            <button className="btn btn-primary btn-large" type="submit">
              Sign in
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M5 12H19M19 12L12 5M19 12L12 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <button
            type="button"
            className="link-button"
            onClick={() => setView("signup-email")}
          >
            Don't have an account? <strong>Sign up</strong>
          </button>
        </form>
      )}

      {view === "signup-email" && (
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSendCode();
          }}
        >
          <p className="form-title">Create your account</p>
          <p className="form-subtitle">Join Club Hub to stay connected with your campus community</p>

          <Input
            label="Email Address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your.email@kletech.ac.in"
            required
            icon="📧"
          />

          <div className="auth-buttons">
            <button className="btn btn-primary btn-large" type="submit">
              Send verification code
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <button
            type="button"
            className="link-button"
            onClick={() => setView("choose")}
          >
            ← Back
          </button>
        </form>
      )}

      {view === "signup-code" && (
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            onVerifyAndSetPassword();
          }}
        >
          <p className="form-title">Verify your email</p>
          <p className="form-subtitle">
            We sent a 6-digit code to <strong>{email}</strong>
          </p>

          <Input
            label="Verification Code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter 6-digit code"
            maxLength="6"
            required
            icon="🔢"
          />
          <Input
            label="Create Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 6 characters"
            required
            icon="🔒"
          />
          <Input
            label="Confirm Password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Re-enter password"
            required
            icon="✓"
          />

          <div className="auth-buttons">
            <button className="btn btn-primary btn-large" type="submit">
              Create account
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M5 13L9 17L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <button
            type="button"
            className="link-button"
            onClick={() => setView("choose")}
          >
            Cancel
          </button>
        </form>
      )}

      {msg && (
        <div className={`status-message ${msg.includes('✗') ? 'error' : 'success'}`}>
          {msg}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState("choose");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState("");
  const [token, setToken] = useState(localStorage.getItem("token") || null);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok && j.user) {
          setProfile(j.user);
          setView("app");
        } else {
          setToken(null);
          localStorage.removeItem("token");
          setView("choose");
        }
      })
      .catch(() => {
        setToken(null);
        localStorage.removeItem("token");
        setView("choose");
      });
  }, [token]);

  async function sendCode() {
    setMsg("📤 Sending verification code...");
    try {
      const r = await fetch(`${API_BASE}/auth/send-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed to send code");
      setMsg("✓ Code sent! Check your email inbox.");
      setView("signup-code");
    } catch (err) {
      setMsg("✗ Error: " + err.message);
    }
  }

  async function verifyAndSetPassword() {
    setMsg("🔄 Verifying your account...");
    if (password.length < 6) {
      setMsg("✗ Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      setMsg("✗ Passwords do not match");
      return;
    }
    try {
      const r = await fetch(`${API_BASE}/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, password, confirm }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Verification failed");
      setToken(j.token);
      localStorage.setItem("token", j.token);
      const visibleEmail = (j.user && (j.user.email || j.user.sub)) || email;
      localStorage.setItem("user_email", visibleEmail);
      setProfile(j.user);
      setMsg("✓ Welcome to Club Hub!");
      setView("app");
    } catch (err) {
      setMsg("✗ Error: " + err.message);
    }
  }

  async function login() {
    setMsg("🔄 Signing you in...");
    try {
      const r = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Login failed");
      setToken(j.token);
      localStorage.setItem("token", j.token);
      const visibleEmail = (j.user && (j.user.email || j.user.sub)) || email;
      localStorage.setItem("user_email", visibleEmail);
      setProfile(j.user);
      setMsg("✓ Welcome back!");
      setView("app");
    } catch (err) {
      setMsg("✗ Error: " + err.message);
    }
  }

  function logout() {
    setToken(null);
    localStorage.removeItem("token");
    setProfile(null);
    setEmail("");
    setPassword("");
    setCode("");
    setConfirm("");
    setMsg("");
    setView("choose");
  }

  // Show auth screen if not logged in
  if (view !== "app") {
    return (
      <div className="auth-page">
        <div className="auth-container">
          <AuthCard
            onSendCode={sendCode}
            onVerifyAndSetPassword={verifyAndSetPassword}
            onLogin={login}
            state={{ view, email, code, password, confirm, msg }}
            actions={{ setEmail, setCode, setPassword, setConfirm, setView }}
          />
        </div>
      </div>
    );
  }

  return <Home />;
}