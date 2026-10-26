// Renders a Piece's events into its buses ("bed", "a", "b" or "s"), each a
// stereo dry mix plus its hall return. Loops wrap note and reverb tails onto
// the start; stingers render once with room for the tail.
import { renderNote, SEATING } from "./instruments.mjs";
import { hall, stereo, rng, hashSeed, dbGain, clamp } from "./dsp.mjs";

// Section balance (dB) against the synthesis models' raw levels.
export const MIX = {
  violins: 0, violas: -1, cellos: 0, basses: 0, pizz: 8,
  flute: 5, altoFlute: 6, oboe: 1, englishHorn: 3, clarinet: 1, bassClarinet: 6, bassoon: 1,
  horns: 0, trumpets: -4, trombones: -1, tuba: -1,
  harp: 3, celesta: 2, glock: -2, choir: 4,
  timpani: 3, taiko: 6, bassDrum: 4, frame: 8, tom: 2, tamtam: 5, cymbal: 3,
};
// Onset looseness by family (seconds): strings breathe, percussion is tight.
const LOOSE = { strings: .012, winds: .007, brass: .009, pluck: .004, bars: .004, choir: .016, perc: .002 };
const FAMILY = (s) => ["violins", "violas", "cellos", "basses"].includes(s) ? "strings" : ["horns", "trumpets", "trombones", "tuba"].includes(s) ? "brass"
  : ["harp", "pizz"].includes(s) ? "pluck" : ["celesta", "glock"].includes(s) ? "bars" : s === "choir" ? "choir"
  : ["flute", "altoFlute", "oboe", "englishHorn", "clarinet", "bassClarinet", "bassoon"].includes(s) ? "winds" : "perc";

export function renderPiece(piece, rate, { loop = true, length = null, progress = () => {}, key = (event) => event.bus, only = () => true } = {}) {
  const spb = 60 / piece.tempo, frames = Math.round((length ?? piece.seconds) * rate);
  const buses = {};
  const bus = (name) => (buses[name] ??= { dry: stereo(frames), send: stereo(frames) });
  piece.events.forEach((event, index) => {
    if (!only(event)) return;
    const [seatPan, distance] = SEATING[event.section], family = FAMILY(event.section), human = rng(hashSeed(`${piece.id}:${index}:human`));
    const start = event.at * spb + human.signed() * LOOSE[family];
    const note = {
      ...event, dur: event.dur * spb, seed: hashSeed(`${piece.id}:${index}:${event.section}`),
      pan: clamp((event.pan ?? 0) + seatPan, -1, 1), vel: clamp(event.vel * (1 + human.signed() * .05), .02, 1),
    };
    const [L, R] = renderNote(note, rate), gain = dbGain((MIX[event.section] ?? 0) + (event.gain ?? 0)), target = bus(key(event));
    let offset = Math.round(start * rate);
    if (loop) offset = ((offset % frames) + frames) % frames;
    for (let i = 0; i < L.length; i++) {
      let j = offset + i;
      if (loop) j %= frames; else if (j < 0 || j >= frames) continue;
      const l = L[i] * gain, r = R[i] * gain;
      target.dry[0][j] += l; target.dry[1][j] += r;
      target.send[0][j] += l * distance; target.send[1][j] += r * distance;
    }
    if (index % 50 === 0) progress(index / piece.events.length);
  });
  const out = {};
  for (const [name, { dry, send }] of Object.entries(buses)) {
    const wet = hall(send, rate, { ...piece.hall, loop });
    out[name] = [dry[0].map((v, i) => v + wet[0][i]), dry[1].map((v, i) => v + wet[1][i])];
  }
  return out;
}
