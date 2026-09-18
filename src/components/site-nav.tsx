"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconBox } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";

type Auth = { logged_in: boolean; email?: string };

/**
 * Shared top navigation. Fetches auth state once; used by every page so the
 * header is consistent (and the email is never shown).
 */
export function SiteNav() {
  const [auth, setAuth] = useState<Auth | null>(null);
  const router = useRouter();

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
      <div className="nav-links" style={{ display: "flex", gap: 6 }}>
        <button type="button" className="btn btn-sm" onClick={() => router.push("/")}>
          home
        </button>
        <button type="button" className="btn btn-sm" onClick={() => router.push("/pastebin")}>
          pastebin
        </button>
        <button type="button" className="btn btn-sm" onClick={() => router.push("/paste/new")}>
          new paste
        </button>
        <ThemeToggle />
        {auth?.logged_in ? (
          <>
            <button type="button" className="btn btn-sm" onClick={() => router.push("/my")}>
              files
            </button>
            <button type="button" className="btn btn-sm" onClick={() => router.push("/profile")}>
              profile
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() =>
                fetch("/api/auth/logout", { method: "POST" }).then(() => {
                  setAuth({ logged_in: false });
                  router.push("/");
                  router.refresh();
                })
              }
            >
              logout
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => router.push("/")}>
            login
          </button>
        )}
      </div>
    </nav>
  );
}