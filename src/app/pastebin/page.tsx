"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { IconHeart, IconStar, IconComment, IconPlus, IconEye } from "@/components/icons";
import { CodeBlock } from "@/components/code-block";

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
    <>
      <SiteNav />
      <main className="container">
        <div className="page-header">
          <div>
            <h1 className="page-title">Pastebin</h1>
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 14 }}>public pastes — copy, comment, like, star</p>
          </div>
          <Link href="/paste/new" className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <IconPlus size={15} /> New Paste
          </Link>
        </div>

        {error && <p className="error-text">{error}</p>}
        {pastes.length === 0 && !error && <p className="empty-state">No pastes yet.</p>}

        {pastes.map((p) => (
          <div key={p.id} className="card">
            <Link href={`/paste/${p.id}`} className="card-title" style={{ textDecoration: "none" }}>
              {p.title}
            </Link>
            <div className="card-meta">
              {p.author} &middot; {timeAgo(p.created_at)} &middot; <span className="badge">{p.language}</span>
            </div>
            {p.snippet && <CodeBlock code={p.snippet} language={p.language} className="code-feed" />}
            <div className="card-actions">
              <button
                type="button"
                onClick={() => toggle("like", p.id)}
                className="link-btn"
                style={{ color: p.liked ? "var(--like)" : undefined, display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}
              >
                <IconHeart size={14} filled={p.liked} /> {p.like_count}
              </button>
              <button
                type="button"
                onClick={() => toggle("star", p.id)}
                className="link-btn"
                style={{ color: p.starred ? "var(--star)" : undefined, display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}
              >
                <IconStar size={14} filled={p.starred} /> {p.star_count}
              </button>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <IconComment size={14} /> {p.comment_count}
              </span>
              <Link href={`/paste/${p.id}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
                <IconEye size={14} /> view
              </Link>
            </div>
          </div>
        ))}
      </main>
    </>
  );
}