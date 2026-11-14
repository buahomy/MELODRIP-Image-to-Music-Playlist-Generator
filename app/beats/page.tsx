import type { Metadata } from "next";
import BeatLab from "./BeatLab";
import "./beats.css";

export const metadata: Metadata = {
  title: "Beat Lab · Melodrip",
  description: "Pop a 3D drum ring and let an on-device AI complete, vary or dream up the groove.",
};

export default function BeatsPage() {
  return <BeatLab />;
}
