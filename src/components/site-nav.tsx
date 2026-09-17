"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { IconBox, IconPaste, IconFile, IconUser, IconLogout, IconLogin, IconPlus } from "@/components/icons";

type Auth = { logged_in: boolean; email?: string };

/**
 * Shared top navigation. Fetches auth state once; used by every page so the
 * header is consistent (and the email is never shown).
 */
export function SiteNav({ showNewPaste = false }: { showNewPaste?: boolean }) {
  const [auth, setAuth] = useState<Auth | null>(null);

  useEffect(() => {
    fetch("/api/auth/whoami")
      .then((r) => r.json())
      .then(setAuth)
      .catch(() => setAuth({ logged_in: false }));
  }, []);

  return (
    <nav className="nav" aria-label="Main">
      <Link href="/" className="nav-brand" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <IconBox size={18} />
        telebox
      </Link>
      <div className="nav-links">
        {showNewPaste && (
          <Link href="/paste/new" className="nav-link" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <IconPlus size={14} />
            paste
          </Link>
        )}
        <Link href="/pastebin" className="nav-link" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <IconPaste size={14} />
          pastebin
        </Link>
        {auth?.logged_in ? (
          <>
            <Link href="/my" className="nav-link" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <IconFile size={14} />
              files
            </Link>
            <Link href="/profile" className="nav-link" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <IconUser size={14} />
              profile
            </Link>
            <button
              type="button"
              onClick={() => fetch("/api/auth/logout", { method: "POST" }).then(() => setAuth({ logged_in: false }))}
              className="nav-btn"
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <IconLogout size={14} />
              logout
            </button>
          </>
        ) : (
          <Link href="/" className="nav-link" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <IconLogin size={14} />
            login
          </Link>
        )}
      </div>
    </nav>
  );
}