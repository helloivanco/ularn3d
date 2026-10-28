import { SCORE, STINGERS, audioSettings, musicRegion } from "./audio-score.js";

const WEAPONS = {
  unarmed: [90, 45, "sine", 0.11, 0.7],
  axe: [170, 45, "sawtooth", 0.27, 0.8],
  spear: [950, 190, "triangle", 0.16, 0.22],
  lance: [640, 95, "triangle", 0.24, 0.4],
  dagger: [1650, 600, "triangle", 0.1, 0.25],
  flail: [380, 65, "square", 0.3, 0.65],
  hammer: [110, 30, "sine", 0.34, 0.85],
  staff: [280, 95, "triangle", 0.19, 0.55],
  sword: [1200, 240, "triangle", 0.22, 0.48],
  blunt: [190, 55, "sine", 0.2, 0.72],
  // Per-weapon overrides so each blade and haft sounds distinct in combat.
  26: [1320, 280, "triangle", 0.2, 0.42], // sword of slashing
  27: [95, 28, "sine", 0.38, 0.9], // Bessman's flailing hammer
  28: [1480, 320, "sawtooth", 0.18, 0.35], // sunsword
  29: [880, 160, "triangle", 0.28, 0.55], // two-handed sword
  30: [1020, 210, "triangle", 0.15, 0.2], // spear
  31: [1780, 720, "triangle", 0.09, 0.22], // dagger
  40: [210, 70, "square", 0.16, 0.5], // belt of striking
  57: [155, 40, "sawtooth", 0.3, 0.85], // battle axe
  58: [1100, 220, "triangle", 0.21, 0.45], // longsword
  59: [340, 55, "square", 0.32, 0.7], // flail
  65: [520, 80, "triangle", 0.26, 0.38], // lance of death
  89: [260, 90, "sine", 0.22, 0.5], // staff of power
  90: [1400, 360, "sawtooth", 0.17, 0.4], // vorpal blade
  91: [760, 120, "sawtooth", 0.25, 0.6], // slayer
};

export function weaponProfile(weapon) {
  if (weapon == null) return WEAPONS.unarmed;
  if (typeof weapon === "string") return WEAPONS[weapon] || WEAPONS.unarmed;
  if (weapon.id != null && WEAPONS[weapon.id]) return WEAPONS[weapon.id];
  return WEAPONS[weapon.type] || WEAPONS.unarmed;
}

export function weaponSoundKeys() {
  return Object.keys(WEAPONS);
}

export function spellProfile(spell = {}) {
  const id = Number(spell.id) || 0, name = String(spell.name || spell.code || "magic").toLowerCase();
  const family = /fire|flame/.test(name) ? "fire" : /lightning|bolt/.test(name) ? "electric" :
    /cold|ice/.test(name) ? "ice" : /heal|cure/.test(name) ? "heal" : /death|drain|annihil/.test(name) ? "dark" : "arcane";
  return { family, type: { fire: "triangle", electric: "triangle", ice: "sine", heal: "sine", dark: "triangle", arcane: "sine" }[family],
    frequency: { fire: 130, electric: 330, ice: 720, heal: 330, dark: 65, arcane: 220 }[family] * 2 ** ((id % 24) / 24),
    endRatio: 1.12 + id * .017, duration: .32 + (id % 7) * .04,
    pulses: 2 + id % 3, interval: .065 + id % 5 * .018 };
}

const FILES = {
  step: "/audio/step.mp3",
  swing: "/audio/swing.mp3",
  hit: "/audio/hit.mp3",
  door: "/audio/door.mp3",
  stairs: "/audio/stairs.mp3",
  spell: "/audio/spell.mp3",
};

export const FOOTSTEP_PROFILES = Object.freeze({
  grass:{frequency:620,end:280,duration:.07,noise:.022,weight:.008},
  stone:{frequency:1050,end:420,duration:.075,noise:.03,weight:.012},
  ash:{frequency:760,end:310,duration:.075,noise:.023,weight:.009},
});

const rateForWeapon = (weapon) => {
  const [frequency] = weaponProfile(weapon);
  return Math.min(1.32, Math.max(0.7, frequency / 980));
};

const rateForSpell = (spell) => {
  const profile = spellProfile(spell);
  return Math.min(1.35, Math.max(0.78, profile.frequency / 520));
};

// Game-feel cues. Decorative ones yield to a busy mix; ambient ones (the
// heartbeat loop, pointer ticks) stay out of the accepted-effect history.
const CUES = new Set(["kill", "spellImpact", "levelup", "arrive", "cure", "feat", "heartbeat", "hover", "confirm", "whiff", "fountain", "altar", "throne"]);
// Ambient cues never become the "last effect": a feat chime or the heartbeat
// arriving later must not mask the action sound that actually just played.
const DECORATIVE = new Set(["heartbeat", "hover", "whiff"]), AMBIENT = new Set(["heartbeat", "hover", "feat"]);
const STINGER_DUCKS = { levelup: [.35, 1400], feat: [.6, 800], arrive: [.5, 900], cure: [.4, 1400] };
// Orchestral stingers hold the score down for their full phrase.
const ORCHESTRAL_DUCKS = { levelup: [.32, 2600], descend: [.38, 3200], cure: [.28, 4200] };
// The masters sit at -18 LUFS; this trim keeps in-game music at the quiet
// level the earlier -20.3 LUFS beds played at with a 0.08 trim.
const MUSIC_TRIM = .061;
// Stingers sit 6 dB above the bed so a level-up or a new depth reads over the
// ducked score, still on the music slider.
const STINGER_TRIM = MUSIC_TRIM * 2;
const noteHz = (note) => 440 * 2 ** ((note - 69) / 12);
const bounded = (value, fallback, low, high) => { const n = Number(value ?? fallback); return Math.max(low, Math.min(high, Number.isFinite(n) ? n : fallback)); };
const ramp = (value, low, high) => { const t = Math.max(0, Math.min(1, (value - low) / (high - low))); return t * t * (3 - 2 * t); };
// Spell shimmer pitches: E-minor pentatonic, so casts ring with the score.
const PENTATONIC = [76, 79, 81, 83, 86];

// Music is pre-rendered; gameplay only moves gain envelopes and short FX voices.
export class GameAudio {
  constructor(options = {}) {
    this.context = options.context || null; this.contextFactory = options.contextFactory || (() => new (window.AudioContext || window.webkitAudioContext)());
    this.settings = audioSettings(options); this.onChange = options.onChange || (() => {});
    this.voices = new Set(); this.maxVoices = 24; this.musicSources = new Set();
    this.cache = new Map(); this.epoch = 0; this.musicEpoch = 0; this.randomState = 0x83bd23;
    this.region = "title"; this.threat = 0; this.impactThreat = 0; this.menu = false;
    this.paused = false; this.unlocked = false; this.status = "idle"; this.error = "";
    this.sampleCache = new Map();
    this.history = []; this.effectsCount = 0; this.notesPlayed = 0;
    this.stepIndex=0; this.ducks = []; this.heartbeat = 0; this.heartbeatRate = 0;
  }
  random() { this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0; return this.randomState / 4294967296; }
  prepare() {
    if (!this.context || this.context.state === "closed") {
      if (this.context) this.context.onstatechange = null;
      this.stopMusic();
      for (const source of [...this.voices]) source.onended?.();
      this.context = this.contextFactory(); this.graph = null; this.noise = null;
      this.lastFootstepAt = -Infinity; this.lastHoverAt = -Infinity;
    }
    const ctx = this.context;
    if (!this.graph) {
      this.master = ctx.createGain(); this.master.gain.value = .8;
      this.musicGain = ctx.createGain(); this.effectsGain = ctx.createGain(); this.duckGain = ctx.createGain();
      this.musicGain.gain.value = this.settings.music * MUSIC_TRIM; this.effectsGain.gain.value = this.settings.effects;
      // Stingers follow the music volume but bypass the duck and the muffle they cause.
      this.stingerGain = ctx.createGain(); this.stingerGain.gain.value = this.settings.music * STINGER_TRIM;
      this.compressor = ctx.createDynamicsCompressor();
      Object.assign(this.compressor.threshold, { value: -12 }); this.compressor.knee.value = 18;
      this.compressor.ratio.value = 6; this.compressor.attack.value = .006; this.compressor.release.value = .2;
      // Low-health muffle between the music volume and the duck stage; open by default.
      this.musicFilter = ctx.createBiquadFilter(); this.musicFilter.type = "lowpass"; this.musicFilter.Q.value = 0;
      this.clearHz = Math.min(20000, ctx.sampleRate / 2); this.musicFilter.frequency.value = this.clearHz;
      this.ducks = []; this.heartbeat = 0;
      this.musicGain.connect(this.musicFilter); this.musicFilter.connect(this.duckGain); this.duckGain.connect(this.master); this.effectsGain.connect(this.master);
      this.stingerGain.connect(this.master);
      this.master.connect(this.compressor); this.compressor.connect(ctx.destination);
      this.reverb = ctx.createConvolver(); this.wet = ctx.createGain(); this.wet.gain.value = .12;
      const impulse = ctx.createBuffer(2, Math.floor(ctx.sampleRate * .8), ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const data = impulse.getChannelData(c);
        for (let i = 0; i < data.length; i++) data[i] = (this.random() * 2 - 1) * Math.exp(-i / ctx.sampleRate * 8);
      }
      this.reverb.buffer = impulse; this.reverb.connect(this.wet); this.wet.connect(this.effectsGain);
      this.graph = true;
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noise.getChannelData(0); let low = 0;
      for (let i = 0; i < data.length; i++) { low = low * .7 + (this.random() * 2 - 1) * .3; data[i] = low * 2; }
      ctx.onstatechange = () => { if (ctx.state !== "running" && !this.paused && this.unlocked) this.status = "blocked"; this.syncHeartbeat(); this.notify(); };
    }
    return ctx;
  }
  notify() { this.onChange(this.metrics()); }
  async unlock() {
    if (!this.settings.enabled || this.paused) return false;
    try {
      const ctx = this.prepare(); this.unlocked = true;
      if (ctx.state !== "running") await ctx.resume();
      if (ctx.state !== "running" || this.paused || !this.settings.enabled) return false;
      if (!this.musicLoadError) { this.error = ""; this.status = this.loadingRegion ? "loading" : this.activeTrack ? "playing" : "ready"; }
      this.syncHeartbeat(); this.notify(); if (!this.musicLoadError) this.startMusic(); return true;
    } catch {
      this.status = "blocked"; this.error = "Sound could not start. Tap Sound to try again."; this.notify(); return false;
    }
  }
  configure(settings) {
    const previous = this.settings; this.settings = audioSettings({ ...previous, ...settings });
    if (this.context && this.graph) {
      const now = this.context.currentTime;
      this.musicGain.gain.setTargetAtTime(this.settings.music * MUSIC_TRIM, now, .05);
      this.stingerGain.gain.setTargetAtTime(this.settings.music * STINGER_TRIM, now, .05);
      this.effectsGain.gain.setTargetAtTime(this.settings.effects, now, .03);
    }
    if (!this.settings.enabled) { this.error = ""; this.suspend(); }
    else if (!previous.enabled) { this.paused = false; this.unlock(); }
    if (this.settings.music === 0) this.stopMusic();
    else if (previous.music === 0 && this.settings.enabled) this.startMusic();
    this.notify();
  }
  scene(region, threat = 0) {
    const next = SCORE[region] ? region : "title";
    if (next !== this.region) { this.region = next; this.loadingRegion = null; this.musicLoadError = false; this.error = ""; this.musicEpoch++; this.offset = 0; this.startMusic(); }
    this.threat = Math.max(0, Math.min(1, threat)); this.updateTension();
  }
  setMenu(menu) { if (this.menu === !!menu) return; this.menu = !!menu; this.updateTension(); this.updateDuck(); this.syncHeartbeat(); }
  async load(name) {
    if (!this.cache.has(name)) this.cache.set(name, (async () => {
      const response = await fetch(`/audio/${name}.flac`);
      if (!response.ok) throw new Error("Music unavailable");
      return this.prepare().decodeAudioData(await response.arrayBuffer());
    })().catch((error) => { this.cache.delete(name); throw error; }));
    return this.cache.get(name);
  }
  // One sprite holds every orchestral stinger. It loads after the first
  // region plays; until then (or if it fails) the synthesized cues stand in.
  loadStingers() {
    this.stingerLoad ??= (async () => {
      const response = await fetch("/audio/stingers.flac");
      if (!response.ok) throw new Error("Stingers unavailable");
      this.stingers = await this.prepare().decodeAudioData(await response.arrayBuffer());
    })().catch(() => { this.stingerLoad = null; });
    return this.stingerLoad;
  }
  // A newer stinger takes over: the one still sounding fades within ~0.3 s.
  stinger(name) {
    const slot = STINGERS[name];
    if (!slot || !this.stingers || !this.graph || this.settings.music === 0 || this.voices.size >= this.maxVoices) return false;
    const ctx = this.context, now = ctx.currentTime, source = ctx.createBufferSource(), gain = ctx.createGain(), entry = { source, gain };
    if (this.activeStinger) { this.activeStinger.gain.gain.setTargetAtTime(0, now, .08); try { this.activeStinger.source.stop(now + .4); } catch {} }
    source.buffer = this.stingers; source.connect(gain); gain.connect(this.stingerGain);
    this.voices.add(source); this.lastStinger = name; this.activeStinger = entry;
    source.onended = () => { source.disconnect(); gain.disconnect(); this.voices.delete(source); source.onended = null; if (this.activeStinger === entry) this.activeStinger = null; };
    source.start(now, slot[0], slot[1]);
    return true;
  }
  async startMusic() {
    if (this.deferMusic || this.ended || !this.unlocked || this.paused || !this.settings.enabled || this.settings.music === 0 || this.context?.state !== "running") return;
    const region = this.region, file = SCORE[region].bed;
    if (this.activeTrack?.region === region || this.loadingRegion === region) return;
    const epoch = ++this.musicEpoch; this.loadingRegion = region; this.status = "loading"; this.notify();
    try {
      const [bed, stem] = await Promise.all([this.load(file), this.load(`${file}-tension`)]);
      if (epoch !== this.musicEpoch || this.paused || !this.settings.enabled || this.settings.music === 0) return;
      this.loadingRegion = null;
      const ctx = this.context, now = ctx.currentTime, offset = (this.offset || 0) % bed.duration;
      // Bound rapid stair transitions to the outgoing and incoming pair.
      for (const node of [...this.musicSources]) if (node !== this.activeTrack?.bed && node !== this.activeTrack?.stem) node.cleanup();
      if (this.activeTrack) for (const node of [this.activeTrack.bed, this.activeTrack.stem]) {
        node.gain.gain.cancelScheduledValues(now); node.gain.gain.setTargetAtTime(0, now, .35); node.source.stop(now + 1.8);
      }
      const create = (buffer, kind) => {
        const source = ctx.createBufferSource(), gain = ctx.createGain(), parts = []; source.buffer = buffer; source.loop = true;
        gain.connect(this.musicGain); gain.gain.value = 0;
        const node = { source, gain, kind, region, cleanup: () => { try { source.stop(); } catch {} source.onended = null; source.disconnect(); for (const part of parts) part.disconnect(); gain.disconnect(); this.musicSources.delete(node); } };
        if (kind === "tension") {
          // Both intensity layers ride one source: channel 0 "stir", channel 1 "fray".
          const split = ctx.createChannelSplitter(2); node.layers = [ctx.createGain(), ctx.createGain()];
          source.connect(split); parts.push(split, ...node.layers);
          node.layers.forEach((layer, channel) => { layer.gain.value = 0; split.connect(layer, channel); layer.connect(gain); });
        } else source.connect(gain);
        source.onended = node.cleanup; this.musicSources.add(node); source.start(now, offset % buffer.duration); return node;
      };
      this.activeTrack = { region, bed: create(bed, "bed"), stem: create(stem, "tension"), startedAt: now, offset, duration: bed.duration, layers: [0, 0] };
      for (const node of [this.activeTrack.bed, this.activeTrack.stem]) node.gain.gain.setTargetAtTime(1, now, .45);
      this.updateTension();
      this.status = "playing"; this.error = ""; this.notify();
      for (const key of this.cache.keys()) if (key !== file && key !== `${file}-tension`) this.cache.delete(key);
      this.loadStingers();
    } catch {
      if (epoch !== this.musicEpoch) return;
      this.loadingRegion = null; this.musicLoadError = true; this.status = "error"; this.error = "Music could not load. Effects remain available; tap Sound to retry."; this.notify();
    }
  }
  stopMusic() {
    this.musicEpoch++; this.loadingRegion = null;
    if (this.activeTrack && this.context) this.offset = (this.activeTrack.offset + this.context.currentTime - this.activeTrack.startedAt) % this.activeTrack.duration;
    for (const node of [...this.musicSources]) node.cleanup(); this.activeTrack = null;
  }
  finish(kind) {
    this.ended = true; this.epoch++; this.heartbeatRate = 0; this.syncHeartbeat(); this.stopMusic();
    for (const source of [...this.voices]) { try { source.stop(); } catch {} source.onended?.(); }
    this.play(kind);
  }
  // Vertical intensity: "stir" (pulse) answers one nearby creature, "fray"
  // (brass, timpani, tremolo) joins as danger grows or blows are traded.
  updateTension() {
    if (!this.activeTrack || !this.context) return;
    const value = Math.max(this.threat, this.impactThreat) * (this.menu ? .5 : 1);
    if (this.activeTrack.tension === value) return;
    this.activeTrack.tension = value; this.activeTrack.layers = [ramp(value, .05, .45), ramp(value, .4, .95)];
    this.activeTrack.stem.layers?.forEach((layer, i) => layer.gain.setTargetAtTime(this.activeTrack.layers[i], this.context.currentTime, .45));
  }
  combat() {
    this.impactThreat = .85; this.updateTension(); clearTimeout(this.tensionTimer);
    this.tensionTimer = setTimeout(() => { this.impactThreat = 0; this.updateTension(); }, 4000);
  }
  // Music dips compose: the deepest held dip wins, never louder than the menu
  // level, and each release steps back up to whatever is still held.
  duckLevel(t = this.context?.currentTime ?? 0) { return Math.min(this.menu ? .55 : 1, ...this.ducks.filter((dip) => dip.until > t).map((dip) => dip.level)); }
  updateDuck(attack = .12) {
    if (!this.context || !this.graph) return;
    const now = this.context.currentTime, gain = this.duckGain.gain;
    this.ducks = this.ducks.filter((dip) => dip.until > now);
    gain.cancelScheduledValues(now); gain.setTargetAtTime(this.duckLevel(now), now, attack);
    for (const dip of [...this.ducks].sort((a, b) => a.until - b.until)) gain.setTargetAtTime(this.duckLevel(dip.until), dip.until, dip.release);
  }
  duckFor(level = .5, holdMs = 600, attack = .05, release = .3) {
    if (!this.context || !this.graph) return;
    this.ducks.push({ level: bounded(level, .5, 0, 1), until: this.context.currentTime + bounded(holdMs, 600, 0, 10000) / 1000, release });
    this.updateDuck(attack);
  }
  duck() { this.duckFor(.45, 300, .025, .18); }
  // rate: beats per minute, 0 = off. The loop and the music muffle pause while
  // menus are open, sound is suspended or disabled, or the expedition ended.
  setHeartbeat(rate = 0) { this.heartbeatRate = bounded(rate, 0, 0, 180); this.syncHeartbeat(); }
  syncHeartbeat() {
    const rate = this.heartbeatRate && this.settings.enabled && !this.paused && !this.menu && !this.ended && this.graph && this.context?.state === "running" ? this.heartbeatRate : 0;
    if (rate !== this.heartbeat && this.graph) this.musicFilter.frequency.setTargetAtTime(rate ? 2400 * .375 ** Math.min(1, Math.max(0, (rate - 70) / 30)) : this.clearHz, this.context.currentTime, .35);
    this.heartbeat = rate;
    if (!rate) { clearTimeout(this.heartbeatTimer); this.heartbeatTimer = null; }
    else if (!this.heartbeatTimer) this.beat();
  }
  beat() {
    this.heartbeatTimer = this.heartbeat ? setTimeout(() => this.beat(), 60000 / this.heartbeat) : null;
    if (this.heartbeat) this.play("heartbeat");
  }
  voice({ frequency = 200, end = 100, duration = .2, delay = 0, type = "sine", volume = .1, noise = false, pan = 0, resonance = 1, wet = true, attack = .006 }) {
    if (this.voices.size >= this.maxVoices) return;
    const ctx = this.prepare(), start = ctx.currentTime + delay;
    const source = noise ? ctx.createBufferSource() : ctx.createOscillator(), gain = ctx.createGain();
    const filter = ctx.createBiquadFilter(); filter.type = noise ? "bandpass" : "lowpass"; filter.Q.value = resonance;
    if (noise) { source.buffer = this.noise; source.loop = true; filter.frequency.setValueAtTime(frequency, start); filter.frequency.exponentialRampToValueAtTime(Math.max(30, end), start + duration); }
    else { source.type = type; source.frequency.setValueAtTime(frequency, start); source.frequency.exponentialRampToValueAtTime(Math.max(25, end), start + duration); filter.frequency.value = Math.min(8000, frequency * 5); }
    const panner = ctx.createStereoPanner?.(); if (panner) panner.pan.value = Math.max(-.7, Math.min(.7, pan));
    source.connect(filter); filter.connect(gain); gain.connect(panner || this.effectsGain);
    if (panner) panner.connect(this.effectsGain); if (wet) gain.connect(this.reverb);
    gain.gain.setValueAtTime(.0001, start); gain.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), start + attack);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    this.voices.add(source); this.notesPlayed++;
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); panner?.disconnect(); this.voices.delete(source); source.onended = null; };
    if (noise) source.start(start, this.random() * .7); else source.start(start);
    source.stop(start + duration + .02);
  }
  get bed() { return this.activeTrack ? {...this.activeTrack,kind:this.activeTrack.region === "caves" ? "cave" : this.activeTrack.region} : null; }
  get music() { return this.bed; }
  get enabled() { return this.settings.enabled; }
  prefetch() { /* Assets load after the first playback gesture. */ }
  syncBed(level) { this.scene(musicRegion(level), this.threat); }
  enable(level = 0) { this.configure({ enabled: true }); this.syncBed(level); return this.resume(); }
  hold() { return this.suspend(); }
  async sampleEffect(kind, { rate = 1, delay = 0, volume = .1 } = {}) {
    if (!FILES[kind] || this.paused || !this.unlocked) return;
    const epoch = this.epoch;
    try {
      if (!this.sampleCache.has(kind)) this.sampleCache.set(kind, (async () => {
        const response = await fetch(FILES[kind]);
        if (!response.ok) throw new Error("Effect unavailable");
        return this.prepare().decodeAudioData(await response.arrayBuffer());
      })().catch(error => { this.sampleCache.delete(kind); throw error; }));
      const buffer = await this.sampleCache.get(kind);
      if (epoch !== this.epoch || this.paused || !this.settings.enabled || this.voices.size >= this.maxVoices) return;
      const ctx = this.context, source = ctx.createBufferSource(), gain = ctx.createGain();
      source.buffer = buffer; source.playbackRate.value = rate;
      gain.gain.value = volume; source.connect(gain); gain.connect(this.effectsGain);
      this.voices.add(source);
      source.onended = () => { source.disconnect(); gain.disconnect(); this.voices.delete(source); source.onended = null; };
      source.start(ctx.currentTime + delay);
    } catch { /* Other effects and the score continue if one sample is unavailable. */ }
  }
  play(kind, detail = {}) {
    if (!this.settings.enabled || this.paused || globalThis.document?.hidden || this.settings.effects === 0) return;
    // Already-unlocked actions play before expensive turn/render work. Only a
    // context that needs unlocking may defer (and expire) an old action cue.
    if (this.context?.state === "running" && this.graph) { this.renderFX(kind, detail); return; }
    if (AMBIENT.has(kind)) return; // Pointer ticks and heartbeats never unlock or replay late.
    const epoch = this.epoch, timestamp = performance.now();
    this.unlock().then((ready) => {
      if (ready && epoch === this.epoch && performance.now() - timestamp < 350 && !this.paused) this.renderFX(kind, detail);
    });
  }
  renderFX(kind, detail = {}) {
    if (kind === "step") {
      if (this.menu || this.ended) return;
      const now=this.prepare().currentTime;
      if (now-(this.lastFootstepAt ?? -Infinity)<.085) return;
      this.lastFootstepAt=now;
    }
    // A busy mix drops decorative cues first; the hard 24-voice bound still applies to all.
    if ((DECORATIVE.has(kind) && this.voices.size > 16) || (kind === "heartbeat" && (this.menu || this.ended))) return;
    if (kind === "hover") {
      const now = this.prepare().currentTime;
      if (this.voices.size > 12 || now - (this.lastHoverAt ?? -Infinity) < .06) return;
      this.lastHoverAt = now;
    }
    this.prepare(); if (!AMBIENT.has(kind)) { this.effectsCount++; this.history.push(kind); if (this.history.length > 24) this.history.shift(); }
    const pan = Number(detail.pan) || 0;
    if (kind === "weapon") {
      const [pitch, end, type, duration, weight] = weaponProfile(detail.weapon);
      this.sampleEffect("swing", { rate: rateForWeapon(detail.weapon), volume: .13 });
      if (detail.hit) this.sampleEffect("hit", { rate: rateForWeapon(detail.weapon), delay: .105, volume: .15 });
      const blade = ["sword", "dagger"].includes(detail.weapon?.type);
      this.voice({ frequency: 1800 + pitch, end: 300, noise: true, duration: duration * .65, delay: blade ? .025 : 0, volume: .13, pan });
      if (detail.hit) {
        // Match the visual contact at 105 ms; engine damage remains immediate.
        this.voice({ frequency: pitch * .7, end, type, duration, delay: .105, volume: .22 * weight, pan });
        this.voice({ frequency: 650, end: 180, noise: true, duration: .09, delay: .105, volume: .12, pan });
        if (["sword", "axe", "dagger", "flail"].includes(detail.weapon?.type)) this.voice({ frequency: pitch * 1.4, end: pitch, duration: .28, delay: .105, volume: .07, pan });
      }
      this.combat(); this.duck();
    } else if (kind === "spell") {
      // Same pulse timing as ever; each cast varies a little in pitch and
      // level, and gentler families ring a shimmer from the score's key.
      const p = spellProfile(detail.spell), tune = 1 + (this.random() * 2 - 1) * .03, level = 1 + (this.random() * 2 - 1) * .1;
      this.sampleEffect("spell", { rate: rateForSpell(detail.spell) * tune, volume: .055 * level });
      for (let i = 0; i < p.pulses; i++) this.voice({ frequency: p.frequency * 2 ** (i * 3 / 12) * tune, end: p.frequency * p.endRatio * tune, type: p.type, duration: p.duration, delay: i * p.interval, volume: .075 * level, pan });
      if (["fire", "electric", "dark"].includes(p.family)) this.voice({ frequency: (p.family === "electric" ? 3300 : 450) * tune, end: 90, duration: p.duration, noise: true, volume: .15 * level, resonance: .7, pan });
      else {
        this.voice({ frequency: p.frequency * 2.01 * tune, end: p.frequency * 2.01 * tune, duration: .6, delay: .08, volume: .035 * level, pan });
        this.voice({ frequency: noteHz(PENTATONIC[(Number(detail.spell?.id) || 0) % 5] + 12), duration: .9, delay: .05, volume: .014 * level, pan: -pan, attack: .004 });
      }
      this.combat(); this.duck();
    } else if (kind === "hurt") {
      this.voice({ frequency: 110, end: 45, duration: .18, volume: .2 });
      this.voice({ frequency: 700, end: 120, duration: .1, volume: .12, noise: true }); this.combat(); this.duck();
    } else if (kind === "step") {
      const surface=detail.surface || (this.region==="town"?"grass":this.region==="volcano"?"ash":"stone");
      const profile=FOOTSTEP_PROFILES[surface] || FOOTSTEP_PROFILES.stone;
      const variation=.88+this.random()*.16, pitch=.94+this.random()*.12;
      const side=detail.foot==="left"?-1:detail.foot==="right"?1:(++this.stepIndex%2?1:-1);
      // A short dry scuff and a soft sole: no duplicate recording or reverb
      // tail accumulating beneath a long walk. Variation uses private RNG.
      this.voice({frequency:profile.frequency*pitch,end:profile.end,noise:true,duration:profile.duration,
        volume:profile.noise*variation,resonance:.55,wet:false,pan:side*.025,attack:.012});
      this.voice({frequency:surface==="stone"?94:78,end:48,duration:.05,
        volume:profile.weight*variation,wet:false,pan:side*.025,attack:.009});
    } else if (kind === "door" || kind === "chest") {
      this.sampleEffect("door", { volume: .05 });
      this.voice({ frequency: 350, end: 100, noise: true, duration: .25, volume: .075 });
      this.voice({ frequency: 170, end: 55, type: "triangle", duration: .12, delay: .17, volume: .07 });
      if (detail.exploded) this.voice({ frequency: 800, end: 45, noise: true, duration: .5, volume: .25 });
    } else if (kind === "potion") {
      for (let i = 0; i < 3; i++) this.voice({ frequency: 260 + i * 90, end: 110, duration: .075, delay: i * .09, volume: .09 });
      this.voice({ frequency: 1800, end: 800, duration: .15, noise: true, volume: .04 });
    } else if (kind === "read" || kind === "loot") {
      this.voice({ frequency: kind === "read" ? 1500 : 650, end: 400, noise: true, duration: .13, volume: .045,wet:false });
      if (kind === "loot") this.voice({ frequency: 660, end: 600, duration: .13, volume: .02 });
    } else if (kind === "coins") {
      for (let i = 0; i < 3; i++) this.voice({ frequency: 1300 + i * 250, end: 1100 + i * 250, duration: .09, delay: i * .025, volume: .02,wet:false });
    } else if (kind === "stairs") {
      // Footfalls keep their timing; pitch and level vary per flight, and a
      // low draught of air follows the direction of travel.
      const tune = 1 + (this.random() * 2 - 1) * .04, level = 1 + (this.random() * 2 - 1) * .1;
      this.sampleEffect("stairs", { volume: .055 * level, rate: tune });
      this.voice({ frequency: 140 * tune, end: 65, noise: true, duration: .22, volume: .085 * level });
      this.voice({ frequency: (detail.down ? 220 : 165) * tune, end: (detail.down ? 110 : 330) * tune, duration: .45, delay: .1, volume: .028 * level });
      this.voice({ frequency: detail.down ? 900 : 260, end: detail.down ? 170 : 900, noise: true, duration: .42, delay: .06, volume: .022 * level, resonance: .8, attack: .12 });
    } else if (kind === "victory" || kind === "death") {
      this.stopMusic(); if (this.stinger(kind)) return;
      const notes = kind === "victory" ? [64, 67, 71, 76] : [52, 51, 47, 40];
      notes.forEach((note, i) => this.voice({ frequency: 440 * 2 ** ((note - 69) / 12), end: 440 * 2 ** ((note - 69) / 12), duration: 1.8, delay: i * .2, type: kind === "death" ? "triangle" : "sine", volume: .1 }));
    } else if (CUES.has(kind)) {
      // A first visit to a floor, a level-up and the cure get the orchestra
      // when it has loaded and music is on; otherwise the synthesized cue.
      const orchestral = kind === "arrive" ? (detail.first ? "descend" : null) : ORCHESTRAL_DUCKS[kind] ? kind : null;
      if (orchestral && this.stinger(orchestral)) this.duckFor(...ORCHESTRAL_DUCKS[orchestral]);
      else this.cue(kind, detail, pan);
    } else {
      this.voice({ frequency: 1200, end: 700, noise: true, duration: .045, volume: .045, wet: false });
      this.voice({ frequency: 330, end: 440, duration: .08, volume: .025, wet: false });
    }
  }
  // Shared E-minor intervals. One private ±3% pitch / ±10% level draw per cue
  // keeps chords in tune with themselves while repeats never sound identical.
  cue(kind, detail, pan) {
    const pitch = 1 + (this.random() * 2 - 1) * .03, level = 1 + (this.random() * 2 - 1) * .1;
    const delay = bounded(detail.delay, kind === "kill" ? .105 : 0, 0, 2);
    const at = (o) => this.voice({ pan, ...o, delay: delay + (o.delay || 0), frequency: o.frequency * pitch, end: (o.end ?? o.frequency) * pitch, volume: o.volume * level });
    if (kind === "kill") {
      // Bigger creatures land lower and longer; contact matches the 105 ms weapon strike.
      const size = bounded(detail.size, .3, 0, 1), drop = 1 - size * .45;
      at({ frequency: 130 * drop, end: 40 * drop, duration: .2 + size * .14, volume: .2, attack: .004 });
      at({ frequency: 1100 - size * 450, end: 180, noise: true, duration: .11, volume: .1, resonance: .8 });
      if (size > .4) at({ frequency: 240, end: 55, noise: true, duration: .32, delay: .04, volume: .07 * size, resonance: .6 });
      this.duck();
    } else if (kind === "spellImpact") {
      const family = String(detail.family || spellProfile(detail.spell || {}).family).toLowerCase();
      if (family === "fire") {
        at({ frequency: 1500, end: 260, noise: true, duration: .34, volume: .12, resonance: .7, attack: .02 });
        at({ frequency: 3400, end: 1900, noise: true, duration: .14, delay: .05, volume: .05, resonance: 2.5, wet: false });
        at({ frequency: noteHz(40), end: noteHz(35), type: "triangle", duration: .3, volume: .07 });
      } else if (family === "ice" || family === "cold") {
        [88, 91, 95].forEach((note, i) => at({ frequency: noteHz(note) * (1 + i * .004), duration: .55 + i * .08, delay: i * .028, volume: .032 }));
      } else if (family === "lightning" || family === "electric") {
        at({ frequency: 4200, end: 1100, noise: true, duration: .16, volume: .11, resonance: 3, wet: false });
        at({ frequency: 2600, end: 700, noise: true, duration: .1, delay: .055, volume: .075, resonance: 2.4 });
        at({ frequency: 110, end: 55, type: "square", duration: .14, volume: .028 });
      } else {
        // Ward, arcane, healing and dark impacts ring as a bell: fundamental, inharmonic partial, hum.
        const root = noteHz({ ward: 71, heal: 79, dark: 64 }[family] ?? 76);
        at({ frequency: root, duration: .95, volume: .05, attack: .004 });
        at({ frequency: root * 2.76, duration: .45, volume: .016 });
        at({ frequency: root / 2, duration: 1.05, volume: .024, attack: .02 });
      }
      this.duck();
    } else if (kind === "levelup") {
      [64, 67, 71, 76].forEach((note, i) => at({ frequency: noteHz(note), type: "triangle", duration: i === 3 ? 1.1 : .5, delay: i * .1, volume: .055 }));
      at({ frequency: 5200, end: 2600, noise: true, duration: 1.2, delay: .3, volume: .014, resonance: 4, attack: .3 });
    } else if (kind === "arrive") {
      // Deeper floors settle up to five semitones lower.
      const shift = 2 ** (-bounded(detail.depth, 0, 0, 20) / 4 / 12);
      at({ frequency: noteHz(40) * shift, type: "triangle", duration: 1.7, volume: .07, attack: .5 });
      at({ frequency: noteHz(64) * shift, duration: .8, delay: .3, volume: .04 });
      at({ frequency: noteHz(59) * shift, duration: 1.1, delay: .62, volume: .036 });
    } else if (kind === "feat") {
      [79, 83, 88].forEach((note, i) => at({ frequency: noteHz(note), duration: i === 2 ? .9 : .4, delay: i * .07, volume: .04, attack: .003 }));
    } else if (kind === "heartbeat") {
      at({ frequency: 58, end: 40, type: "triangle", duration: .13, volume: .16, wet: false, attack: .008 });
      at({ frequency: 52, end: 38, type: "triangle", duration: .11, delay: .14, volume: .11, wet: false, attack: .008 });
    } else if (kind === "hover") {
      at({ frequency: 3200, end: 2200, noise: true, duration: .015, volume: .012, resonance: 1.4, wet: false, attack: .002 });
    } else if (kind === "confirm") {
      at({ frequency: noteHz(71), duration: .09, volume: .03, wet: false, attack: .004 });
      at({ frequency: noteHz(76), duration: .16, delay: .07, volume: .03, wet: false, attack: .004 });
    } else if (kind === "whiff") {
      at({ frequency: 2200, end: 650, noise: true, duration: .18, volume: .045, resonance: .6, wet: false, attack: .035 });
    } else if (kind === "cure") {
      // Fallback for the orchestral cure: the motif turned to E major, as bells.
      [64, 68, 71, 69, 68, 66, 76].forEach((note, i) => at({ frequency: noteHz(note + 12), duration: i === 6 ? 1.4 : .45, delay: i * .14, volume: .04, attack: .004 }));
    } else if (kind === "fountain") {
      // Water: a short pour and a few bubbles rising as they shrink.
      at({ frequency: 900, end: 2300, noise: true, duration: .42, volume: .032, resonance: 1.1, attack: .05 });
      for (let i = 0; i < 4; i++) { const f = 480 + this.random() * 420; at({ frequency: f, end: f * 1.9, duration: .07, delay: .05 + i * .08 + this.random() * .03, volume: .02, attack: .004 }); }
      if (detail.act === "wash") at({ frequency: 2600, end: 1100, noise: true, duration: .3, delay: .18, volume: .018, resonance: .9 });
    } else if (kind === "altar") {
      if (detail.act === "desecrate") {
        // Stone cracks and something answers from below, a tritone apart.
        at({ frequency: 420, end: 60, noise: true, duration: .5, volume: .07, resonance: .7 });
        at({ frequency: noteHz(40), end: noteHz(38), type: "triangle", duration: 1.1, delay: .05, volume: .05, attack: .08 });
        at({ frequency: noteHz(46), end: noteHz(45), type: "triangle", duration: .9, delay: .12, volume: .03, attack: .1 });
      } else {
        // A prayer: a soft open fifth and a high bell.
        [64, 71, 76].forEach((note, i) => at({ frequency: noteHz(note), duration: 1.5, delay: i * .07, volume: .02, attack: .3 }));
        at({ frequency: noteHz(88), duration: 1.2, delay: .12, volume: .016, attack: .003 });
        at({ frequency: noteHz(88) * 2.76, duration: .5, delay: .12, volume: .005, attack: .003 });
      }
    } else if (kind === "throne") {
      // Stone settling under weight, then a regal low fifth; gems glint.
      at({ frequency: 320, end: 110, noise: true, duration: .34, volume: .05, resonance: .8, wet: false });
      at({ frequency: noteHz(40), type: "sawtooth", duration: 1, delay: .12, volume: .022, attack: .18 });
      at({ frequency: noteHz(47), type: "sawtooth", duration: .95, delay: .16, volume: .016, attack: .2 });
      if (detail.act === "gems") for (let i = 0; i < 3; i++) at({ frequency: 1700 + i * 380, end: 1500 + i * 380, duration: .12, delay: .3 + i * .05, volume: .016, wet: false });
    }
    if (STINGER_DUCKS[kind]) this.duckFor(...STINGER_DUCKS[kind]);
  }
  async suspend() {
    this.paused = true; this.epoch++; clearTimeout(this.tensionTimer); this.impactThreat = 0;
    this.syncHeartbeat(); this.ducks = []; this.updateDuck();
    for (const source of [...this.voices]) { try { source.stop(); } catch {} source.onended?.(); }
    if (this.reverb && this.context?.state !== "closed") {
      const impulse = this.reverb.buffer; this.reverb.disconnect();
      this.reverb = this.context.createConvolver(); this.reverb.buffer = impulse; this.reverb.connect(this.wet);
    }
    this.stopMusic(); this.status = this.settings.enabled ? "suspended" : "muted"; this.notify();
    if (this.context && this.context.state !== "closed") try { await this.context.suspend(); } catch {}
  }
  resume() { this.paused = false; this.musicLoadError = false; this.error = ""; return this.unlock(); }
  metrics() {
    return { enabled: this.settings.enabled, musicVolume: this.settings.music, effectsVolume: this.settings.effects,
      contextState: this.context?.state || "not-started", status: this.status, error: this.error, track: SCORE[this.activeTrack?.region || this.region].title,
      playingRegion: this.activeTrack?.region || null,
      region: this.region, effectVoices: this.voices.size, maxVoices: this.maxVoices, musicSources: this.musicSources.size,
      cachedTracks: this.cache.size, threat: Math.max(this.threat, this.impactThreat), effectsPlayed: this.effectsCount, lastEffect: this.history.at(-1) || null,
      heartbeat: this.heartbeat, duck: this.duckLevel(), layers: this.activeTrack?.layers ?? [0, 0],
      stingersReady: !!this.stingers, lastStinger: this.lastStinger || null };
  }
  async dispose() {
    await this.suspend();
    if (this.context && this.context.state !== "closed") await this.context.close();
    this.cache.clear(); this.stingers = null; this.stingerLoad = null; this.context = null; this.graph = null;
  }
}
