import type { Metadata } from "next";
import Planets from "./Planets";
import "./planets.css";

export const metadata: Metadata = {
  title: "Sound Planets · Melodrip",
  description: "A circular music machine for kids: animal planets sing as they orbit the sun.",
};

export default function PlanetsPage() {
  return <Planets />;
}
