import { ImageResponse } from "next/og";

// Shared artwork for icon.tsx and apple-icon.tsx: a music note dripping on a
// pink-to-violet gradient. iOS applies its own rounded mask.
export function renderAppIcon(size: number) {
  const s = size / 512;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(160deg, #ff5e7e 0%, #b04cff 100%)",
        }}
      >
        <svg width={300 * s} height={300 * s} viewBox="0 0 24 24" fill="white">
          <path d="M9 17.5a3 3 0 1 1-2-2.83V5.2a1 1 0 0 1 .76-.97l10-2.5A1 1 0 0 1 19 2.7v12.8a3 3 0 1 1-2-2.83V6.03l-8 2V17.5Z" />
        </svg>
      </div>
    ),
    { width: size, height: size }
  );
}
