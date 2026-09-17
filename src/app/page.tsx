"use client";

import { useState, useEffect } from "react";
import { SiteNav } from "@/components/site-nav";
import { IconUpload, IconFile, IconDownload, IconClock, IconEye, IconCopy } from "@/components/icons";

type Result = { id: string; url: string; name: string; size?: number; mime?: string; dedup?: boolean };
type UploadResult = Result | { files: Result[] };
type Auth = { logged_in: boolean; email?: string };

export default function Home() {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup" | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [ttl, setTtl] = useState("");

  const TTL_OPTIONS: [string, string][] = [
    ["", "keep forever"],
    ["3600", "1 hour"],
    ["86400", "1 day"],
    ["604800", "7 days"],
    ["2592000", "30 days"],
  ];

  useEffect(() => {
    fetch("/api/auth/whoami").then((r) => r.json()).then(setAuth).catch(() => setAuth({ logged_in: false }));
  }, []);

  async function uploadFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setBusy(true);
    setError(null);
    setResults([]);
    try {
      const fd = new FormData();
      arr.forEach((f) => fd.append("file", f));
      if (ttl) fd.append("ttl", ttl);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const text = await res.text();
      let json: UploadResult;
      try {
        json = JSON.parse(text) as UploadResult;
      } catch {
        throw new Error(`upload failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
      }
      if (!res.ok) throw new Error((json as { error?: string }).error ?? res.statusText);
      if ("files" in json) setResults(json.files);
      else setResults([json]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function authSubmit(mode: "login" | "signup") {
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setAuth({ logged_in: true, email });
      setAuthMode(null);
      setEmail("");
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "auth failed");
    }
  }

  return (
    <>
      <SiteNav />
      <main className="container container-narrow">
        <div className="page-header">
          <div>
            <h1 className="page-title">Upload files</h1>
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
              simple file hosting. telegram-backed storage.
            </p>
          </div>
          {auth?.logged_in === false && (
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={() => setAuthMode("login")}>login</button>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setAuthMode("signup")}>signup</button>
            </div>
          )}
        </div>

        {authMode && (
          <form
            onSubmit={(e) => { e.preventDefault(); authSubmit(authMode); }}
            className="card"
            style={{ background: "var(--surface)" }}
          >
            <h3 className="section-title">{authMode === "login" ? "Login" : "Sign Up"}</h3>
            <div className="field">
              <label className="field-label" htmlFor="auth-email">email</label>
              <input id="auth-email" type="email" className="input" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="auth-password">password</label>
              <input id="auth-password" type="password" className="input" placeholder={authMode === "signup" ? "min 8 characters" : "your password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            </div>
            <div className="form-row">
              <button type="submit" className="btn btn-primary">{authMode === "login" ? "Login" : "Sign Up"}</button>
              <button type="button" className="btn" onClick={() => setAuthMode(null)}>Cancel</button>
            </div>
          </form>
        )}

        <label
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); uploadFiles(e.dataTransfer.files); }}
          className="dropzone"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            border: dragOver ? "2px solid var(--foreground)" : "1px dashed var(--faint)",
            borderRadius: "var(--radius)",
            padding: "48px 24px",
            textAlign: "center",
            cursor: "pointer",
            marginTop: 8,
            background: dragOver ? "var(--surface)" : "transparent",
            transition: "border-color .12s, background .12s",
          }}
        >
          <input type="file" multiple hidden onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); }} />
          <IconUpload size={32} />
          {busy ? "uploading\u2026" : "drop files or click to choose (multi-file ok)"}
          <span className="faint" style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <IconClock size={13} />
            Expiry:
            <select value={ttl} onChange={(e) => setTtl(e.target.value)} className="select" style={{ padding: "4px 8px", fontSize: 13, marginLeft: 4 }}>
              {TTL_OPTIONS.map(([v, label]) => (
                <option key={v || "never"} value={v}>{label}</option>
              ))}
            </select>
          </span>
        </label>

        {error && <p className="error-text">{error}</p>}

        {results.length > 0 && (
          <div style={{ marginTop: 16 }}>
            {results.map((r) => (
              <div key={r.id} className="card" style={{ background: "var(--surface)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <IconFile size={15} />
                  <span style={{ fontWeight: 500, wordBreak: "break-all" }}>{r.name}</span>
                  {r.dedup && <span className="badge">dedup</span>}
                </div>
                <code className="code-block" style={{ marginTop: 8 }}>{r.url}</code>
                <div className="card-actions">
                  <a href={`/i/${r.id}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <IconEye size={14} /> preview
                  </a>
                  <a href={`${r.url}?dl=1`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <IconDownload size={14} /> download
                  </a>
                  <button
                    type="button"
                    className="link-btn"
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}
                    onClick={() => navigator.clipboard.writeText(r.url)}
                  >
                    <IconCopy size={14} /> copy
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}