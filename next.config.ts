import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The lyrics index is read from disk at runtime, so ship it with the API function.
  outputFileTracingIncludes: {
    "/api/playlist": ["./data/lyrics-index.json"],
  },
};

export default nextConfig;
