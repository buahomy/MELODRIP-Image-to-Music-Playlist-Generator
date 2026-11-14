// Beat Lab data: five drum voices on a 16-step bar, 24 reference grooves in
// eight styles, and a short text code for sharing a pattern.

export const STEPS = 16;

// Voice colours come from the Melodrip palette.
export const VOICES = [
  { id: "kick", name: "Kick", color: "#9b8cff" },
  { id: "snare", name: "Snare", color: "#ff8fd8" },
  { id: "clap", name: "Clap", color: "#7fd6ff" },
  { id: "ohat", name: "Open hat", color: "#c070ff" },
  { id: "hat", name: "Closed hat", color: "#ffc27a" },
] as const;

export const N = VOICES.length * STEPS; // 80 cells, voice-major
export const GENRES = ["House", "Techno", "Hip-hop", "Trap", "Breakbeat", "Drum & bass", "Reggaeton", "Afrobeats"];
export const GENRE_BPM = [124, 132, 90, 140, 112, 172, 96, 104];

export type Groove = { g: number; name: string; cells: Float32Array };

const _ = "................";
// Rows: kick, snare, clap, open hat, closed hat. One bar of 16th notes.
const RAW: [number, string, ...string[]][] = [
  [0, "Classic house", "x...x...x...x...", _, "....x.......x...", "..x...x...x...x.", _],
  [0, "Deep house", "x...x...x...x...", "....x.......x...", _, "..x...x...x...x.", ".x.x.x.x.x.x.x.x"],
  [0, "Shuffle house", "x...x...x...x..x", _, "....x.......x...", "..x...x...x...x.", "x..xx..xx..xx..x"],
  [1, "Warehouse techno", "x...x...x...x...", _, "....x.......x...", "..x...x...x...x.", "xx.xxx.xxx.xxx.x"],
  [1, "Minimal techno", "x...x...x...x...", "..........x.....", "....x.......x...", _, "x.x.x.x.x.x.x.x."],
  [1, "Rumble techno", "x...x...x...x.x.", _, "....x.......x...", "..x...x...x.....", ".x.x.x.x.x.x.x.x"],
  [2, "Boom bap", "x.....x...x.....", "....x.......x...", _, _, "x.x.x.x.x.x.x.x."],
  [2, "Lazy boom bap", "x......xx.x.....", "....x.......x...", _, "..............x.", "x.x.x.x.x.x.x..."],
  [2, "Dusty boom bap", "x.....x..x......", "....x..x....x...", _, _, "x.xxx.x.x.xxx.x."],
  [3, "Atlanta trap", "x......x..x.....", "........x.......", "........x.......", _, "xxxxxxxxxxxxxxxx"],
  [3, "Rolling trap", "x.....x...x..x..", "........x.......", _, _, "x.x.xxx.x.x.xxxx"],
  [3, "Bouncing trap", "x..x......x..x..", "........x.....x.", _, _, "xxx.x.x.xxx.x.xx"],
  [4, "Amen-style break", "x.x.......xx....", "....x..x.x..x..x", _, _, "x.x.x.x.x.x.x.x."],
  [4, "Funky break", "x.x...x...x..x..", "....x..x....x..x", _, ".......x.....x..", "xxxxxxx.xxxxx.xx"],
  [4, "Big beat", "x.....x.x.......", "....x.......x...", "....x.......x...", _, "x.x.x.x.x.x.x.x."],
  [5, "Two-step", "x.........x.....", "....x.......x...", _, _, "x.x.x.x.x.x.x.x."],
  [5, "Rolling DnB", "x.........xx....", "....x..x.....x..", _, _, "xxxxxxxxxxxxxxxx"],
  [5, "Jungle", "x.x.......x.....", "....x.......x..x", _, "......x.........", "x.x.x...x.x.xxx."],
  [6, "Dembow", "x...x...x...x...", "...x..x....x..x.", _, _, "x.x.x.x.x.x.x.x."],
  [6, "Dembow clap", "x...x...x...x...", _, "...x..x....x..x.", _, ".x.x.x.x.x.x.x.x"],
  [6, "Dembow roll", "x...x...x...x...", "...x..x.x..x..x.", _, "..............x.", "x.x.x.x.x.x.x..."],
  [7, "Afrobeats bounce", "x..x..x...x.....", "....x.......x...", _, _, "x.xx.xx.x.xx.xx."],
  [7, "Afro swing", "x.....x...x..x..", "...x...x...x..x.", _, _, "x.x.x.x.x.x.x.x."],
  [7, "Afro groove", "x..x...x..x.....", "......x.......x.", _, "..x.......x.....", "x...x.x.x...x.x."],
];

export const CORPUS: Groove[] = RAW.map(([g, name, ...rows]) => {
  const cells = new Float32Array(N);
  rows.forEach((r, v) => {
    for (let s = 0; s < STEPS; s++) cells[v * STEPS + s] = r[s] === "x" ? 1 : 0;
  });
  return { g, name, cells };
});

/** "sp-<20 hex digits>-<bpm>": 80 cells packed four to a hex digit. */
export function encodeCode(grid: Float32Array, bpm: number) {
  let hex = "";
  for (let i = 0; i < N; i += 4) {
    hex += ((grid[i] << 3) | (grid[i + 1] << 2) | (grid[i + 2] << 1) | grid[i + 3]).toString(16);
  }
  return `sp-${hex}-${bpm}`;
}

export function decodeCode(code: string): { grid: Float32Array; bpm: number } | null {
  const m = /^sp-([0-9a-f]{20})-(\d{2,3})$/i.exec(code.trim());
  if (!m) return null;
  const grid = new Float32Array(N);
  [...m[1]].forEach((h, k) => {
    const n = parseInt(h, 16);
    for (let b = 0; b < 4; b++) grid[k * 4 + b] = (n >> (3 - b)) & 1;
  });
  return { grid, bpm: Math.min(180, Math.max(60, Number(m[2]))) };
}
