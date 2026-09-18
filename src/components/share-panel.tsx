"use client";

import { useState } from "react";

type ShareLink = { id: string; url: string; created_at: string; expires_at: string | null };

export function SharePanel({ fileId, fileName }: { fileId: string; fileName: string }) {
  const [shares, setShares] = useState<ShareLink[] | null>(null);
  const [open, setOpen] = useState(false);
  const [ttl, setTtl] = useState("604800"); // 7 days default
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function toggle() {
    if (shares !== null) { setOpen(!open); return; }
    try {
      const res = await fetch(`/api/files/${fileId}/shares`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d?.error ?? "failed to load shares"); setOpen(true); return; }
      setShares(d.shares ?? []);
      setOpen(true);
    } catch {
      setMsg("failed to load shares");
      setOpen(true);
    }
  }

  async function createShare(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const res = await fetch(`/api/files/${fileId}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: ttl ? Number(ttl) : null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d?.error ?? "create failed"); return; }
      setShares((prev) => [...(prev ?? []), d]);
    } catch {
      setMsg("create failed");
    }
  }

  async function revoke(shareId: string) {
    setMsg(null);
    try {
      const res = await fetch(`/api/files/${fileId}/shares`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: shareId }),
      });
      if (!res.ok) { setMsg("revoke failed"); return; }
      setShares((prev) => (prev ?? []).filter((s) => s.id !== shareId));
    } catch {
      setMsg("revoke failed");
    }
  }

  async function copy(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button onClick={toggle} className="btn btn-sm" type="button">
        {open ? "hide shares" : "share"}
      </button>

      {open && shares !== null && (
        <div style={{ marginTop: 8, padding: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6 }}>
          <form onSubmit={createShare} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
            <select value={ttl} onChange={(e) => setTtl(e.target.value)} className="select" style={{ padding: "4px 6px", fontSize: 12 }}>
              <option value="3600">1 hour</option>
              <option value="86400">1 day</option>
              <option value="604800">7 days</option>
              <option value="2592000">30 days</option>
              <option value="">never</option>
            </select>
            <button type="submit" className="btn btn-sm btn-primary">
              create link
            </button>
          </form>

          {msg && <p className="error-text" style={{ fontSize: 12, margin: "0 0 8px" }}>{msg}</p>}

          {shares.length === 0 && <p className="faint" style={{ fontSize: 12, margin: 0 }}>No share links for {fileName} yet.</p>}
          {shares.map((s) => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <code style={{ fontSize: 11, wordBreak: "break-all", color: "var(--muted)", flex: 1 }}>
                {s.url}
                {s.expires_at && <span style={{ display: "block" }}>expires {new Date(s.expires_at).toLocaleString()}</span>}
              </code>
              <button onClick={() => copy(s.url)} className="btn btn-sm" type="button">
                {copied === s.url ? "copied" : "copy"}
              </button>
              <button onClick={() => revoke(s.id)} className="btn btn-sm btn-ghost-danger" type="button">
                revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
