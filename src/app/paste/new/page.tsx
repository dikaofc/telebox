"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LANGUAGES } from "@/lib/paste";

export default function NewPastePage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("text");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pastes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, language, content }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "create failed");
      router.push(`/paste/${d.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "create failed");
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "6vh auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>New Paste</h1>
        <a href="/pastebin" style={{ fontSize: 13, color: "#666" }}>back to pastebin</a>
      </div>

      <form onSubmit={submit}>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="title"
            required
            style={{ flex: 1, padding: 10, borderRadius: 6, border: "1px solid #ccc", fontSize: 14 }}
          />
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            style={{ padding: 10, borderRadius: 6, border: "1px solid #ccc", fontSize: 14 }}
          >
            {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="paste your code or text..."
          required
          rows={16}
          style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #ccc", fontSize: 13, fontFamily: "monospace", boxSizing: "border-box" }}
        />
        {error && <p style={{ color: "#c00", marginTop: 8 }}>{error}</p>}
        <button
          type="submit"
          disabled={busy}
          style={{ marginTop: 12, padding: "10px 24px", background: "#111", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14 }}
        >
          {busy ? "Creating..." : "Create Paste"}
        </button>
      </form>
    </main>
  );
}