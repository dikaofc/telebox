"use client";

import { useState, useEffect } from "react";
import { SiteNav } from "@/components/site-nav";
import { SharePanel } from "@/components/share-panel";
import { IconKey, IconFile, IconTrash, IconCopy, IconClock } from "@/components/icons";

type FileItem = { id: string; name: string; mime: string; size: number; created_at: string; expires_at: string | null; url: string; direct_url: string };
type KeyItem = { id: number; name: string; created_at: string; last_used_at: string | null };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function MyPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [keys, setKeys] = useState<KeyItem[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [tab, setTab] = useState<"files" | "keys">("files");
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  function loadFiles() {
    fetch("/api/files").then((r) => r.json()).then((d) => setFiles(d.files ?? [])).catch(() => {});
  }
  function loadKeys() {
    fetch("/api/keys").then((r) => r.json()).then((d) => setKeys(d.keys ?? [])).catch(() => {});
  }

  useEffect(() => { loadFiles(); loadKeys(); }, []);

  async function deleteFile(id: string) {
    if (!confirm("Delete this file?")) return;
    const res = await fetch(`/api/files/${id}`, { method: "DELETE" });
    if (res.ok) loadFiles();
    else setError("delete failed");
  }

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newKeyName }),
    });
    if (!res.ok) { setError("create failed"); return; }
    const data = await res.json();
    setNewKeyValue(data.key);
    setNewKeyName("");
    loadKeys();
  }

  async function copyKey() {
    if (newKeyValue) await navigator.clipboard.writeText(newKeyValue);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 1500);
  }

  async function deleteKey(id: number) {
    if (!confirm("Revoke this API key?")) return;
    await fetch("/api/keys", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    loadKeys();
  }

  return (
    <>
      <SiteNav />
      <main className="container">
        <div className="page-header">
          <h1 className="page-title">My Account</h1>
        </div>

        <div className="tabs" role="tablist" aria-label="Account sections">
          <button
            role="tab"
            aria-selected={tab === "files"}
            onClick={() => setTab("files")}
            className={`tab ${tab === "files" ? "tab-active" : ""}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <IconFile size={14} /> My Files
          </button>
          <button
            role="tab"
            aria-selected={tab === "keys"}
            onClick={() => setTab("keys")}
            className={`tab ${tab === "keys" ? "tab-active" : ""}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <IconKey size={14} /> API Keys
          </button>
        </div>

        {error && <p className="error-text">{error}</p>}

        {tab === "files" && (
          <div>
            {files.length === 0 && <p className="empty-state">No files yet.</p>}
            {files.map((f) => (
              <div key={f.id} className="item-row" style={{ display: "block" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div className="item-main">
                    <a href={`/i/${f.id}`} className="item-title" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <IconFile size={14} /> {f.name}
                    </a>
                    <div className="item-sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <IconClock size={12} />
                      {formatSize(f.size)} &middot; {new Date(f.created_at).toLocaleDateString()}
                      {f.expires_at && (
                        <span style={{ color: new Date(f.expires_at) < new Date() ? "var(--danger)" : "var(--star)" }}>
                          &middot; expires {new Date(f.expires_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => deleteFile(f.id)} className="btn btn-sm btn-danger" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <IconTrash size={13} /> delete
                  </button>
                </div>
                <SharePanel fileId={f.id} fileName={f.name} />
              </div>
            ))}
          </div>
        )}

        {tab === "keys" && (
          <div>
            <form onSubmit={createKey} className="form-row">
              <input
                placeholder="key name (optional)"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                aria-label="Key name"
                className="input"
              />
              <button type="submit" className="btn btn-primary">Create</button>
            </form>

            {newKeyValue && (
              <div className="notice" style={{ background: "#ecfdf5" }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Your new API key (copy it now, it won&apos;t be shown again):</div>
                <code style={{ display: "block", padding: 8, background: "#fff", borderRadius: 4, wordBreak: "break-all", fontSize: 13 }}>
                  {newKeyValue}
                </code>
                <button onClick={copyKey} className="btn btn-sm" style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <IconCopy size={13} /> {copiedKey ? "copied" : "copy"}
                </button>
              </div>
            )}

            {keys.length === 0 && <p className="empty-state">No API keys.</p>}
            {keys.map((k) => (
              <div key={k.id} className="item-row">
                <div className="item-main">
                  <div style={{ fontSize: 14 }}>{k.name || "(unnamed)"}</div>
                  <div className="item-sub">
                    created {new Date(k.created_at).toLocaleDateString()}
                    {k.last_used_at && ` \u00b7 last used ${new Date(k.last_used_at).toLocaleDateString()}`}
                  </div>
                </div>
                <button onClick={() => deleteKey(k.id)} className="btn btn-sm btn-danger" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <IconTrash size={13} /> revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}