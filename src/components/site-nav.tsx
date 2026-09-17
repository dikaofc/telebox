"use client";

import { useState, useEffect } from "react";
import { IconBox } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";

type Auth = { logged_in: boolean; email?: string };

/**
 * Shared top navigation. Fetches auth state once; used by every page so the
 * header is consistent (and the email is never shown).
 */
export function SiteNav() {
  const [auth, setAuth] = useState<Auth | null>(null);

  useEffect(() => {
    fetch("/api/auth/whoami")
      .then((r) => r.json())
      .then(setAuth)
      .catch(() => setAuth({ logged_in: false }));
  }, []);

  return (
    <nav className="nav" aria-label="Main">
      <a href="/" className="nav-brand" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <IconBox size={18} />
        telebox
      </a>
      <div className="nav-links" style={{ display: "flex", gap: 6 }}>
        <button type="button" className="btn btn-sm" onClick={() => (window.location.href = "/")}>
          home
        </button>
        <button type="button" className="btn btn-sm" onClick={() => (window.location.href = "/pastebin")}>
          pastebin
        </button>
        <button type="button" className="btn btn-sm" onClick={() => (window.location.href = "/paste/new")}>
          new paste
        </button>
        <ThemeToggle />
        {auth?.logged_in ? (
          <>
            <button type="button" className="btn btn-sm" onClick={() => (window.location.href = "/my")}>
              files
            </button>
            <button type="button" className="btn btn-sm" onClick={() => (window.location.href = "/profile")}>
              profile
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => fetch("/api/auth/logout", { method: "POST" }).then(() => setAuth({ logged_in: false }))}
            >
              logout
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => (window.location.href = "/")}>
            login
          </button>
        )}
      </div>
    </nav>
  );
}