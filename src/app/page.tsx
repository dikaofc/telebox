"use client";

import { useState, useEffect } from "react";

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
      const json: UploadResult = await res.json();
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

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuth({ logged_in: false });
  }

  return (
    <main style={{ maxWidth: 560, margin: "10vh auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>telebox</h1>
        <div style={{ fontSize: 13, color: "#666", display: "flex", gap: 8, alignItems: "center" }}>
          <a href="/pastebin" style={{ color: "#666", textDecoration: "underline" }}>pastebin</a>
          {" / "}
          {auth?.logged_in ? (
            <>
              <a href="/my" style={{ color: "#666", textDecoration: "underline" }}>files</a>
              {" / "}
              <a href="/profile" style={{ color: "#666", textDecoration: "underline" }}>profile</a>
              {" / "}
              <button onClick={logout} style={{ background: "none", border: "none", color: "#999", cursor: "pointer", textDecoration: "underline" }}>logout</button>
            </>
          ) : (
            <>
              <button onClick={() => setAuthMode("login")} style={{ background: "none", border: "none", color: "#666", cursor: "pointer", textDecoration: "underline" }}>login</button>
              {" / "}
              <button onClick={() => setAuthMode("signup")} style={{ background: "none", border: "none", color: "#666", cursor: "pointer", textDecoration: "underline" }}>signup</button>
            </>
          )}
        </div>
      </div>
      <p style={{ color: "#666", marginTop: 6 }}>simple file hosting. telegram-backed storage.</p>

      {authMode && (
        <form
          onSubmit={(e) => { e.preventDefault(); authSubmit(authMode); }}
          style={{ marginTop: 20, padding: 16, background: "#f5f5f5", borderRadius: 8 }}
        >
          <h3 style={{ margin: "0 0 12px" }}>{authMode === "login" ? "Login" : "Sign Up"}</h3>
          <input
            type="email"
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ display: "block", width: "100%", padding: 8, marginBottom: 8, borderRadius: 4, border: "1px solid #ccc", fontSize: 14, boxSizing: "border-box" }}
          />
          <input
            type="password"
            placeholder="password (min 8 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            style={{ display: "block", width: "100%", padding: 8, marginBottom: 12, borderRadius: 4, border: "1px solid #ccc", fontSize: 14, boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" style={{ padding: "8px 16px", background: "#111", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14 }}>
              {authMode === "login" ? "Login" : "Sign Up"}
            </button>
            <button type="button" onClick={() => setAuthMode(null)} style={{ padding: "8px 16px", background: "#eee", border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", fontSize: 14 }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <label
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); uploadFiles(e.dataTransfer.files); }}
        style={{
          display: "block",
          border: dragOver ? "2px solid #111" : "1px dashed #999",
          borderRadius: 8,
          padding: 40,
          textAlign: "center",
          cursor: "pointer",
          marginTop: 24,
          background: dragOver ? "#f5f5f5" : "transparent",
        }}
      >
        <input
          type="file"
          multiple
          hidden
          onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); }}
        />
        {busy ? "uploading\u2026" : "drop files or click to choose (multi-file ok)"}
        <label
          style={{ display: "block", fontSize: 13, color: "#666", marginTop: 16 }}
        >
          Expiry:{" "}
          <select
            value={ttl}
            onChange={(e) => setTtl(e.target.value)}
            style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #ccc", fontSize: 13, marginLeft: 4 }}
          >
            {TTL_OPTIONS.map(([v, label]) => (
              <option key={v || "never"} value={v}>{label}</option>
            ))}
          </select>
        </label>
      </label>

      {error && <p style={{ color: "#c00", marginTop: 16 }}>{error}</p>}

      {results.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {results.map((r) => (
            <div key={r.id} style={{ marginBottom: 12, padding: 12, background: "#f9f9f9", borderRadius: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 500, wordBreak: "break-all" }}>{r.name}</div>
              {r.dedup && <div style={{ fontSize: 12, color: "#666" }}>dedup (already hosted)</div>}
              <code style={{ display: "block", marginTop: 4, padding: 6, background: "#f2f2f2", borderRadius: 4, fontSize: 13, wordBreak: "break-all" }}>
                {r.url}
              </code>
              <div style={{ marginTop: 6, fontSize: 13 }}>
                <a href={`/i/${r.id}`}>preview</a>
                {" / "}
                <a href={`${r.url}?dl=1`}>download</a>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}