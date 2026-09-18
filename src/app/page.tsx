"use client";

import { useState, useEffect } from "react";
import { SiteNav } from "@/components/site-nav";
import { IconUpload, IconFile, IconDownload, IconClock, IconEye, IconCopy } from "@/components/icons";

type Result = { id: string; url: string; name: string; size?: number; mime?: string; dedup?: boolean };
type UploadResult = Result | { files: Result[] };
type Auth = { logged_in: boolean; email?: string };
const MAX_BROWSER_UPLOAD_BYTES = 50 * 1024 * 1024;
// Direct single-request uploads only for small bodies: multipart form-data
// parsing is the fragile path (it failed on multi-MB bodies), so anything
// bigger goes through the raw-chunk protocol below.
const MAX_DIRECT_UPLOAD_BYTES = 1 * 1024 * 1024;

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
  const [progress, setProgress] = useState<{ name: string; done: number; total: number } | null>(null);

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
    const oversized = arr.find((file) => file.size > MAX_BROWSER_UPLOAD_BYTES);
    if (oversized) {
      setError(`${oversized.name} is larger than 50 MB, the maximum supported file size.`);
      return;
    }
    setBusy(true);
    setError(null);
    setResults([]);
    setProgress(null);
    try {
      const uploaded: Result[] = [];
      for (const file of arr) {
        const result = file.size <= MAX_DIRECT_UPLOAD_BYTES
          ? await uploadDirect(file)
          : [await uploadInChunks(file)];
        uploaded.push(...result);
        setResults([...uploaded]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function uploadDirect(file: File): Promise<Result[]> {
    const fd = new FormData();
    fd.append("file", file);
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
    return "files" in json ? json.files : [json];
  }

  async function uploadInChunks(file: File): Promise<Result> {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const init = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "init", name: file.name, mime: file.type || "application/octet-stream", size: file.size, sha256, ttl }),
    });
    const initText = await init.text();
    const initJson = JSON.parse(initText) as { uploadId?: string; chunkSize?: number; error?: string };
    if (!init.ok || !initJson.uploadId || !initJson.chunkSize) throw new Error(initJson.error ?? `upload init failed (HTTP ${init.status})`);

    const totalParts = Math.ceil(file.size / initJson.chunkSize);
    for (let partIndex = 0; partIndex < totalParts; partIndex++) {
      const start = partIndex * initJson.chunkSize;
      const chunk = file.slice(start, Math.min(file.size, start + initJson.chunkSize));
      // Retry each part: mobile/flaky links drop single requests, and the
      // server accepts re-sent parts idempotently, so resume don't restart.
      let sent = false;
      let lastError: string | null = null;
      for (let attempt = 1; attempt <= 3 && !sent; attempt++) {
        try {
          // Raw binary transport: the chunk IS the body, metadata rides in
          // the query string. No multipart parser involved, so there is no
          // form parsing to fail on multi-MB bodies.
          const res = await fetch(
            `/api/upload?uploadId=${encodeURIComponent(initJson.uploadId)}&partIndex=${partIndex}`,
            { method: "POST", body: chunk, headers: { "Content-Type": "application/octet-stream" } }
          );
          const json = await res.json().catch(() => ({})) as { error?: string };
          if (!res.ok) throw new Error(json.error ?? `upload part failed (HTTP ${res.status})`);
          sent = true;
        } catch (e) {
          lastError = e instanceof Error ? e.message : "upload part failed";
          if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
      if (!sent) throw new Error(`${file.name} part ${partIndex + 1}/${totalParts}: ${lastError}`);
      setProgress({ name: file.name, done: partIndex + 1, total: totalParts });
    }

    // Complete can fail transiently (hash verification re-downloads every
    // part through Telegram). Retry before giving up — the operation is
    // idempotent server-side, so a retry never duplicates the file.
    let result: Result & { error?: string } | null = null;
    let lastCompleteError: string | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const complete = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete", uploadId: initJson.uploadId }),
      });
      const json = (await complete.json().catch(() => ({}))) as Result & { error?: string };
      if (complete.ok) { result = json; break; }
      // 4xx (other than 502/503) are deterministic — retrying won't help.
      if (complete.status !== 502 && complete.status !== 503) {
        lastCompleteError = json.error ?? `upload completion failed (HTTP ${complete.status})`;
        break;
      }
      lastCompleteError = json.error ?? `upload completion failed (HTTP ${complete.status})`;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
    if (!result) throw new Error(lastCompleteError ?? "upload completion failed");
    return result;
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
          className={`dropzone${dragOver ? " dragover" : ""}`}
        >
          <input type="file" multiple hidden onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); }} />
          <IconUpload size={30} />
          {busy ? "uploading\u2026" : "drop files or click to choose (multi-file ok)"}
          <span className="faint" style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <IconClock size={13} />
            Expiry:
            <select value={ttl} onChange={(e) => setTtl(e.target.value)} className="select" style={{ padding: "5px 30px 5px 10px", fontSize: 13, marginLeft: 4 }}>
              {TTL_OPTIONS.map(([v, label]) => (
                <option key={v || "never"} value={v}>{label}</option>
              ))}
            </select>
          </span>
        </label>

        {error && <p className="error-text">{error}</p>}

        {busy && progress && (
          <div className="card" role="status" aria-live="polite">
            <div style={{ fontSize: 13, wordBreak: "break-all" }}>
              uploading {progress.name} — part {progress.done}/{progress.total}
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
            </div>
          </div>
        )}

        {results.length > 0 && (
          <div style={{ marginTop: 16 }}>
            {results.map((r) => (
              <div key={r.id} className="card">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <IconFile size={15} />
                  <span style={{ fontWeight: 550, wordBreak: "break-all" }}>{r.name}</span>
                  {r.dedup && <span className="badge">dedup</span>}
                </div>
                <code className="code-block" style={{ marginTop: 8 }}>{r.url}</code>
                <div className="card-actions">
                  <a className="btn btn-sm" href={`/i/${r.id}`} style={{ textDecoration: "none" }}>
                    <IconEye size={14} /> preview
                  </a>
                  <a className="btn btn-sm" href={`${r.url}?dl=1`} style={{ textDecoration: "none" }}>
                    <IconDownload size={14} /> download
                  </a>
                  <button
                    type="button"
                    className="btn btn-sm"
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