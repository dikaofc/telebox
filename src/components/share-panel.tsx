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
    const res = await fetch(`/api/files/${fileId}/shares`);
    const d = await res.json();
    setShares(d.shares ?? []);
    setOpen(true);
  }

  async function createShare(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch(`/api/files/${fileId}/shares`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: ttl ? Number(ttl) : null }),
    });
    if (!res.ok) { setMsg("create failed"); return; }
    const d = await res.json();
    setShares((prev) => [...(prev ?? []), d]);
  }

  async function revoke(shareId: string) {
    setMsg(null);
    await fetch(`/api/files/${fileId}/shares`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: shareId }),
    });
    setShares((prev) => (prev ?? []).filter((s) => s.id !== shareId));
  }

  async function copy(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button onClick={toggle} style={{ background: "none", border: "1px solid #ccc", borderRadius: 4, padding: "3px 10px", cursor: "pointer", fontSize: 12, color: "#333" }}>
        {open ? "hide shares" : "share"}
      </button>

      {open && shares !== null && (
        <div style={{ marginTop: 8, padding: 10, background: "#f7f7f7", borderRadius: 6 }}>
          <form onSubmit={createShare} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
            <select value={ttl} onChange={(e) => setTtl(e.target.value)} style={{ padding: "4px 6px", borderRadius: 4, border: "1px solid #ccc", fontSize: 12 }}>
              <option value="3600">1 hour</option>
              <option value="86400">1 day</option>
              <option value="604800">7 days</option>
              <option value="2592000">30 days</option>
              <option value="">never</option>
            </select>
            <button type="submit" style={{ background: "#111", color: "#fff", border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>
              create link
            </button>
          </form>

          {msg && <p style={{ color: "#c00", fontSize: 12, margin: "0 0 8px" }}>{msg}</p>}

          {shares.length === 0 && <p style={{ color: "#999", fontSize: 12, margin: 0 }}>No share links for {fileName} yet.</p>}
          {shares.map((s) => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <code style={{ fontSize: 11, wordBreak: "break-all", color: "#333", flex: 1 }}>
                {s.url}
                {s.expires_at && <span style={{ color: "#999", display: "block" }}>expires {new Date(s.expires_at).toLocaleString()}</span>}
              </code>
              <button onClick={() => copy(s.url)} style={{ background: "none", border: "1px solid #ccc", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: 11, flexShrink: 0 }}>
                {copied === s.url ? "copied" : "copy"}
              </button>
              <button onClick={() => revoke(s.id)} style={{ background: "none", border: "1px solid #c00", color: "#c00", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: 11, flexShrink: 0 }}>
                revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}