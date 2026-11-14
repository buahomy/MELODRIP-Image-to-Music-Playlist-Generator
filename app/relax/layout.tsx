import type { Metadata } from "next";
import "./relax.css";

export const metadata: Metadata = {
  title: "Relax · Melodrip",
  description: "Sound therapy: a singing bowl for headaches and an underwater lullaby for sleep.",
};

export default function RelaxLayout({ children }: { children: React.ReactNode }) {
  return children;
}
