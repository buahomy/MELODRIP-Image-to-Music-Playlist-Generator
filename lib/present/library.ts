// The Present sound library: therapy and wellbeing soundscapes grouped the way
// people look for them (sleep, calm, anxiety, tinnitus, focus, brainwaves,
// babies, low mood). Every sound is synthesised live from the layers in
// synth.ts; each layer gets its own slider.

import {
  aeolian, bambooKnock, bells, binaural, birds, bowl, chant, crickets, drops, fan, fire, greyNoise, heartbeat,
  isochronic, lapping, marimba, noise, notchedNoise, pad, pureTone, purr, rush, shush, stream, thunder,
  underwater, waves, wind, womb, type Layer,
} from "./synth";

export type LayerDef = { name: string; layer: Layer; level: number };
export type Tune = { label: string; min: number; max: number; step: number; value: number; unit: string };
export type Sound = {
  id: string;
  name: string;
  emoji: string;
  blurb: string;
  headphones?: boolean;
  tune?: Tune; // one adjustable setting that rebuilds the sound (e.g. tinnitus pitch)
  build: (tune: number) => LayerDef[];
};
export type Section = { id: string; title: string; blurb: string; emoji: string; sounds: Sound[]; scene?: "headache" | "sleep" };

const L = (name: string, layer: Layer, level = 0.7): LayerDef => ({ name, layer, level });
const BELL_SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
const LOW_BELLS = [261.63, 293.66, 329.63, 392, 440];

// shared sounds that appear in more than one section
const colourNoise: Sound = {
  id: "colour-noise", name: "Colour Noise", emoji: "🌈", blurb: "White, pink, brown and grey noise to mix to taste",
  build: () => [L("White", noise("white"), 0.15), L("Pink", noise("pink"), 0.6), L("Brown", noise("brown"), 0.45), L("Grey", greyNoise, 0)],
};
const catPurr: Sound = {
  id: "cat-purr", name: "Cat Purr", emoji: "🐈", blurb: "A content cat curled up beside you",
  build: () => [L("Purr", purr, 0.8), L("Room", noise("brown", { type: "lowpass", freq: 300 }), 0.15)],
};
const binauralBeats: Sound = {
  id: "binaural", name: "Binaural Beats", emoji: "🎧", blurb: "A slightly different tone in each ear; mix the brainwave bands",
  headphones: true,
  build: () => [
    L("Delta 2 Hz · deep sleep", binaural(110, 2), 0),
    L("Theta 6 Hz · dreamy", binaural(150, 6), 0.5),
    L("Alpha 10 Hz · calm focus", binaural(200, 10), 0.4),
    L("Beta 18 Hz · alert", binaural(250, 18), 0),
    L("Gamma 40 Hz · sharp", binaural(300, 40), 0),
    L("Pink noise bed", noise("pink", { type: "lowpass", freq: 2000 }), 0.25),
  ],
};
const singingBowls: Sound = {
  id: "singing-bowls", name: "Singing Bowls", emoji: "🥣", blurb: "Warm bowls ringing into each other",
  build: () => [L("Low bowl", bowl(108), 0.7), L("High bowl", bowl(162), 0.35), L("Chimes", bells(BELL_SCALE, 0.12, 6), 0.3)],
};

export const SECTIONS: Section[] = [
  {
    id: "sleep", title: "Sleep Aid", emoji: "🌙", blurb: "Fall asleep faster and stay asleep", scene: "sleep",
    sounds: [
      { id: "waterfall", name: "Waterfall", emoji: "💧", blurb: "Nature's own white noise",
        build: () => [L("Falls", rush(1100, 0.35), 0.6), L("Rumble", noise("brown", { type: "lowpass", freq: 200 }), 0.5), L("Spray", noise("white", { type: "highpass", freq: 5000 }), 0.12)] },
      { id: "distant-storm", name: "Distant Storm", emoji: "⛈️", blurb: "Gentle rain with thunder far away",
        build: () => [L("Rain bed", rush(1800, 0.5), 0.6), L("Drops", drops(30), 0.6), L("Thunder", thunder, 0.7), L("Wind", wind(400), 0.25)] },
      { id: "rain-tent", name: "Rain on a Tent", emoji: "⛺", blurb: "Snug inside while it pours",
        build: () => [L("Tent drops", drops(55, true), 0.9), L("Rain outside", rush(2200, 0.5), 0.35), L("Wind", wind(350), 0.2)] },
      { id: "fireside", name: "Fireside", emoji: "🔥", blurb: "A crackling fire on a cold night",
        build: () => [L("Fire", fire, 0.8), L("Wind outside", wind(300), 0.15), L("Rain on glass", drops(12), 0)] },
      { id: "box-fan", name: "Box Fan", emoji: "🌀", blurb: "The steady hum so many people sleep to",
        build: () => [L("Fan", fan, 0.7), L("Room tone", noise("pink", { type: "lowpass", freq: 1200 }), 0.15)] },
      { id: "calm-lake", name: "Calm Lake", emoji: "🏞️", blurb: "Water lapping at a quiet shore",
        build: () => [L("Lapping", lapping, 0.75), L("Breeze", wind(600), 0.2), L("Crickets", crickets, 0.15)] },
    ],
  },
  {
    id: "meditation", title: "Meditation & Relaxation", emoji: "🪷", blurb: "Settle into a deeper state of calm", scene: "headache",
    sounds: [
      singingBowls,
      { id: "deep-chant", name: "Deep Chant", emoji: "🕉️", blurb: "A low, steady Om to breathe along with",
        build: () => [L("Low voice", chant(98), 0.8), L("Higher voice", chant(147), 0.25), L("Bowl", bowl(98), 0.2)] },
      { id: "temple-bells", name: "Temple Bells", emoji: "🔔", blurb: "Bells drifting across a courtyard",
        build: () => [L("Bells", bells(LOW_BELLS, 0.3, 7), 0.7), L("Small chimes", bells(BELL_SCALE, 0.25, 3), 0.25), L("Breeze", wind(500), 0.2)] },
      { id: "zen-garden", name: "Zen Garden", emoji: "🎋", blurb: "A stream, birds and a bamboo fountain",
        build: () => [L("Stream", stream, 0.5), L("Bamboo", bambooKnock, 0.6), L("Birds", birds, 0.3), L("Breeze", wind(700), 0.15)] },
      { id: "aeolian", name: "Wind Harp", emoji: "🌬️", blurb: "Strings singing in the wind",
        build: () => [L("Harp", aeolian, 0.7), L("Wind", wind(450), 0.4)] },
    ],
  },
  {
    id: "anxiety", title: "Stress & Anxiety Relief", emoji: "🫶", blurb: "Slow down a racing mind",
    sounds: [
      { id: "healing-stream", name: "Healing Stream", emoji: "🌿", blurb: "A forest brook with birdsong",
        build: () => [L("Brook", stream, 0.65), L("Birds", birds, 0.3), L("Leaves", wind(900), 0.15)] },
      catPurr,
      { id: "night-rain", name: "Night Rain", emoji: "🌧️", blurb: "Soft rain, far-off thunder, slow breaths",
        build: () => [L("Rain", rush(1600, 0.5), 0.5), L("Drops", drops(25), 0.4), L("Thunder", thunder, 0.4)] },
      { id: "ocean-breath", name: "Ocean Breath", emoji: "🌊", blurb: "Waves timed to a slow 10-second breath",
        build: () => [L("Waves", waves(10), 0.85), L("Spray", noise("white", { type: "highpass", freq: 6000 }), 0.06), L("Gulls far away", birds, 0)] },
      { id: "safe-place", name: "Safe Place", emoji: "🏡", blurb: "A warm chord, a soft fire, birds outside",
        build: () => [L("Warm chord", pad([130.81, 196, 261.63, 329.63]), 0.5), L("Fire", fire, 0.25), L("Birds", birds, 0.2)] },
    ],
  },
  {
    id: "tinnitus", title: "Tinnitus Relief", emoji: "👂", blurb: "Ease the ringing with gentle masking",
    sounds: [
      { id: "summer-night", name: "Summer Night", emoji: "🦗", blurb: "Crickets in place of plain white noise",
        build: () => [L("Crickets", crickets, 0.9), L("Night air", noise("pink", { type: "highpass", freq: 3000 }), 0.15), L("Pond", lapping, 0.2)] },
      { id: "notched", name: "Notched Noise", emoji: "🎯", blurb: "Noise with a gap at your ringing pitch",
        tune: { label: "Your ringing pitch", min: 1000, max: 12000, step: 100, value: 6000, unit: "Hz" },
        build: (hz) => [L("Notched noise", notchedNoise(hz), 0.7)] },
      { id: "white-rain", name: "White Rain", emoji: "🌦️", blurb: "Rain with white-noise smoothness",
        build: () => [L("Rain hiss", noise("white", { type: "bandpass", freq: 5000, q: 0.5 }), 0.4), L("Drops", drops(45), 0.5), L("Body", rush(1500, 0.6), 0.4)] },
      colourNoise,
    ],
  },
  {
    id: "focus", title: "ADHD & Focus", emoji: "🎯", blurb: "Steady sound so your mind can settle on one thing",
    sounds: [
      { ...colourNoise, id: "focus-noise", name: "Focus Noise", blurb: "Brown and pink noise to quiet the room" },
      { id: "stormy", name: "Stormy Weather", emoji: "🌩️", blurb: "Wind, rain and thunder, endlessly",
        build: () => [L("Wind", wind(380), 0.5), L("Rain", rush(1900, 0.5), 0.45), L("Drops", drops(35), 0.4), L("Thunder", thunder, 0.5)] },
      { id: "focus-beats", name: "Focus Beats", emoji: "🧠", blurb: "Alpha and beta binaural beats over brown noise",
        headphones: true,
        build: () => [L("Alpha 10 Hz", binaural(200, 10), 0.4), L("Beta 15 Hz", binaural(240, 15), 0.25), L("Brown noise", noise("brown"), 0.4)] },
      { id: "steady-rain", name: "Steady Rain", emoji: "☔", blurb: "Even, unchanging rain",
        build: () => [L("Rain", rush(2000, 0.5), 0.6), L("Drops", drops(50), 0.45)] },
    ],
  },
  {
    id: "therapy", title: "Sound Therapy", emoji: "✨", blurb: "Brainwave tones and healing frequencies",
    sounds: [
      binauralBeats,
      { id: "isochronic", name: "Isochronic Tones", emoji: "〰️", blurb: "Pulsing tones that work without headphones",
        build: () => [L("Theta 6 Hz", isochronic(180, 6), 0.5), L("Alpha 10 Hz", isochronic(220, 10), 0.4), L("Beta 16 Hz", isochronic(260, 16), 0), L("Soft noise", noise("pink", { type: "lowpass", freq: 1500 }), 0.2)] },
      { id: "gamma-40", name: "40 Hertz", emoji: "⚡", blurb: "Gamma-rhythm pulses at 40 per second",
        build: () => [L("40 Hz pulses", isochronic(240, 40), 0.55), L("40 Hz binaural", binaural(200, 40), 0.2), L("Brown noise", noise("brown"), 0.25)] },
      { id: "solfeggio", name: "Solfeggio Tones", emoji: "🎐", blurb: "The nine solfeggio frequencies, to blend",
        build: () => [
          L("174 Hz", pureTone(174), 0), L("285 Hz", pureTone(285), 0), L("396 Hz", pureTone(396), 0.3),
          L("417 Hz", pureTone(417), 0), L("528 Hz", pureTone(528), 0.5), L("639 Hz", pureTone(639), 0),
          L("741 Hz", pureTone(741), 0), L("852 Hz", pureTone(852), 0.2), L("963 Hz", pureTone(963), 0),
        ] },
      singingBowls,
    ],
  },
  {
    id: "baby", title: "Baby Sleep", emoji: "👶", blurb: "Familiar sounds that soothe little ones",
    sounds: [
      { id: "womb", name: "In the Womb", emoji: "🤰", blurb: "A heartbeat and the deep whoosh babies know",
        build: () => [L("Heartbeat", heartbeat(66), 0.6), L("Whoosh", womb, 0.7)] },
      { id: "shusher", name: "Shusher", emoji: "🤫", blurb: "A steady, gentle \"shhh… shhh…\"",
        build: () => [L("Shhh", shush, 0.75), L("Soft bed", noise("pink", { type: "lowpass", freq: 800 }), 0.2)] },
      { id: "underwater", name: "Underwater", emoji: "🫧", blurb: "Low, muffled, floating sounds",
        build: () => [L("Deep water", underwater, 0.8), L("Slow waves", waves(12), 0.3)] },
      { ...catPurr, id: "baby-purr" },
    ],
  },
  {
    id: "mood", title: "Overcome Low Mood", emoji: "🌤️", blurb: "Gentle lift for heavy days",
    sounds: [
      { id: "marimbas", name: "Marimba Garden", emoji: "🪘", blurb: "Bright, bouncing patterns that never repeat quite the same",
        build: () => [L("Marimbas", marimba, 0.85), L("Birds", birds, 0.25), L("Breeze", wind(800), 0.1)] },
      { id: "sunny", name: "Sunny Morning", emoji: "☀️", blurb: "A warm major chord, birdsong and chimes",
        build: () => [L("Warm chord", pad([261.63, 329.63, 392, 493.88], 1200), 0.45), L("Birds", birds, 0.45), L("Chimes", bells(BELL_SCALE, 0.2, 4), 0.25)] },
      { id: "brook-walk", name: "Morning Walk", emoji: "🥾", blurb: "A brook, birds and a light breeze",
        build: () => [L("Brook", stream, 0.45), L("Birds", birds, 0.55), L("Breeze", wind(1000), 0.15)] },
      { ...catPurr, id: "mood-purr" },
    ],
  },
];

export const ALL_SOUNDS = new Map(SECTIONS.flatMap((s) => s.sounds.map((x) => [x.id, x] as const)));
