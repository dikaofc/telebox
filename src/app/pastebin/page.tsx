"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type Paste = {
  id: string; title: string; snippet: string; language: string; author: string;
  created_at: string; like_count: number; star_count: number; comment_count: number;
  liked: boolean; starred: boolean;
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function PastebinPage() {
  const [pastes, setPastes] = useState<Paste[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch("/api/pastes")
      .then((r) => (r.ok ? r.json() : { pastes: [] }))
      .then((d) => setPastes(d.pastes ?? []))
      .catch(() => setError("failed to load"));
  }

  useEffect(load, []);

  async function toggle(kind: "like" | "star", id: string) {
    const res = await fetch(`/api/pastes/${id}/${kind}`, { method: "POST" });
    if (!res.ok) { setError("action failed"); return; }
    const d = await res.json();
    setPastes((prev) => prev.map((p) =>
      p.id === id
        ? { ...p, liked: kind === "like" ? d.liked : p.liked, starred: kind === "star" ? d.starred : p.starred, like_count: kind === "like" ? d.like_count : p.like_count, star_count: kind === "star" ? d.star_count : p.star_count }
        : p
    ));
  }

  return (
    <main style={{ maxWidth: 720, margin: "6vh auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>Pastebin</h1>
        <Link href="/paste/new" style={{ padding: "8px 16px", background: "#111", color: "#fff", textDecoration: "none", borderRadius: 6, fontSize: 14 }}>
          New Paste
        </Link>
      </div>

      {error && <p style={{ color: "#c00" }}>{error}</p>}
      {pastes.length === 0 && !error && <p style={{ color: "#999" }}>No pastes yet.</p>}

      {pastes.map((p) => (
        <div key={p.id} style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 14, marginBottom: 12 }}>
          <a href={`/paste/${p.id}`} style={{ fontWeight: 600, fontSize: 15, color: "#111", textDecoration: "none" }}>
            {p.title}
          </a>
          <div style={{ fontSize: 12, color: "#888", margin: "4px 0" }}>
            {p.author} &middot; {timeAgo(p.created_at)} &middot; {p.language}
          </div>
          {p.snippet && (
            <pre style={{ fontSize: 12, background: "#f7f7f7", padding: 10, borderRadius: 6, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: "8px 0" }}>
              {p.snippet}
            </pre>
          )}
          <div style={{ display: "flex", gap: 12, fontSize: 13, color: "#666" }}>
            <button onClick={() => toggle("like", p.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: p.liked ? "#e0245e" : "#666" }}>
              like {p.like_count}
            </button>
            <button onClick={() => toggle("star", p.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: p.starred ? "#e8a33d" : "#666" }}>
              star {p.star_count}
            </button>
            <span>comments {p.comment_count}</span>
            <a href={`/paste/${p.id}`} style={{ color: "#666" }}>view</a>
          </div>
        </div>
      ))}
    </main>
  );
}