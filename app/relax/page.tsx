"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BowlView } from "./BowlView";
import { SeaView } from "./SeaView";

// Sound therapy (from SoundPal): ask how you feel, then open the matching scene.
// The scene is kept in the URL hash so the phone's back gesture returns here.

type Scene = "headache" | "sleep";
const readHash = (): Scene | null => {
  const h = window.location.hash.slice(1);
  return h === "headache" || h === "sleep" ? h : null;
};

export default function Relax() {
  const [scene, setScene] = useState<Scene | null>(null);
  const openedHere = useRef(false);

  useEffect(() => {
    setScene(readHash());
    const onHash = () => setScene(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const open = (s: Scene) => {
    openedHere.current = true;
    window.location.hash = s;
  };
  const back = () => {
    // Opened from the picker: pop that history entry. Deep-linked: just drop the hash.
    if (openedHere.current) window.history.back();
    else window.history.replaceState(null, "", window.location.pathname);
    openedHere.current = false;
    setScene(null);
  };

  if (scene === "headache") return <BowlView onBack={back} />;
  if (scene === "sleep") return <SeaView onBack={back} />;

  return (
    <main className="screen">
      <header className="nav">
        <Link href="/" className="nav-back">‹ Melodrip</Link>
        <div className="rx-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.jpg" alt="" />
          <div>
            <h1>
              <span className="serif glow-text">Relax.</span>
            </h1>
            <p>Sound therapy, made live on your phone.</p>
          </div>
        </div>
      </header>

      <h2 className="group-title">How are you feeling?</h2>
      <div className="rx-choices">
        <button className="rx-choice rx-choice-gold" onClick={() => open("headache")}>
          <span className="rx-choice-tag">01 · Singing bowl</span>
          <span className="rx-choice-title">Headache / migraine</span>
          <span className="rx-choice-sub">Singing bowl drone with a chime on every turn of a golden wheel</span>
        </button>
        <button className="rx-choice rx-choice-sea" onClick={() => open("sleep")}>
          <span className="rx-choice-tag">02 · Sunken temple</span>
          <span className="rx-choice-title">Anxious / deep sleep</span>
          <span className="rx-choice-sub">Ocean swells and a lullaby, box breathing and a sleep timer</span>
        </button>
      </div>
      <p className="group-footer">
        Use headphones at a gentle volume. This is for relaxation and isn&apos;t a medical treatment.
      </p>
    </main>
  );
}
