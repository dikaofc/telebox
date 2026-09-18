"use client";

import { useState } from "react";
import { IconCopy, IconCheck } from "@/components/icons";

export function CopyUrlButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="btn"
      onClick={async () => {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />} {copied ? "Copied" : "Copy URL"}
    </button>
  );
}
