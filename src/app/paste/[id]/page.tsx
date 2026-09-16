"use client";

import { useState, useEffect } from "react";

type Comment = { id: string; author: string; body: string; created_at: string };
type PasteDetail = {
  id: string; title: string; content: string; language: string; author: string;
  created_at: string; like_count: number; star_count: number; comment_count: number;
  liked: boolean; starred: boolean; comments: Comment[];
};

export default function PastePage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null);
  const [paste, setPaste] = useState<PasteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => { params.then((p) => setId(p.id)); }, [params]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/pastes/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
      .then(setPaste)
      .catch(() => setError("paste not found"));
  }, [id]);

  if (error) return <main style={{ maxWidth: 720, margin: "6vh auto", padding: 24, fontFamily: "system-ui, sans-serif", color: "#c00" }}>{error} &middot; <a href="/pastebin" style={{ color: "#666" }}>back to pastebin</a></main>;
  if (!paste) return <main style={{ maxWidth: 720, margin: "6vh auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>Loading...</main>;

  async function toggle(kind: "like" | "star") {
    const res = await fetch(`/api/pastes/${id}/${kind}`, { method: "POST" });
    if (!res.ok) return;
    const d = await res.json();
    setPaste((p) => p && { ...p, liked: kind === "like" ? d.liked : p.liked, starred: kind === "star" ? d.starred : p.starred, like_count: kind === "like" ? d.like_count : p.like_count, star_count: kind === "star" ? d.star_count : p.star_count });
  }

  async function copy() {
    if (!paste) return;
    await navigator.clipboard.writeText(paste.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/pastes/${id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: comment }),
    });
    if (!res.ok) return;
    const d = await res.json();
    setPaste((p) => p && { ...p, comments: [...p.comments, { id: d.id, author: d.author, body: d.body, created_at: new Date().toISOString() }], comment_count: p.comment_count + 1 });
    setComment("");
  }

  return (
    <main style={{ maxWidth: 720, margin: "6vh auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <h1 style={{ fontSize: 22, margin: 0, wordBreak: "break-all" }}>{paste.title}</h1>
        <a href="/pastebin" style={{ fontSize: 13, color: "#666" }}>back</a>
      </div>
      <div style={{ fontSize: 13, color: "#888", marginBottom: 14 }}>
        {paste.author} &middot; {new Date(paste.created_at).toLocaleString()} &middot; {paste.language}
      </div>

      <pre style={{ fontSize: 13, background: "#f7f7f7", padding: 16, borderRadius: 8, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", border: "1px solid #eee" }}>
        {paste.content}
      </pre>

      <div style={{ display: "flex", gap: 12, margin: "12px 0", fontSize: 14 }}>
        <button onClick={() => toggle("like")} style={{ background: "none", border: paste.liked ? "1px solid #e0245e" : "1px solid #ccc", borderRadius: 6, padding: "6px 14px", cursor: "pointer", color: paste.liked ? "#e0245e" : "#333" }}>
          {paste.liked ? "Liked" : "Like"} ({paste.like_count})
        </button>
        <button onClick={() => toggle("star")} style={{ background: "none", border: paste.starred ? "1px solid #e8a33d" : "1px solid #ccc", borderRadius: 6, padding: "6px 14px", cursor: "pointer", color: paste.starred ? "#b87c1a" : "#333" }}>
          {paste.starred ? "Starred" : "Star"} ({paste.star_count})
        </button>
        <button onClick={copy} style={{ background: "none", border: "1px solid #ccc", borderRadius: 6, padding: "6px 14px", cursor: "pointer", color: "#333" }}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <h2 style={{ fontSize: 16, margin: "24px 0 8px" }}>Comments ({paste.comment_count})</h2>
      <form onSubmit={addComment} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="add a comment..."
          style={{ flex: 1, padding: 10, borderRadius: 6, border: "1px solid #ccc", fontSize: 14 }}
        />
        <button type="submit" style={{ padding: "8px 16px", background: "#111", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14 }}>
          Comment
        </button>
      </form>

      {paste.comments.length === 0 && <p style={{ color: "#999", fontSize: 14 }}>No comments yet.</p>}
      {paste.comments.map((c) => (
        <div key={c.id} style={{ padding: "10px 0", borderBottom: "1px solid #eee" }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{c.author} <span style={{ fontWeight: 400, color: "#999" }}>&middot; {new Date(c.created_at).toLocaleString()}</span></div>
          <div style={{ fontSize: 14, marginTop: 2, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{c.body}</div>
        </div>
      ))}
    </main>
  );
}