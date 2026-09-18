import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pg uses dynamic requires (optional pg-native); let the server runtime
  // load it directly instead of webpack trying to bundle it.
  serverExternalPackages: ["pg"],
  // Baseline hardening for every response. The app renders user-supplied
  // pastes/comments/filenames as React text (auto-escaped); CSP blocks any
  // injected script from executing even if an escape were ever missed.
  // 'unsafe-inline' styles are required by the inline style props used
  // throughout the UI.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "media-src 'self' blob:",
              "font-src 'self'",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
