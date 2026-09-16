"use client";

import { useState, useEffect } from "react";

export function TextPreview({ id, mime }: { id: string; mime: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/raw/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("fetch failed");
        return r.text();
      })
      .then(setContent)
      .catch(() => setError(true));
  }, [id]);

  if (error) {
    return (
      <pre style={{ marginTop: 24, padding: 16, background: "#f5f5f5", borderRadius: 8, fontSize: 14 }}>
        <code>Preview not available — use Download</code>
      </pre>
    );
  }

  if (content === null) {
    return (
      <pre style={{ marginTop: 24, padding: 16, background: "#f5f5f5", borderRadius: 8, fontSize: 14 }}>
        <code>Loading...</code>
      </pre>
    );
  }

  if (mime === "image/svg+xml") {
    return (
      <div style={{ marginTop: 24, padding: 16, background: "#f5f5f5", borderRadius: 8 }}>
        <p style={{ margin: "0 0 8px", fontSize: 13, color: "#666" }}>SVG source (rendering blocked for safety):</p>
        <pre style={{ margin: 0, fontSize: 13, overflow: "auto", maxHeight: "50vh", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          <code>{content}</code>
        </pre>
      </div>
    );
  }

  return (
    <pre style={{ marginTop: 24, padding: 16, background: "#f5f5f5", borderRadius: 8, overflow: "auto", fontSize: 14, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "70vh" }}>
      <code>{content}</code>
    </pre>
  );
}
