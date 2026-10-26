// Notation helpers for the score: pitch names, melodic lines, chord symbols
// and a small voice-leading search for the pads.
const PC = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };

export function midi(name) {
  const m = /^([A-G](?:#|b)?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`Bad pitch ${name}`);
  return (Number(m[2]) + 1) * 12 + PC[m[1]];
}

// "E4:1.5 G4:.5 B4:2 | A4:1 r:1 _:2" -> [{ at, dur, midi, accent }]. Durations
// are in beats; "r" rests, "_" ties onto the previous note, ">" accents and
// bar lines are only for reading.
export function line(text) {
  const notes = []; let at = 0;
  for (const token of text.split(/\s+/).filter((t) => t && t !== "|")) {
    const [pitch, length] = token.split(":"), accent = pitch.endsWith(">"), name = accent ? pitch.slice(0, -1) : pitch;
    const dur = Number(length);
    if (!Number.isFinite(dur)) throw new Error(`Bad duration in ${token}`);
    if (name === "_") notes.at(-1).dur += dur;
    else if (name !== "r") notes.push({ at, dur, midi: midi(name), accent });
    at += dur;
  }
  return notes;
}
export const lineLength = (text) => text.split(/\s+/).filter((t) => t && t !== "|").reduce((sum, t) => sum + Number(t.split(":")[1]), 0);

const QUALITIES = {
  "": [0, 4, 7], m: [0, 3, 7], 5: [0, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], "maj7#11": [0, 4, 7, 11, 6],
  sus2: [0, 2, 7], sus4: [0, 5, 7], "7sus4": [0, 5, 7, 10], add9: [0, 4, 7, 2], madd9: [0, 3, 7, 2], m9: [0, 3, 7, 10, 2],
  dim: [0, 3, 6], m7b5: [0, 3, 6, 10], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9], "7b9": [0, 4, 7, 10, 1], mMaj7: [0, 3, 7, 11], aug: [0, 4, 8],
};
// "C#m7b5/G", "Bsus4", "E5". Returns root/bass pitch classes and chord tones.
export function chord(symbol) {
  const m = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(symbol);
  if (!m || !(m[2] in QUALITIES)) throw new Error(`Bad chord ${symbol}`);
  const root = PC[m[1]], tones = QUALITIES[m[2]].map((i) => (root + i) % 12);
  return { symbol, root, bass: m[3] ? PC[m[3]] : root, tones, third: tones[1], quality: m[2] };
}
// "Em | C | B7sus4:2 B7:2" -> [{ at, dur, chord }] with per-bar defaults.
export function chart(text, beatsPerBar) {
  const out = []; let at = 0;
  for (const bar of text.split("|").map((b) => b.trim()).filter(Boolean)) {
    const parts = bar.split(/\s+/);
    for (const part of parts) {
      const [symbol, length] = part.split(":"), dur = length ? Number(length) : beatsPerBar / parts.length;
      out.push({ at, dur, chord: chord(symbol) });
      at += dur;
    }
  }
  return out;
}
export const nearest = (pc, around) => { let best = around; for (let m = around - 6; m <= around + 6; m++) if (((m % 12) + 12) % 12 === pc) { best = m; break; } return best; };
export const inRange = (pc, low, high) => { const out = []; for (let m = low; m <= high; m++) if (((m % 12) + 12) % 12 === pc) out.push(m); return out; };

// Choose upper-voice pitches for each chord: chord tones only, 3rd (and any
// 7th or colour tone) present, small motion from the previous voicing, no
// parallel fifths or octaves against each other or the bass, open spacing.
export function voiceLead(changes, { voices = 4, low = 52, high = 76, start = null, bassLow = 36 } = {}) {
  let previous = start, prevBass = null;
  return changes.map(({ chord: c }) => {
    const bass = inRange(c.bass, bassLow, bassLow + 11)[0];
    const pool = []; for (let m = low; m <= high; m++) if (c.tones.includes(m % 12)) pool.push(m);
    const essential = (c.tones.length > 3 ? [c.third, ...c.tones.slice(3)] : [c.third]).slice(0, voices);
    let best = null;
    const pick = (from, chosen) => {
      if (chosen.length === voices) {
        const pcs = new Set(chosen.map((m) => m % 12));
        if (!essential.every((pc) => pcs.has(pc))) return;
        let cost = 0;
        for (let i = 1; i < voices; i++) { const gap = chosen[i] - chosen[i - 1]; if (gap > 12) cost += (gap - 12) * 3; if (gap < 3) cost += 4; }
        if (previous) {
          for (let i = 0; i < voices; i++) cost += Math.abs(chosen[i] - previous[i]) * 1.2;
          const pairs = (a, b, pa, pb) => { const now = (b - a) % 12, then = (pb - pa) % 12; return (now === 7 || now === 0) && now === then && a !== pa; };
          for (let i = 0; i < voices; i++) { for (let j = i + 1; j < voices; j++) if (pairs(chosen[i], chosen[j], previous[i], previous[j])) cost += 30; if (prevBass != null && pairs(bass, chosen[i], prevBass, previous[i])) cost += 20; }
        } else cost += Math.abs(chosen.reduce((a, b) => a + b, 0) / voices - (low + high) / 2);
        const doubledThird = chosen.filter((m) => m % 12 === c.third).length > 1; if (doubledThird) cost += 6;
        if (!best || cost < best.cost) best = { cost, chosen: [...chosen] };
        return;
      }
      for (let k = from; k < pool.length; k++) { chosen.push(pool[k]); pick(k + 1, chosen); chosen.pop(); }
    };
    pick(0, []);
    if (!best) throw new Error(`No voicing for ${c.symbol}`);
    previous = best.chosen; prevBass = bass;
    return { bass, upper: best.chosen };
  });
}
