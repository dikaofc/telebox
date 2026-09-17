"use client";

import { useState } from "react";
import { IconHeart, IconStar, IconCopy, IconCheck } from "@/components/icons";

type Props = {
  id: string;
  content: string;
  initialLiked: boolean;
  initialStarred: boolean;
  initialLikes: number;
  initialStars: number;
};

/** Interactive like/star/copy cluster for a paste. Client island. */
export function PasteActions({ id, content, initialLiked, initialStarred, initialLikes, initialStars }: Props) {
  const [liked, setLiked] = useState(initialLiked);
  const [starred, setStarred] = useState(initialStarred);
  const [likes, setLikes] = useState(initialLikes);
  const [stars, setStars] = useState(initialStars);
  const [copied, setCopied] = useState(false);

  async function toggle(kind: "like" | "star") {
    const res = await fetch(`/api/pastes/${id}/${kind}`, { method: "POST" });
    if (!res.ok) return;
    const d = await res.json();
    if (kind === "like") { setLiked(d.liked); setLikes(d.like_count); }
    else { setStarred(d.starred); setStars(d.star_count); }
  }

  async function copy() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="card-actions" style={{ margin: "12px 0" }}>
      <button
        type="button"
        onClick={() => toggle("like")}
        className={`btn btn-sm ${liked ? "btn-active-like" : ""}`}
        style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
      >
        <IconHeart size={14} filled={liked} /> {likes}
      </button>
      <button
        type="button"
        onClick={() => toggle("star")}
        className={`btn btn-sm ${starred ? "btn-active-star" : ""}`}
        style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
      >
        <IconStar size={14} filled={starred} /> {stars}
      </button>
      <button type="button" onClick={copy} className="btn btn-sm" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />} {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}