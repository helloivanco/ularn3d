import { itemArtImage } from "./item-art.js";
import { iconMarkup } from "./icons.js";

/**
 * DOM half of the feedback director: damage numbers, the engaged nameplate,
 * screen-edge wounds, banners, cards, notices and pickup flyers. Everything is
 * pooled, animates on the compositor, and never wakes the WebGL loop by itself.
 */
const FLOATERS = 16, FLYERS = 6, NOTICES = 4;
const LIFE = { dealt: 900, kill: 1150, taken: 950, heal: 1000, xp: 1200, miss: 750 };
// Numbers rise from the body; the nameplate sits clear above the head.
const HEIGHT = { dealt: .85, kill: .95, taken: 1.35, heal: 1.35, xp: 1.75, miss: .85 };
const PLATE_HEIGHT = 2.45;
export const woundBand = (hp, hpMax) => {
  if (!(hpMax > 0)) return null;
  const ratio = Math.max(0, hp) / hpMax;
  return ratio >= .999 ? { pips: 4, label: "Unhurt" } : ratio > .55 ? { pips: 3, label: "Wounded" }
    : ratio > .25 ? { pips: 2, label: "Badly wounded" } : { pips: 1, label: "Near death" };
};

export class FeedbackHud {
  constructor({ root = document.body, world, getState, settings, reduced = false }) {
    this.world = world; this.getState = getState; this.settings = settings; this.reduced = reduced;
    this.vignette = root.querySelector("#hurt-vignette");
    this.veilEl = root.querySelector("#transition-veil");
    this.deathEl = root.querySelector("#death-veil");
    this.plate = root.querySelector("#nameplate");
    this.banner = root.querySelector("#feel-banner");
    this.card = root.querySelector("#depth-card");
    this.notices = root.querySelector("#notice-stack");
    const floaterRoot = root.querySelector("#floaters");
    this.floaters = Array.from({ length: FLOATERS }, () => {
      const el = document.createElement("div");
      el.className = "floater";
      el.hidden = true;
      const text = document.createElement("span");
      el.append(text);
      floaterRoot.append(el);
      return { el, text, x: 0, z: 0, h: 1, born: 0, live: false, animation: null };
    });
    this.flyers = Array.from({ length: FLYERS }, () => {
      const el = document.createElement("canvas");
      el.className = "loot-flyer";
      el.width = el.height = 56;
      el.hidden = true;
      floaterRoot.append(el);
      return { el, live: false };
    });
    this.point = { x: 0, y: 0, visible: true };
    this.seed = 0x2f6b;
    this.engagedUid = null;
    this.timers = { banner: null, card: null, veil: null };
    this.goldFrame = null;
    this.hook = () => this.follow();
    world?.frameHooks.add(this.hook);
  }
  setSettings(settings) { this.settings = settings; if (!settings.healthBars) this.engaged(null); }
  setReduced(reduced) { this.reduced = !!reduced; }
  random() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
  project(x, z, h) { return this.world ? this.world.projectInto(x, z, h, this.point) : null; }
  place(el, x, z, h, dx = 0, dy = 0) {
    const p = this.project(x, z, h);
    if (!p) return false;
    el.style.transform = `translate3d(${Math.round(p.x + dx)}px,${Math.round(p.y + dy)}px,0)`;
    el.style.visibility = p.visible ? "" : "hidden";
    return true;
  }
  // Called by the world once per rendered frame, after the camera moved.
  follow() {
    for (const f of this.floaters) if (f.live) this.place(f.el, f.x, f.z, f.h, f.dx, 0);
    if (this.engagedUid != null && !this.plate.hidden) this.placePlate();
  }
  floater(at, kind, text) {
    if (!at) return;
    const now = performance.now();
    let slot = this.floaters.find((f) => !f.live);
    if (!slot) slot = this.floaters.reduce((a, b) => (a.born < b.born ? a : b));
    slot.animation?.cancel();
    // Hits on one square fan out instead of stacking into an unreadable pile.
    const stacked = this.floaters.filter((f) => f.live && f !== slot && f.x === at.x && f.z === at.y && now - f.born < 500).length;
    Object.assign(slot, { x: at.x, z: at.y, h: (HEIGHT[kind] || 1.2) + stacked * .32, born: now, live: true,
      dx: this.reduced ? 0 : Math.round((this.random() - .5) * 28) });
    slot.text.textContent = text;
    slot.el.className = `floater floater-${kind}`;
    slot.el.hidden = false;
    this.place(slot.el, slot.x, slot.z, slot.h, slot.dx, 0);
    const life = LIFE[kind] || 900;
    const frames = this.reduced
      ? [{ opacity: 1 }, { opacity: 1, offset: .7 }, { opacity: 0 }]
      : [
          { opacity: 0, transform: "translate(-50%,-50%) translateY(6px) scale(.55)" },
          { opacity: 1, transform: "translate(-50%,-50%) translateY(-10px) scale(1.18)", offset: .14 },
          { opacity: 1, transform: "translate(-50%,-50%) translateY(-22px) scale(1)", offset: .32 },
          { opacity: 1, transform: "translate(-50%,-50%) translateY(-38px) scale(1)", offset: .72 },
          { opacity: 0, transform: "translate(-50%,-50%) translateY(-52px) scale(.96)" },
        ];
    slot.animation = slot.text.animate(frames, { duration: life, easing: "cubic-bezier(.2,.7,.2,1)", fill: "forwards" });
    slot.animation.onfinish = () => { slot.live = false; slot.el.hidden = true; slot.animation = null; };
  }
  hurt(severity) {
    const el = this.vignette;
    el.style.setProperty("--hurt", String(Math.max(.25, Math.min(1, severity)) * (this.settings.flashes ? 1 : .45)));
    el.getAnimations().forEach((a) => a.cancel());
    el.animate([{ opacity: 1 }, { opacity: 1, offset: .12 }, { opacity: 0 }],
      { duration: this.settings.flashes ? 650 : 1100, easing: "ease-out" });
    const meter = document.querySelector(".meter.health");
    if (meter && !this.reduced) {
      meter.getAnimations().forEach((a) => a.cancel());
      meter.animate([{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(3px)" },
        { transform: "translateX(-2px)" }, { transform: "translateX(0)" }], { duration: 260, easing: "ease-out" });
    }
  }
  lowHp(level) {
    document.body.classList.toggle("low-hp", level >= 1);
    document.body.classList.toggle("critical-hp", level >= 2);
  }
  engaged(uid) {
    this.engagedUid = this.settings.healthBars ? uid : null;
    if (this.engagedUid == null) { this.plate.hidden = true; return; }
    this.sync(this.getState());
  }
  // Keep the nameplate's name and wound band current with each update.
  sync(state) {
    if (this.engagedUid == null || !state) return;
    const tile = state.tiles.find((t) => t.monster?.uid === this.engagedUid);
    const monster = tile?.monster;
    if (!monster || !monster.known) { this.plate.hidden = true; return; }
    const band = woundBand(monster.hp, monster.hpMax);
    this.plate.querySelector(".nameplate-name").textContent = monster.name;
    this.plate.querySelector(".nameplate-band").dataset.pips = band ? String(band.pips) : "0";
    this.plate.querySelector(".nameplate-wound").textContent = band?.label || "";
    this.plate.hidden = false;
    this.placePlate();
  }
  placePlate() {
    const position = this.world?.actorPosition(this.engagedUid);
    if (!position) { this.plate.hidden = true; return; }
    this.place(this.plate, position.x, position.z, PLATE_HEIGHT);
  }
  show(el, ms, timer) {
    clearTimeout(this.timers[timer]);
    el.hidden = false;
    el.classList.remove("leaving");
    el.getAnimations().forEach((a) => a.cancel());
    if (!this.reduced) el.animate([{ opacity: 0, transform: "translate(-50%,0) scale(.92)" }, { opacity: 1, transform: "translate(-50%,0) scale(1.03)", offset: .7 }, { opacity: 1, transform: "translate(-50%,0) scale(1)" }],
      { duration: 360, easing: "cubic-bezier(.2,.8,.2,1)" });
    this.timers[timer] = setTimeout(() => {
      const fade = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: this.reduced ? 1 : 420, fill: "forwards" });
      fade.onfinish = () => { el.hidden = true; fade.cancel(); };
    }, ms);
  }
  levelUp({ rank, title, deltas = [] }) {
    const el = this.banner;
    el.className = "feel-banner level-up";
    el.querySelector(".banner-eyebrow").textContent = "Level up";
    el.querySelector(".banner-title").textContent = `Level ${rank}`;
    el.querySelector(".banner-line").textContent = title ? title[0].toUpperCase() + title.slice(1) : "";
    el.querySelector(".banner-chips").replaceChildren(...deltas.map((text) => {
      const chip = document.createElement("span");
      chip.textContent = text;
      return chip;
    }));
    this.show(el, 2600, "banner");
  }
  levelDown({ rank, title }) {
    const el = this.banner;
    el.className = "feel-banner level-down";
    el.querySelector(".banner-eyebrow").textContent = "Level lost";
    el.querySelector(".banner-title").textContent = `Level ${rank}`;
    el.querySelector(".banner-line").textContent = title || "";
    el.querySelector(".banner-chips").replaceChildren();
    this.show(el, 2200, "banner");
  }
  depthCard({ region, depth, cause, first }) {
    const el = this.card;
    el.querySelector(".depth-region").textContent = region;
    el.querySelector(".depth-title").textContent = depth;
    el.querySelector(".depth-line").textContent = cause === "trapdoor" ? "You fell through a trap door"
      : cause === "teleport" ? "Teleported" : first ? "New depth" : "";
    el.classList.toggle("first-visit", !!first);
    this.show(el, 1700, "card");
  }
  // Floor changes happen under black, then the new floor fades in.
  veil(mode) {
    if (mode !== "veil" || this.reduced) return;
    const el = this.veilEl;
    el.getAnimations().forEach((a) => a.cancel());
    el.animate([{ opacity: 1 }, { opacity: 1, offset: .25 }, { opacity: 0 }], { duration: 600, easing: "ease-out" });
  }
  deathVeil(on) {
    const el = this.deathEl;
    el.getAnimations().forEach((a) => a.cancel());
    el.hidden = !on;
    if (on && !this.reduced) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1100, easing: "ease-in", fill: "forwards" });
  }
  notice({ icon = "star", title, line }) {
    const el = document.createElement("div");
    el.className = "notice";
    el.setAttribute("role", "status");
    el.innerHTML = `<span class="notice-icon">${iconMarkup(icon) || ""}</span><span class="notice-text"><strong></strong><small></small></span>`;
    el.querySelector("strong").textContent = title;
    el.querySelector("small").textContent = line || "";
    while (this.notices.children.length >= NOTICES) this.notices.firstElementChild.remove();
    this.notices.append(el);
    if (!this.reduced) el.animate([{ opacity: 0, transform: "translateX(24px)" }, { opacity: 1, transform: "translateX(0)" }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
    setTimeout(() => {
      const fade = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: this.reduced ? 1 : 380, fill: "forwards" });
      fade.onfinish = () => el.remove();
    }, 3200);
  }
  // Loot arcs from the hero into the pack; gold lands on the counter.
  flyer(item, hero) {
    const target = document.querySelector("#inventory-panel:not([hidden]) .panel-heading") || document.querySelector('[data-key="i"]');
    const image = itemArtImage(item.id, item.arg ?? 0, item.known !== false);
    if (!target || !image || !hero) return;
    this.fly(image, hero, target, 520);
  }
  fly(image, hero, target, duration) {
    const slot = this.flyers.find((f) => !f.live);
    const p = this.project(hero.x, hero.y, .9);
    if (!slot || !p) return;
    const ctx = slot.el.getContext("2d");
    ctx.clearRect(0, 0, 56, 56);
    if (image) ctx.drawImage(image, 0, 0, 56, 56);
    const box = target.getBoundingClientRect();
    const tx = box.left + box.width / 2, ty = box.top + box.height / 2;
    slot.live = true;
    slot.el.hidden = false;
    if (this.reduced) { slot.live = false; slot.el.hidden = true; return; }
    const mx = (p.x + tx) / 2, my = Math.min(p.y, ty) - 70;
    const animation = slot.el.animate([
      { transform: `translate(${p.x - 28}px,${p.y - 28}px) scale(.6)`, opacity: 0 },
      { transform: `translate(${p.x - 28}px,${p.y - 48}px) scale(1.1)`, opacity: 1, offset: .18 },
      { transform: `translate(${mx - 28}px,${my - 28}px) scale(.85)`, opacity: 1, offset: .55 },
      { transform: `translate(${tx - 28}px,${ty - 28}px) scale(.35)`, opacity: .2 },
    ], { duration, easing: "cubic-bezier(.45,0,.25,1)", fill: "forwards" });
    animation.onfinish = () => {
      slot.live = false; slot.el.hidden = true; animation.cancel();
      target.animate([{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }], { duration: 220 });
    };
  }
  gold(from, to, hero) {
    const el = document.getElementById("gold");
    if (!el) return;
    cancelAnimationFrame(this.goldFrame);
    if (this.reduced || to - from <= 0) { el.textContent = to.toLocaleString(); return; }
    const coin = this.coinImage();
    const target = el.closest("div") || el;
    for (let i = 0; i < 3; i++) setTimeout(() => this.fly(coin, hero, target, 480), i * 70);
    const start = performance.now() + 380, span = 450;
    const tick = (now) => {
      const u = Math.max(0, Math.min(1, (now - start) / span));
      el.textContent = Math.round(from + (to - from) * (1 - (1 - u) ** 3)).toLocaleString();
      if (u < 1) this.goldFrame = requestAnimationFrame(tick);
      else el.animate([{ transform: "scale(1)", color: "#ffe39a" }, { transform: "scale(1.18)", color: "#ffe39a" }, { transform: "scale(1)" }], { duration: 260 });
    };
    this.goldFrame = requestAnimationFrame(tick);
  }
  coinImage() {
    if (this.coin) return this.coin;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 56;
    const ctx = canvas.getContext("2d"), g = ctx.createRadialGradient(22, 20, 4, 28, 28, 22);
    g.addColorStop(0, "#fff3c0"); g.addColorStop(.55, "#e7b648"); g.addColorStop(1, "#8a5a17");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(28, 28, 20, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,240,190,.8)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(28, 28, 14, 0, Math.PI * 2); ctx.stroke();
    return this.coin = canvas;
  }
  clear() {
    for (const f of this.floaters) { f.animation?.cancel(); f.live = false; f.el.hidden = true; }
    for (const f of this.flyers) { f.live = false; f.el.hidden = true; }
    this.engaged(null);
    this.lowHp(0);
  }
  metrics() {
    return { floaters: this.floaters.filter((f) => f.live).length, floaterKinds: this.floaters.filter((f) => f.live).map((f) => f.el.className.replace("floater floater-", "")),
      nameplate: this.plate.hidden ? null : this.plate.querySelector(".nameplate-name").textContent,
      wound: this.plate.hidden ? null : this.plate.querySelector(".nameplate-wound").textContent,
      banner: this.banner.hidden ? null : this.banner.querySelector(".banner-title").textContent,
      depthCard: this.card.hidden ? null : this.card.querySelector(".depth-title").textContent,
      notices: [...this.notices.children].map((n) => n.querySelector("strong")?.textContent) };
  }
}
