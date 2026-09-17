"use client";

import { useState } from "react";
import { IconComment } from "@/components/icons";

type Comment = { id: string; author: string; body: string; created_at: string };

export function CommentSection({ pasteId, initial }: { pasteId: string; initial: Comment[] }) {
  const [comments, setComments] = useState<Comment[]>(initial);
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch(`/api/pastes/${pasteId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: comment }),
    });
    if (!res.ok) { const d = await res.json().catch(() => null); setMsg(d?.error ?? "comment failed"); return; }
    const d = await res.json();
    setComments((c) => [...c, { id: d.id, author: d.author, body: d.body, created_at: new Date().toISOString() }]);
    setComment("");
  }

  return (
    <>
      <h2 className="section-title" style={{ marginTop: 28, display: "flex", alignItems: "center", gap: 6 }}>
        <IconComment size={15} /> Comments ({comments.length})
      </h2>
      <form onSubmit={addComment} className="form-row" style={{ marginBottom: 12 }}>
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="add a comment..."
          aria-label="Comment"
          className="input"
        />
        <button type="submit" className="btn btn-primary">Comment</button>
      </form>
      {msg && <p className="error-text" style={{ fontSize: 13 }}>{msg}</p>}

      {comments.length === 0 && <p className="empty-state">No comments yet.</p>}
      {comments.map((c) => (
        <div key={c.id} className="item-row">
          <div className="item-main">
            <div style={{ fontSize: 13, fontWeight: 500 }}>
              {c.author} <span className="faint" style={{ fontWeight: 400 }}>&middot; {new Date(c.created_at).toLocaleString()}</span>
            </div>
            <div style={{ fontSize: 14, marginTop: 2, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{c.body}</div>
          </div>
        </div>
      ))}
    </>
  );
}