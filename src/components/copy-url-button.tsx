"use client";

export function CopyUrlButton({ url }: { url: string }) {
  return (
    <button
      onClick={() => navigator.clipboard.writeText(url)}
      style={{
        padding: "8px 16px",
        background: "#eee",
        border: "1px solid #ccc",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 14,
      }}
    >
      Copy URL
    </button>
  );
}