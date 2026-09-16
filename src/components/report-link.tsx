"use client";

import { useState } from "react";

export function ReportLink({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, reason }),
    });
    if (res.ok) setDone("Report sent. Thanks.");
    else setDone("Report failed — try again.");
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: "none",
          border: "none",
          color: "#999",
          textDecoration: "underline",
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        report
      </button>
      {open && !done && (
        <form onSubmit={submit} style={{ display: "inline-flex", gap: 6 }}>
          <input
            type="text"
            placeholder="reason (abuse, illegal, spam...)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            maxLength={500}
            style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #ccc", fontSize: 13, width: 240 }}
          />
          <button type="submit" style={{ padding: "4px 10px", background: "#111", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 13 }}>
            Send
          </button>
        </form>
      )}
      {done && <span style={{ fontSize: 13, color: "#666" }}>{done}</span>}
    </span>
  );
}