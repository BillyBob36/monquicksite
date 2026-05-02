import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build standalone : minifie l'image Docker en ne copiant que server.js + deps
  // necessaires (au lieu de tout node_modules). Doit matcher le Dockerfile.
  output: "standalone",

  // Headers sur l'app : on attend de toute facon que Cloudflare gere CSP/HSTS
  // au niveau edge, mais on met une baseline minimale.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
