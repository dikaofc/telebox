"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconBox } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";

type Auth = { logged_in: boolean; email?: string };

/**
 * Shared top navigation: sticky glass bar (blur + translucency), horizontal
 * scroll on narrow screens, consistent hover/active states. Auth state is
 * fetched once; the email is never shown.
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
      <div className="nav-inner">
        <Link href="/" className="nav-brand">
          <IconBox size={18} />
          telebox
        </Link>
        <div className="nav-links">
          <Link href="/" className="nav-btn" style={{ textDecoration: "none" }}>
            home
          </Link>
          <Link href="/pastebin" className="nav-btn" style={{ textDecoration: "none" }}>
            pastebin
          </Link>
          <Link href="/paste/new" className="nav-btn" style={{ textDecoration: "none" }}>
            new paste
          </Link>
          <ThemeToggle />
          {auth?.logged_in ? (
            <>
              <Link href="/my" className="nav-btn" style={{ textDecoration: "none" }}>
                files
              </Link>
              <Link href="/profile" className="nav-btn" style={{ textDecoration: "none" }}>
                profile
              </Link>
              <button
                type="button"
                className="nav-btn"
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
            <Link href="/" className="nav-btn" style={{ textDecoration: "none" }}>
              login
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
