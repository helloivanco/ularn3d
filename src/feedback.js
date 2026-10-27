import { STAIR_TILES } from "./expedition-cues.js";

// Game-feel importance tiers. A small event barely nudges the view, a medium one
// adds a short presentation hold, and large beats get the stage to themselves.
export const FEEL = Object.freeze({
  small: Object.freeze({ trauma: .08, hold: 0 }),
  medium: Object.freeze({ trauma: .24, hold: 60 }),
  heavy: Object.freeze({ trauma: .34, hold: 80 }),
  large: Object.freeze({ trauma: 0, hold: 0, cooldown: 1500 }),
});
const TAU = Math.PI * 2;

// Screen shake from decaying trauma: offset = trauma² × layered sines, so light
// hits barely move and heavy ones punch. It always settles to exactly zero.
export class Trauma {
  constructor({ decay = 1.6, seed = 1 } = {}) {
    this.value = 0; this.decay = decay; this.at = null;
    this.phase = [1.7, 2.9, 4.1, 5.3, 6.7, 7.9].map((p) => p * seed);
  }
  add(amount, now) { this.tick(now); this.value = Math.min(1, this.value + Math.max(0, amount || 0)); }
  tick(now) {
    if (this.at != null && now > this.at) this.value = Math.max(0, this.value - this.decay * (now - this.at) / 1000);
    this.at = now;
    return this.value;
  }
  // Writes a screen-space pixel offset into `out`; false means at rest.
  offset(now, out, maxPx = 9, scale = 1) {
    const t = this.tick(now), s = t * t * scale;
    if (!(s > 0)) { out.x = out.y = 0; return false; }
    const k = now / 1000, p = this.phase;
    out.x = maxPx * s * (.5 * Math.sin(k * TAU * 9 + p[0]) + .3 * Math.sin(k * TAU * 17 + p[1]) + .2 * Math.sin(k * TAU * 31 + p[2]));
    out.y = maxPx * .8 * s * (.5 * Math.sin(k * TAU * 8 + p[3]) + .3 * Math.sin(k * TAU * 19 + p[4]) + .2 * Math.sin(k * TAU * 29 + p[5]));
    return true;
  }
  get active() { return this.value > 0; }
  reset() { this.value = 0; this.at = null; }
}

// Hit-stop for presentation only: action animations read this clock, which
// stands still during a hold. Walking, the camera and input never use it.
export class PresentationClock {
  constructor({ cap = 120, span = 1000 } = {}) {
    this.cap = cap; this.span = span; this.elapsed = 0; this.windows = []; this.recent = [];
  }
  hold(ms, at) {
    this.recent = this.recent.filter((entry) => entry.end > at - this.span);
    const used = this.recent.reduce((sum, entry) => sum + entry.ms, 0);
    const pending = this.windows.filter((w) => w.end > at);
    if (pending.length >= 2) return 0;
    const take = Math.max(0, Math.min(ms, this.cap - used));
    if (!take) return 0;
    const start = Math.max(at, pending.at(-1)?.end ?? at);
    this.windows.push({ start, end: start + take });
    this.recent.push({ end: start + take, ms: take });
    return take;
  }
  now(real) {
    let held = this.elapsed;
    while (this.windows.length && this.windows[0].end <= real) {
      const done = this.windows.shift();
      this.elapsed += done.end - done.start;
      held = this.elapsed;
    }
    const active = this.windows[0];
    if (active && real > active.start) held += real - active.start;
    return real - held;
  }
  holding(real) { return this.windows.some((w) => w.start <= real && real < w.end); }
  reset() { this.windows.length = 0; }
}

const STATS = ["STR", "INT", "WIS", "CON", "DEX", "CHA"];
// Scalar comparisons only; runs on every authoritative update.
export function diffSnapshot(prev, next) {
  if (!prev || !next) return null;
  const sameRun = prev.gameID === next.gameID;
  const statDeltas = [];
  for (const stat of STATS) {
    const change = (next.stats?.[stat] ?? 0) - (prev.stats?.[stat] ?? 0);
    if (change) statDeltas.push({ stat, change });
  }
  return {
    sameRun,
    hpLost: Math.max(0, prev.hp - next.hp), hpGained: Math.max(0, next.hp - prev.hp),
    manaSpent: Math.max(0, prev.mana - next.mana),
    rankDelta: next.rank - prev.rank, title: next.title,
    hpMaxDelta: next.hpMax - prev.hpMax, manaMaxDelta: next.manaMax - prev.manaMax, statDeltas,
    goldGained: next.bank === prev.bank ? Math.max(0, next.gold - prev.gold) : 0,
    depth: prev.level !== next.level ? { from: prev.level, to: next.level } : null,
    newDeepest: (next.deepest ?? next.level) > (prev.deepest ?? prev.level),
    over: !prev.over && !!next.over, winner: !!next.winner,
    eyeGained: !prev.hasEye && !!next.hasEye, cureGained: !prev.hasCure && !!next.hasCure,
    spellsLearned: Math.max(0, (next.spellsKnown ?? 0) - (prev.spellsKnown ?? 0)),
  };
}

const plain = (line) => String(line ?? "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ");
// How the hero left the previous floor, judged from the tile they stood on and the journal.
export function transitionCause(prevUnderId, log = []) {
  if (STAIR_TILES.has(prevUnderId)) return "stairs";
  const tail = log.slice(-4).map(plain).join(" ").toLowerCase();
  if (tail.includes("trap door")) return "trapdoor";
  if (tail.includes("teleport") || tail.includes("whisked")) return "teleport";
  return "magic";
}

export const depthLabel = (level) => level === 0
  ? { region: "THE TOWN OF ULARN", depth: "Surface" }
  : level > 15
    ? { region: "THE VOLCANO", depth: `Depth V${level - 15}` }
    : { region: "THE CAVES", depth: `Depth ${level}` };

const tileOf = (state, uid) => {
  for (const tile of state.tiles) if (tile.monster?.uid === uid) return tile;
  return null;
};

/**
 * Turns observed engine events and snapshot diffs into layered feedback.
 * Listeners only enqueue; work happens on the next authoritative update, so no
 * snapshot is read mid-action. Sinks own the actual pixels and sounds.
 */
export class FeedbackDirector {
  constructor({ sinks, settings, reduced = false, now = () => performance.now(), timers = globalThis } = {}) {
    this.sinks = sinks; this.settings = settings; this.reduced = reduced; this.clock = now; this.timers = timers;
    this.queue = []; this.beats = []; this.beatReadyAt = 0; this.beatTimer = null; this.history = [];
    this.engaged = null; this.lowHp = 0; this.lastTransition = -Infinity; this.burst = 0; this.burstReset = false;
    this.catchUps = 0; this.under = null; this.timeouts = new Set();
  }
  setSettings(settings) { this.settings = settings; }
  setReduced(reduced) { this.reduced = !!reduced; }
  enqueue(kind, detail) {
    if (detail?.self === false) return;
    if (this.queue.length < 48) this.queue.push([kind, detail]);
  }
  onDamage(detail) { this.enqueue("damage", detail); }
  onHurt(detail) { this.enqueue("hurt", detail); }
  onCombat(detail) {
    if (detail.kind === "weapon" && !detail.hit) this.enqueue("miss", detail);
    else if (detail.kind === "spell" && detail.phase === "impact") this.enqueue("impact", detail);
  }
  onAction(detail) { if (detail.kind === "loot") this.enqueue("loot", detail); }
  note(name) { this.history.push(name); if (this.history.length > 16) this.history.shift(); }
  later(ms, fn) {
    if (this.timeouts.size >= 8) return;
    const id = this.timers.setTimeout(() => { this.timeouts.delete(id); fn(); }, ms);
    this.timeouts.add(id);
  }
  shake(tier) { if (!this.reduced && this.settings.shake > 0 && tier.trauma) this.sinks.world.shake(tier.trauma * this.settings.shake); }
  hold(tier) { if (!this.reduced && tier.hold) this.sinks.world.hold(tier.hold); }
  floater(at, kind, text) { if (this.settings.numbers && at) this.sinks.hud.floater(at, kind, text); }
  // Large beats never overlap: each gets 1.5 s before the next one starts.
  beat(name, fn) {
    if (this.beats.length >= 8) return;
    this.beats.push([name, fn]);
    this.pumpBeats();
  }
  pumpBeats() {
    if (this.beatTimer != null || !this.beats.length) return;
    const wait = this.beatReadyAt - this.clock();
    if (wait > 0) {
      this.beatTimer = this.timers.setTimeout(() => { this.beatTimer = null; this.pumpBeats(); }, wait);
      return;
    }
    const [name, fn] = this.beats.shift();
    this.note(name);
    this.beatReadyAt = this.clock() + FEEL.large.cooldown;
    fn();
    if (this.beats.length) this.pumpBeats();
  }
  // Called before the world rebuilds, so a floor change happens under the veil.
  beforeWorld(prev, next) {
    if (!prev || !next || prev.gameID !== next.gameID || prev.level === next.level || next.over) return null;
    const now = this.clock(), quick = now - this.lastTransition < 1500;
    this.lastTransition = now;
    return quick ? "quick" : "veil";
  }
  setEngaged(uid, now) {
    if (uid == null) { if (this.engaged) { this.engaged = null; this.sinks.hud.engaged(null); } return; }
    const changed = this.engaged?.uid !== uid;
    this.engaged = { uid, until: now + 5000 };
    if (changed) this.sinks.hud.engaged(uid);
  }
  /**
   * One authoritative update, in three steps: begin() before anything renders,
   * applyEvents() before the world syncs (a slain creature must be marked before
   * its actor is removed), and applyDiff() after the world has the new floor.
   */
  onUpdate(prev, next) {
    this.begin(prev, next);
    this.applyEvents(prev, next);
    this.applyDiff(prev, next);
  }
  begin(prev, next) {
    if (!next) return null;
    // Room catch-up applies many actions in one task; only the final state counts.
    this.burst++;
    if (!this.burstReset) { this.burstReset = true; queueMicrotask(() => { this.burst = 0; this.burstReset = false; }); }
    this.catchUp = this.burst > 3;
    if (this.catchUp) { this.catchUps++; this.queue.length = 0; }
    return this.catchUp ? null : this.beforeWorld(prev, next);
  }
  applyEvents(prev, next) {
    if (!next) return;
    const now = this.clock(), events = this.queue.splice(0);
    if (this.catchUp || next.over) return;
    const hero = { x: next.x, y: next.y };
    // A monster's reply lands after the hero's own swing has connected.
    const swung = events.some(([kind]) => kind === "damage" || kind === "miss");
    for (const [kind, detail] of events) {
      if (kind === "hurt" && swung && !this.reduced) this.later(230, () => this.event(kind, detail, next, hero, this.clock()));
      else this.event(kind, detail, next, hero, now);
    }
  }
  applyDiff(prev, next) {
    if (!next) return;
    const now = this.clock(), d = diffSnapshot(prev, next), hero = { x: next.x, y: next.y };
    if (d?.sameRun && !this.catchUp) this.diffBeats(d, prev, next, hero);
    if (this.engaged && (this.engaged.until < now || !tileOf(next, this.engaged.uid))) this.setEngaged(null, now);
    const ratio = next.hpMax > 0 ? next.hp / next.hpMax : 1;
    const low = next.over || next.hp <= 0 ? 0 : ratio <= .15 ? 2 : ratio <= .3 ? 1 : 0;
    if (low !== this.lowHp) {
      this.lowHp = low;
      this.sinks.hud.lowHp(low);
      this.sinks.audio.heartbeat(low === 2 ? 100 : low === 1 ? 70 : 0);
    }
    this.under = next.tiles.find((tile) => tile.x === next.x && tile.y === next.y)?.id ?? null;
    if (d?.over) this.ending();
  }
  event(kind, detail, next, hero, now) {
    const { hud, world, audio } = this.sinks;
    if (detail.level != null && detail.level !== next.level) return;
    if (kind === "damage") {
      const big = detail.maxHp ? detail.amount >= detail.maxHp * .3 : detail.amount >= 6;
      const tier = detail.killed ? FEEL.medium : big ? FEEL.medium : FEEL.small;
      world.hitMonster(detail.uid, { at: detail.to, from: hero, killed: detail.killed, flash: this.settings.flashes ? 1 : .35, reduced: this.reduced });
      this.floater(detail.to, detail.killed ? "kill" : "dealt", String(detail.amount));
      this.shake(tier); this.hold(tier);
      if (detail.killed) {
        audio.play("kill", { size: Math.min(1, (detail.maxHp || 4) / 60) });
        if (detail.xp > 0) this.later(220, () => this.floater({ x: hero.x, y: hero.y }, "xp", `+${detail.xp} XP`));
        this.setEngaged(null, now);
      } else this.setEngaged(detail.uid, now);
      this.note(detail.killed ? "kill" : "hit");
    } else if (kind === "hurt") {
      if (detail.uid != null) world.lungeMonster(detail.uid, hero);
      if (detail.amount > 0) {
        const severity = next.hpMax ? detail.amount / next.hpMax : .1;
        const tier = severity >= .2 ? FEEL.heavy : FEEL.small;
        world.heroHurt(detail.from || null, this.settings.flashes ? 1 : .35);
        hud.hurt(Math.min(1, .25 + severity * 3));
        this.floater(hero, "taken", `−${detail.amount}`);
        this.shake(tier); this.hold(tier);
        this.note("hurt");
      } else if (detail.missed) { this.floater(hero, "miss", "miss"); audio.play("whiff"); }
      if (detail.uid != null) this.setEngaged(detail.uid, now);
    } else if (kind === "miss") {
      this.floater(detail.to, "miss", "miss");
      audio.play("whiff", { pan: detail.pan });
      const target = detail.to && next.tiles.find((tile) => tile.x === detail.to.x && tile.y === detail.to.y)?.monster;
      if (target?.uid != null) this.setEngaged(target.uid, now);
    } else if (kind === "impact") {
      this.shake(FEEL.small);
    } else if (kind === "loot") {
      if (detail.item) hud.flyer(detail.item, hero);
    }
  }
  diffBeats(d, prev, next, hero) {
    const { hud, world, audio } = this.sinks;
    if (d.hpGained > 0 && d.rankDelta <= 0 && !d.depth) this.floater(hero, "heal", `+${d.hpGained}`);
    if (d.goldGained > 0) hud.gold(prev.gold, next.gold, hero);
    if (d.rankDelta > 0) {
      const deltas = [
        ...(d.hpMaxDelta > 0 ? [`+${d.hpMaxDelta} max HP`] : []),
        ...(d.manaMaxDelta > 0 ? [`+${d.manaMaxDelta} spells`] : []),
        ...d.statDeltas.filter((s) => s.change > 0).map((s) => `+${s.change} ${s.stat}`),
      ];
      const info = { rank: next.rank, title: next.title, deltas };
      this.later(this.history.at(-1) === "kill" ? 300 : 0, () => this.beat("levelup", () => {
        world.levelUp(); hud.levelUp(info); audio.play("levelup");
      }));
    } else if (d.rankDelta < 0) this.beat("leveldown", () => hud.levelDown({ rank: next.rank, title: next.title }));
    if (d.depth) {
      const cause = transitionCause(this.under, next.log || []);
      hud.depthCard({ ...depthLabel(next.level), cause, first: d.newDeepest, level: next.level });
      if (!this.reduced) world.arrive(d.depth.to > d.depth.from ? "down" : "up");
      audio.play("arrive", { depth: next.level, first: d.newDeepest });
      this.note("arrive");
    }
    if (d.eyeGained) this.beat("eye", () => hud.notice({ icon: "eye", title: "The Eye of Larn", line: "Hidden things are revealed to you." }));
    if (d.cureGained) this.beat("cure", () => { hud.notice({ icon: "potion", title: "The cure", line: "Carry it home before time runs out." }); audio.play("cure"); });
  }
  ending() {
    this.queue.length = 0; this.beats.length = 0;
    this.setEngaged(null, this.clock());
    if (this.lowHp) { this.lowHp = 0; this.sinks.hud.lowHp(0); }
    this.sinks.audio.heartbeat(0);
  }
  reset() {
    this.queue.length = 0; this.beats.length = 0;
    if (this.beatTimer != null) this.timers.clearTimeout(this.beatTimer);
    this.beatTimer = null;
    for (const id of this.timeouts) this.timers.clearTimeout(id);
    this.timeouts.clear();
    this.setEngaged(null, this.clock());
  }
  metrics() {
    return { beats: [...this.history], engaged: this.engaged?.uid ?? null, queued: this.queue.length,
      pendingBeats: this.beats.length, lowHp: this.lowHp, catchUps: this.catchUps, settings: { ...this.settings }, reduced: this.reduced };
  }
}
