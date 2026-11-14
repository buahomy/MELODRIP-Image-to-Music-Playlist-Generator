import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Melodrip",
    short_name: "Melodrip",
    description: "Find music for any moment, unwind with sound therapy, and make beats with AI.",
    start_url: "/",
    display: "standalone",
    background_color: "#0d0830",
    theme_color: "#0d0830",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
