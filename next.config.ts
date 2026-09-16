import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pg uses dynamic requires (optional pg-native); let the server runtime
  // load it directly instead of webpack trying to bundle it.
  serverExternalPackages: ["pg"],
};

export default nextConfig;