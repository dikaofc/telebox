"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { IconUser, IconKey, IconImage, IconCheck } from "@/components/icons";

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

  if (auth === "loading") {
    return (<><SiteNav /><main className="container"><p className="faint">Loading...</p></main></>);
  }
  if (auth === "anon") {
    return (
      <>
        <SiteNav />
        <main className="container" style={{ textAlign: "center" }}>
          <p className="error-text">Login to edit your profile.</p>
          <Link href="/" className="btn btn-sm">back</Link>
        </main>
      </>
    );
  }

  return (
    <>
      <SiteNav />
      <main className="container container-narrow">
        <div className="page-header">
          <h1 className="page-title">Profile</h1>
        </div>

        <div className="avatar-row">
          {avatarUrl
            ? (
              // eslint-disable-next-line @next/next/no-img-element -- dynamic avatar route
              <img src={avatarUrl} alt="avatar" className="avatar" />
            )
            : <div className="avatar-placeholder"><IconUser size={30} /></div>}
          <div>
            <div className="profile-identity-name">{profile?.name || profile?.email}</div>
            <div className="profile-identity-email">{profile?.email}</div>
          </div>
        </div>

        <h2 className="section-title">Display name</h2>
        <form onSubmit={saveName} className="form-row" style={{ marginBottom: 24 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="your name" maxLength={60} className="input" aria-label="Display name" />
          <button type="submit" className="btn btn-primary">Save</button>
        </form>
        {nameMsg && <p className="muted" style={{ fontSize: 13, marginTop: -16, marginBottom: 20 }}>{nameMsg}</p>}

        <h2 className="section-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <IconImage size={15} /> Profile photo
        </h2>
        <div style={{ marginBottom: 28 }}>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadAvatar} className="input" style={{ maxWidth: "100%" }} aria-label="Profile photo" />
          {avatarMsg && <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>{avatarMsg}</p>}
        </div>

        <h2 className="section-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <IconKey size={15} /> Change password
        </h2>
        <form onSubmit={savePassword} className="form-stack" style={{ maxWidth: 360 }}>
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="current password" required className="input" aria-label="Current password" />
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="new password (min 8 chars)" required minLength={8} className="input" aria-label="New password" />
          <button type="submit" className="btn btn-primary" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <IconCheck size={14} /> Update
          </button>
        </form>
        {pwMsg && <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>{pwMsg}</p>}
      </main>
    </>
  );
}