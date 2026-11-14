import type { Metadata } from "next";
import "./present.css";

export const metadata: Metadata = {
  title: "Present · Melodrip",
  description: "Sound therapy: a singing bowl for headaches and an underwater lullaby for sleep.",
};

export default function PresentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
