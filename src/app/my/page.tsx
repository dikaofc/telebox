"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { SharePanel } from "@/components/share-panel";

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
    <main style={{ maxWidth: 640, margin: "6vh auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>My Account</h1>
        <Link href="/" style={{ fontSize: 13, color: "#666" }}>back to upload</Link>
      </div>

      <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
        <button onClick={() => setTab("files")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: tab === "files" ? 700 : 400, textDecoration: tab === "files" ? "underline" : "none" }}>
          My Files
        </button>
        <button onClick={() => setTab("keys")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: tab === "keys" ? 700 : 400, textDecoration: tab === "keys" ? "underline" : "none" }}>
          API Keys
        </button>
      </div>

      {error && <p style={{ color: "#c00" }}>{error}</p>}

      {tab === "files" && (
        <div>
          {files.length === 0 && <p style={{ color: "#999" }}>No files yet.</p>}
          {files.map((f) => (
            <div key={f.id} style={{ padding: "10px 0", borderBottom: "1px solid #eee" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <a href={`/i/${f.id}`} style={{ fontSize: 14, wordBreak: "break-all", textDecoration: "none", color: "#111" }}>
                    {f.name}
                  </a>
                  <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                    {formatSize(f.size)} &middot; {new Date(f.created_at).toLocaleDateString()}
                    {f.expires_at && (
                      <span style={{ color: new Date(f.expires_at) < new Date() ? "#c00" : "#b8860b" }}>
                        {" "}&middot; expires {new Date(f.expires_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0, marginLeft: 12 }}>
                  <button onClick={() => deleteFile(f.id)} style={{ background: "none", border: "none", color: "#c00", cursor: "pointer", fontSize: 13 }}>
                    delete
                  </button>
                </div>
              </div>
              <SharePanel fileId={f.id} fileName={f.name} />
            </div>
          ))}
        </div>
      )}

      {tab === "keys" && (
        <div>
          <form onSubmit={createKey} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input
              placeholder="key name (optional)"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              style={{ flex: 1, padding: 8, borderRadius: 4, border: "1px solid #ccc", fontSize: 14 }}
            />
            <button type="submit" style={{ padding: "8px 16px", background: "#111", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14 }}>
              Create
            </button>
          </form>

          {newKeyValue && (
            <div style={{ padding: 12, background: "#e8ffe8", borderRadius: 8, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Your new API key (copy it now, it won&apos;t be shown again):</div>
              <code style={{ display: "block", padding: 8, background: "#fff", borderRadius: 4, wordBreak: "break-all", fontSize: 13 }}>
                {newKeyValue}
              </code>
              <button onClick={() => { navigator.clipboard.writeText(newKeyValue); }} style={{ marginTop: 8, background: "none", border: "1px solid #ccc", borderRadius: 4, padding: "4px 8px", cursor: "pointer", fontSize: 12 }}>
                copy
              </button>
            </div>
          )}

          {keys.length === 0 && <p style={{ color: "#999" }}>No API keys.</p>}
          {keys.map((k) => (
            <div key={k.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #eee" }}>
              <div>
                <div style={{ fontSize: 14 }}>{k.name || "(unnamed)"}</div>
                <div style={{ fontSize: 12, color: "#666" }}>
                  created {new Date(k.created_at).toLocaleDateString()}
                  {k.last_used_at && ` \u00b7 last used ${new Date(k.last_used_at).toLocaleDateString()}`}
                </div>
              </div>
              <button onClick={() => deleteKey(k.id)} style={{ background: "none", border: "none", color: "#c00", cursor: "pointer", fontSize: 13 }}>
                revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}