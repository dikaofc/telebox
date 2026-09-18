"use client";

import { useState } from "react";
import { IconComment, IconTrash, IconPencil, IconCheck, IconX } from "@/components/icons";

type Comment = {
  id: string;
  author: string;
  avatar_url: string | null;
  body: string;
  created_at: string;
  user_id?: number;
};

export function CommentSection({ pasteId, initial, currentUserId }: { pasteId: string; initial: Comment[]; currentUserId?: number | null }) {
  const [comments, setComments] = useState<Comment[]>(initial);
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  async function refresh() {
    const r = await fetch(`/api/pastes/${pasteId}/comments`);
    if (r.ok) {
      const d = await r.json();
      setComments(d.comments ?? []);
    }
  }

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/pastes/${pasteId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: comment }),
      });
      if (!res.ok) { const d = await res.json().catch(() => null); setMsg(d?.error ?? "comment failed"); return; }
      setComment("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deleteComment(id: string) {
    if (!confirm("Delete this comment?")) return;
    const res = await fetch(`/api/pastes/${pasteId}/comments`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commentId: id }),
    });
    if (!res.ok) { const d = await res.json().catch(() => null); setMsg(d?.error ?? "delete failed"); return; }
    setComments((c) => c.filter((x) => x.id !== id));
  }

  async function saveEdit(id: string) {
    const res = await fetch(`/api/pastes/${pasteId}/comments`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commentId: id, body: editText }),
    });
    if (!res.ok) { const d = await res.json().catch(() => null); setMsg(d?.error ?? "edit failed"); return; }
    setComments((c) => c.map((x) => x.id === id ? { ...x, body: editText } : x));
    setEditingId(null);
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
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Sending..." : "Comment"}</button>
      </form>
      {msg && <p className="error-text" style={{ fontSize: 13 }}>{msg}</p>}

      {comments.length === 0 && <p className="empty-state">No comments yet.</p>}
      {comments.map((c) => (
        <div key={c.id} className="item-row" style={{ display: "flex", alignItems: "flex-start" }}>
          {c.avatar_url
            // eslint-disable-next-line @next/next/no-img-element -- /avatar/* is a dynamic route, bypass Image optimization
            ? <img src={c.avatar_url} alt="" className="avatar-sm" loading="lazy" />
            : <div className="avatar-sm-placeholder" />}
          <div className="item-main" style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                {c.author || "anonymous"}
                <span className="faint" style={{ fontWeight: 400 }}> &middot; {new Date(c.created_at).toLocaleString()}</span>
              </div>
              {c.user_id === currentUserId && (
                editingId === c.id ? (
                  <div style={{ display: "flex", gap: 4 }}>
                    <button type="button" className="btn btn-sm" onClick={() => saveEdit(c.id)} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                      <IconCheck size={12} /> save
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setEditingId(null)} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                      <IconX size={12} /> cancel
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 4 }}>
                    <button type="button" className="btn btn-sm" onClick={() => { setEditingId(c.id); setEditText(c.body); }} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                      <IconPencil size={12} /> edit
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => deleteComment(c.id)} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                      <IconTrash size={12} /> delete
                    </button>
                  </div>
                )
              )}
            </div>
            {editingId === c.id ? (
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="textarea"
                rows={3}
                style={{ marginTop: 6, fontSize: 14 }}
              />
            ) : (
              <div style={{ fontSize: 14, marginTop: 2, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{c.body}</div>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
