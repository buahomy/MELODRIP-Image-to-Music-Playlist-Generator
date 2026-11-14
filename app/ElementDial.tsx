"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ELEMENTS, elementFx, useElementMix } from "@/lib/elements/fx";

// The little element orb that sits beside every audio in Melodrip. Hover it
// (mouse) or tap it (touch) and Earth, Water, Wind and Fire bloom out around it.
// Tap an element to layer it on: off → soft → strong → off. Each audio keeps its
// own elements, which play on top whenever that audio plays.

type Pos = { x: number; y: number; aim: number }; // aim: angle (radians) toward the screen centre

export function ElementDial({ audioId, label, size = 30 }: { audioId: string; label: string; size?: number }) {
  const mix = useElementMix(audioId);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const closeTimer = useRef(0);
  const finePointer = useRef(false);
  const activeCount = ELEMENTS.filter((e) => mix[e.id] > 0).length;

  useEffect(() => {
    finePointer.current = matchMedia("(hover: hover) and (pointer: fine)").matches;
  }, []);

  function open() {
    clearTimeout(closeTimer.current);
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    // fan toward the middle of the screen, where there's room
    setPos({ x, y, aim: Math.atan2(innerHeight * 0.45 - y, innerWidth / 2 - x) });
  }
  function close(delay = 0) {
    clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setPos(null), delay);
  }

  // close on outside tap, scroll or Escape
  useEffect(() => {
    if (!pos) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".el-bloom") && !btn.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onScroll = () => close();
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [pos]);

  // four elements on a quarter-circle arc, fanned away from the screen edge
  const R = 84;
  const PAD = 30; // keep bubbles fully on screen
  const place = (angle: number, r: number) => {
    if (!pos) return { dx: 0, dy: 0 };
    const x = Math.min(innerWidth - PAD, Math.max(PAD, pos.x + Math.cos(angle) * r));
    const y = Math.min(innerHeight - PAD, Math.max(PAD, pos.y + Math.sin(angle) * r));
    return { dx: x - pos.x, dy: y - pos.y };
  };
  // Rotate the 120° fan until no bubble has to be pushed back on screen (they'd overlap).
  const arcStart = (() => {
    if (!pos) return 0;
    const spill = (start: number) =>
      [0, 1, 2, 3].reduce((sum, i) => {
        const a = start + (i * 40 * Math.PI) / 180;
        const { dx, dy } = place(a, R);
        return sum + Math.hypot(dx - Math.cos(a) * R, dy - Math.sin(a) * R);
      }, 0);
    let best = pos.aim - Math.PI / 3;
    let bestSpill = Infinity;
    for (let k = -18; k <= 18; k++) {
      const start = pos.aim - Math.PI / 3 + (k * 10 * Math.PI) / 180;
      const sp = spill(start) + Math.abs(k) * 0.01; // prefer staying near the aim
      if (sp < bestSpill) {
        bestSpill = sp;
        best = start;
      }
    }
    return best;
  })();

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`el-orb${activeCount ? " on" : ""}${pos ? " open" : ""}`}
        style={{ width: size, height: size }}
        aria-label={`Elements for ${label}${activeCount ? `: ${ELEMENTS.filter((e) => mix[e.id]).map((e) => e.name).join(", ")}` : ""}`}
        aria-expanded={!!pos}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (pos) close();
          else open();
        }}
        onPointerEnter={() => finePointer.current && open()}
        onPointerLeave={() => finePointer.current && close(260)}
      >
        <span className="el-orb-core" aria-hidden />
        {activeCount > 0 && (
          <span className="el-orb-dots" aria-hidden>
            {ELEMENTS.filter((e) => mix[e.id] > 0).map((e) => (
              <i key={e.id} style={{ background: e.color }} />
            ))}
          </span>
        )}
      </button>
      {pos &&
        createPortal(
          <div className="el-bloom" style={{ left: pos.x, top: pos.y }}
            onPointerEnter={() => clearTimeout(closeTimer.current)}
            onPointerLeave={() => finePointer.current && close(260)}>
            <span className="el-bloom-label"
              style={{ left: place(arcStart + Math.PI / 3, R + 92).dx, top: place(arcStart + Math.PI / 3, R + 92).dy }}>
              Add an element
            </span>
            {ELEMENTS.map((el, i) => {
              const lvl = mix[el.id];
              const { dx, dy } = place(arcStart + (i * 40 * Math.PI) / 180, R);
              return (
                <button key={el.id} type="button" className={`el-pick${lvl ? " on" : ""}${lvl === 1 ? " strong" : ""}`}
                  style={{ "--ec": el.color, "--dx": `${dx}px`, "--dy": `${dy}px`, animationDelay: `${i * 35}ms` } as React.CSSProperties}
                  aria-label={`${el.name}: ${lvl === 0 ? "off" : lvl === 1 ? "strong" : "soft"}. Tap to change.`}
                  onClick={(e) => {
                    e.stopPropagation();
                    elementFx.cycle(audioId, el.id);
                  }}>
                  <span aria-hidden>{el.emoji}</span>
                  <small>{lvl === 0 ? el.name : lvl === 1 ? "Strong" : "Soft"}</small>
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
