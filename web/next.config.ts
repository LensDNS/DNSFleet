import type { NextConfig } from "next";

/** Next rewrite destination: full origin of control plane (no trailing slash). */
function normalizeBackendOrigin(): string {
  const raw =
    process.env.DNSFLEET_BACKEND_URL?.trim() || "http://127.0.0.1:8080";
  return raw.replace(/\/+$/, "");
}

const backend = normalizeBackendOrigin();

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/healthz", destination: `${backend}/healthz` },
      {
        source: "/api/v1/:path*",
        destination: `${backend}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
