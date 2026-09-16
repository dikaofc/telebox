"use client";

import { useState, useEffect } from "react";

type Stats = {
  total_files: number;
  total_size_human: string;
  total_users: number;
  total_keys: number;
  deduped_saves: number;
  top_files: { name: string; mime: string; size: number }[];
};

type Report = {
  id: number;
  file_id: string;
  file_name: string;
  reason: string;
  created_at: string;
  reviewed: boolean;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function AdminPage() {
  const [tab, setTab] = useState<"stats" | "reports">("stats");
  const [stats, setStats] = useState<Stats | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [error, setError] = useState<string | null>(null);

  function loadReports() {
    fetch("/api/reports")
      .then((r) => (r.ok ? r.json() : { reports: [] }))
      .then((d) => setReports(d.reports ?? []))
      .catch(() => {});
  }

  useEffect(() => {
    fetch("/api/admin")
      .then((r) => {
        if (!r.ok) throw new Error("unauthorized or error");
        return r.json();
      })
      .then(setStats)
      .catch((e) => setError(e.message));
    loadReports();
  }, []);

  if (error) {
    return (
      <main style={{ maxWidth: 560, margin: "10vh auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 24 }}>Admin</h1>
        <p style={{ color: "#c00" }}>{error}</p>
      </main>
    );
  }

  if (!stats) {
    return (
      <main style={{ maxWidth: 560, margin: "10vh auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 24 }}>Admin</h1>
        <p>Loading...</p>
      </main>
    );
  }

  const openCount = reports.filter((r) => !r.reviewed).length;

  return (
    <main style={{ maxWidth: 640, margin: "6vh auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 24, marginBottom: 24 }}>Admin Dashboard</h1>

      <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
        <button
          onClick={() => setTab("stats")}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: tab === "stats" ? 700 : 400, textDecoration: tab === "stats" ? "underline" : "none" }}
        >
          Stats
        </button>
        <button
          onClick={() => setTab("reports")}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: tab === "reports" ? 700 : 400, textDecoration: tab === "reports" ? "underline" : "none" }}
        >
          Reports {openCount > 0 && `(${openCount})`}
        </button>
      </div>

      {tab === "stats" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 32 }}>
            <div style={{ padding: 16, background: "#f5f5f5", borderRadius: 8 }}>
              <div style={{ fontSize: 13, color: "#666" }}>Files</div>
              <div style={{ fontSize: 24, fontWeight: 600 }}>{stats.total_files}</div>
            </div>
            <div style={{ padding: 16, background: "#f5f5f5", borderRadius: 8 }}>
              <div style={{ fontSize: 13, color: "#666" }}>Storage</div>
              <div style={{ fontSize: 24, fontWeight: 600 }}>{stats.total_size_human}</div>
            </div>
            <div style={{ padding: 16, background: "#f5f5f5", borderRadius: 8 }}>
              <div style={{ fontSize: 13, color: "#666" }}>Users</div>
              <div style={{ fontSize: 24, fontWeight: 600 }}>{stats.total_users}</div>
            </div>
            <div style={{ padding: 16, background: "#f5f5f5", borderRadius: 8 }}>
              <div style={{ fontSize: 13, color: "#666" }}>API Keys</div>
              <div style={{ fontSize: 24, fontWeight: 600 }}>{stats.total_keys}</div>
            </div>
            <div style={{ padding: 16, background: "#f5f5f5", borderRadius: 8, gridColumn: "span 2" }}>
              <div style={{ fontSize: 13, color: "#666" }}>Dedup saves (duplicate refs avoided)</div>
              <div style={{ fontSize: 24, fontWeight: 600 }}>{stats.deduped_saves}</div>
            </div>
          </div>

          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Largest Files</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th style={{ padding: 8 }}>Name</th>
                <th style={{ padding: 8 }}>Type</th>
                <th style={{ padding: 8, textAlign: "right" }}>Size</th>
              </tr>
            </thead>
            <tbody>
              {stats.top_files.map((f, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: 8, wordBreak: "break-all" }}>{f.name}</td>
                  <td style={{ padding: 8, color: "#666" }}>{f.mime.split("/").pop()}</td>
                  <td style={{ padding: 8, textAlign: "right" }}>{formatSize(f.size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {tab === "reports" && (
        <>
          {reports.length === 0 && <p style={{ color: "#999", fontSize: 14 }}>No reports.</p>}
          {reports.map((r) => (
            <div key={r.id} style={{ padding: "12px 0", borderBottom: "1px solid #eee" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 14 }}>
                  <a href={`/i/${r.file_id}`} style={{ color: "#111", textDecoration: "none", fontWeight: 500 }}>
                    {r.file_name}
                  </a>{" "}
                  <span style={{ color: "#999" }}>({r.reviewed ? "reviewed" : "new"})</span>
                </div>
                {!r.reviewed && (
                  <button
                    onClick={async () => {
                      await fetch("/api/reports", {
                        method: "DELETE",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ id: r.id }),
                      });
                      loadReports();
                    }}
                    style={{ background: "none", border: "1px solid #c00", color: "#c00", borderRadius: 4, padding: "3px 10px", cursor: "pointer", fontSize: 12 }}
                  >
                    remove file
                  </button>
                )}
              </div>
              <div style={{ fontSize: 13, color: "#666", marginTop: 2 }}>{r.reason}</div>
              <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>{new Date(r.created_at).toLocaleString()}</div>
            </div>
          ))}
        </>
      )}
    </main>
  );
}