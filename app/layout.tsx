import type { Metadata, Viewport } from "next";
import { Fira_Code, Instrument_Serif, Inter_Tight } from "next/font/google";
import "./globals.css";

// Type: Inter Tight for UI and headlines, Instrument Serif italic for single
// accent words, Fira Code for labels and numbers.
const sans = Inter_Tight({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "italic", variable: "--font-serif", display: "swap" });
const mono = Fira_Code({ subsets: ["latin"], weight: "400", variable: "--font-mono", display: "swap" });

const description = "Find music for any moment, unwind with sound therapy, and make beats with AI.";

export const metadata: Metadata = {
  title: "Melodrip · Find, feel and make music",
  description,
  applicationName: "Melodrip",
  // Full-bleed on iPhone: the violet background runs under the status bar.
  appleWebApp: { capable: true, title: "Melodrip", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0d0830",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
