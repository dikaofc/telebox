"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SiteNav } from "@/components/site-nav";
import { IconPlus } from "@/components/icons";
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
    <>
      <SiteNav />
      <main className="container">
        <div className="page-header">
          <h1 className="page-title">New Paste</h1>
        </div>

        <form onSubmit={submit}>
          <div className="form-row">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="title"
              required
              aria-label="Paste title"
              className="input"
            />
            <select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language" className="select">
              {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="paste your code or text..."
            required
            rows={16}
            aria-label="Paste content"
            className="textarea"
          />
          {error && <p className="error-text">{error}</p>}
          <button type="submit" disabled={busy} className="btn btn-primary" style={{ marginTop: 12 }}>
            <IconPlus size={15} /> {busy ? "Creating..." : "Create Paste"}
          </button>
        </form>
      </main>
    </>
  );
}