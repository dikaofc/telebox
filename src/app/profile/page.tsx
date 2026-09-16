"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type Profile = { id: number; email: string; name: string; avatar_url: string | null };

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [auth, setAuth] = useState<"loading" | "anon" | "ok">("loading");

  const [name, setName] = useState("");
  const [nameMsg, setNameMsg] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarMsg, setAvatarMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("unauthorized"))))
      .then((d: Profile) => {
        setProfile(d); setName(d.name); setAvatarUrl(d.avatar_url); setAuth("ok");
      })
      .catch(() => setAuth("anon"));
  }, []);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/profile", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const d = await res.json();
    setNameMsg(res.ok ? `saved as "${d.name}"` : (d.error ?? "failed"));
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    const res = await fetch("/api/profile/password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
    const d = await res.json();
    setPwMsg(res.ok ? "password updated" : (d.error ?? "failed"));
    if (res.ok) { setCurrentPassword(""); setNewPassword(""); }
  }

  async function uploadAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarMsg(null);
    const fd = new FormData();
    fd.append("avatar", file);
    const res = await fetch("/api/profile/avatar", { method: "POST", body: fd });
    const d = await res.json();
    if (res.ok) { setAvatarUrl(d.avatar_url); setAvatarMsg("avatar updated"); }
    else setAvatarMsg(d.error ?? "avatar upload failed");
  }

  if (auth === "loading") return <main style={{ maxWidth: 560, margin: "10vh auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>Loading...</main>;
  if (auth === "anon") return <main style={{ maxWidth: 560, margin: "10vh auto", padding: 24, fontFamily: "system-ui, sans-serif" }}><p style={{ color: "#c00" }}>Login to edit your profile.</p> <Link href="/" style={{ color: "#666" }}>back</Link></main>;

  return (
    <main style={{ maxWidth: 560, margin: "8vh auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>Profile</h1>
        <Link href="/" style={{ fontSize: 13, color: "#666" }}>back</Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
        {avatarUrl
          ? (
            // eslint-disable-next-line @next/next/no-img-element -- dynamic avatar route, no optimization
            <img src={avatarUrl} alt="avatar" style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", border: "1px solid #ddd" }} />
          )
          : <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#e5e5e5", display: "flex", alignItems: "center", justifyContent: "center", color: "#888", fontSize: 28 }}>{profile?.email[0].toUpperCase()}</div>}
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{profile?.name || profile?.email}</div>
          <div style={{ fontSize: 13, color: "#888" }}>{profile?.email}</div>
        </div>
      </div>

      <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>Display name</h2>
      <form onSubmit={saveName} style={{ display: "flex", gap: 8, marginBottom: 28 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="your name" maxLength={60} style={{ flex: 1, padding: 10, borderRadius: 6, border: "1px solid #ccc", fontSize: 14 }} />
        <button type="submit" style={{ padding: "8px 16px", background: "#111", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14 }}>Save</button>
      </form>
      {nameMsg && <p style={{ color: "#666", fontSize: 13, marginTop: -16, marginBottom: 20 }}>{nameMsg}</p>}

      <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>Profile photo</h2>
      <div style={{ marginBottom: 28 }}>
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadAvatar} style={{ fontSize: 13 }} />
        {avatarMsg && <p style={{ color: "#666", fontSize: 13, marginTop: 8 }}>{avatarMsg}</p>}
      </div>

      <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>Change password</h2>
      <form onSubmit={savePassword} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="current password" required style={{ padding: 10, borderRadius: 6, border: "1px solid #ccc", fontSize: 14 }} />
        <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="new password (min 8 chars)" required minLength={8} style={{ padding: 10, borderRadius: 6, border: "1px solid #ccc", fontSize: 14 }} />
        <button type="submit" style={{ alignSelf: "flex-start", padding: "8px 16px", background: "#111", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14 }}>Update</button>
      </form>
      {pwMsg && <p style={{ color: "#666", fontSize: 13, marginTop: 8 }}>{pwMsg}</p>}
    </main>
  );
}