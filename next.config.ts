import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The lyrics index is read from disk at runtime, so ship it with the API function.
  // Relax was renamed Present; keep old links and home-screen shortcuts working.
  async redirects() {
    return [{ source: "/relax", destination: "/present", permanent: true }];
  },
  outputFileTracingIncludes: {
    "/api/playlist": ["./data/lyrics-index.json"],
  },
};

export default nextConfig;
