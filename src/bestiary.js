import { MONSTER_DESCRIPTIONS } from "./monster-descriptions.js";
import { bestiaryCount } from "./profile.js";

/**
 * Creatures fill in as the player meets them, using the same portraits the
 * hover card shows. Undiscovered species stay silhouettes with no name.
 */
export class Bestiary {
  constructor({ dialog, getProfile, species }) {
    this.dialog = dialog; this.getProfile = getProfile; this.species = species;
    this.grid = dialog.querySelector("#bestiary-grid");
    this.progress = dialog.querySelector("#bestiary-progress");
    this.filter = "all";
    this.tabs = [...dialog.querySelectorAll("[data-filter]")];
    for (const tab of this.tabs) tab.addEventListener("click", () => { this.filter = tab.dataset.filter; this.render(); });
    // Arrow keys move between cards; one card holds the tab stop.
    this.grid.addEventListener("keydown", (event) => {
      const cards = [...this.grid.children], index = cards.indexOf(document.activeElement);
      if (index < 0) return;
      const columns = Math.max(1, Math.round(this.grid.clientWidth / (cards[0]?.offsetWidth || 1)));
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[event.key];
      if (!step) return;
      event.preventDefault();
      const next = cards[Math.max(0, Math.min(cards.length - 1, index + step))];
      cards[index].tabIndex = -1; next.tabIndex = 0; next.focus();
    });
  }
  open(filter = "all") {
    this.filter = filter;
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
    (this.grid.querySelector('[tabindex="0"]') || this.tabs[0])?.focus();
  }
  render() {
    const profile = this.getProfile(), all = this.species();
    const entries = all.map((species) => ({ ...species, record: profile.species?.[species.id] }));
    const seen = entries.filter((entry) => entry.record?.seen > 0);
    const shown = this.filter === "seen" ? seen : this.filter === "slain" ? entries.filter((entry) => entry.record?.killed > 0) : entries;
    for (const tab of this.tabs) tab.setAttribute("aria-selected", String(tab.dataset.filter === this.filter));
    this.progress.textContent = `${bestiaryCount(profile)} of ${all.length} creatures discovered`;
    this.grid.replaceChildren(...shown.map((entry, index) => {
      const known = entry.record?.seen > 0;
      const card = document.createElement("article");
      card.className = `beast${known ? "" : " unknown"}`;
      card.setAttribute("role", "listitem");
      card.tabIndex = index === 0 ? 0 : -1;
      const art = document.createElement("img");
      art.src = `/art/creatures/${entry.id}.webp`;
      art.alt = "";
      art.loading = "lazy";
      art.width = 150; art.height = 180;
      const name = document.createElement("strong");
      name.textContent = known ? entry.name : "Unknown";
      const tally = document.createElement("span");
      tally.className = "tally";
      tally.textContent = known ? `${entry.record.killed || 0} slain` : "Not yet seen";
      const about = document.createElement("small");
      about.textContent = known ? MONSTER_DESCRIPTIONS[entry.id] || "" : "";
      card.setAttribute("aria-label", known ? `${entry.name}, ${entry.record.killed || 0} slain` : "Unknown creature");
      card.append(art, name, tally, about);
      return card;
    }));
    if (!shown.length) {
      const empty = document.createElement("p");
      empty.textContent = this.filter === "slain" ? "No creature has fallen to you yet." : "Explore the caves to fill these pages.";
      this.grid.append(empty);
    }
  }
}
