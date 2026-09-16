// Original Ularn interface artwork. One 24px grid, one stroke weight, no icon font.
const paths = {
  sigil: '<path d="m12 2 8 9-8 8-8-8 8-9Z"/><path d="m12 7 4 4-4 4-4-4 4-4ZM8 17l-4 5m12-5 4 5"/>',
  swords: '<path d="m4 3 4 1 11 12-3 3L4 7 4 3Zm16 0-4 1-4 4m-4 4-3 4 3 3 4-4M3 15l6 6m6-18-1 4M3 21l3-3m9-3 6 6m0-6-6 6"/>',
  wand: '<path d="m4 20 11-11 3 3L7 23M14 10l3 3M6 3v4M4 5h4m10-3 1.3 3.7L23 7l-3.7 1.3L18 12l-1.3-3.7L13 7l3.7-1.3L18 2Z"/>',
  dagger: '<path d="m19 3-1 7-8 7-3-3 7-8 5-3ZM5 12l7 7m-7-2-3 3 2 2 3-3m3-5 6-7"/>',
  leaf: '<path d="M20 3C7 2 2 8 5 15c3 7 15 4 15-12Z"/><path d="m4 21 12-13M9 16v-5m4 1h5"/>',
  axe: '<path d="m6 21 12-17m-5-1 7 5M14 5C7 2 3 6 3 10l7 4m7-6 3 5 2-4-2-3"/>',
  club: '<path d="m9 13 3 2-5 7-3-2 5-7ZM9 13l-1-5 4-5 6-1 4 4-1 6-5 4-4-1M12 7l2-1m2 5 2-2"/>',
  blades: '<path d="M3 3v7l6 7h6l6-7V3l-5 8H8L3 3Zm6 14-2 4m8-4 2 4M8 11v3m8-3v3m-4-3v6"/>',
  spear: '<path d="m4 21 11-13m-3 1 2-6 7-2-2 7-6 3m-3 0 4 4m2-9 2-2"/>',
  backpack: '<rect x="5" y="6" width="14" height="16" rx="3"/><path d="M9 6V4a3 3 0 0 1 6 0v2M5 11h14m-11 4h8v4H8zM9 10v3m6-3v3"/>',
  spell: '<path d="m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8L12 2Z"/><path d="M4 3v3M2.5 4.5h3M20 18v4m-2-2h4"/>',
  potion: '<path d="M9 3h6M10 3v6l-5 8a3 3 0 0 0 2.5 4.5h9a3 3 0 0 0 2.5-4.5l-5-8V3M7 15h10"/><path d="m10 18 .01 0m4 1 .01 0"/>',
  scroll: '<path d="M7 3h12a3 3 0 0 1 3 3v2h-5V6a3 3 0 0 1 3-3M17 8v10a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-2h5V6a3 3 0 0 1 3-3M7 16v2a3 3 0 0 0 3 3m0-12h4m-4 4h4"/>',
  chest: '<path d="M3 11V8a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v3M3 11h18v9H3v-9Zm4-7v7m10-7v7m-7 0v4h4v-4"/>',
  take: '<path d="M12 3v11m-4-4 4 4 4-4M4 14v6h16v-6"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3v4l5 5-5 5v4m10-18v4l-5 5 5 5v4M9 7h6m-6 11h6"/>',
  save: '<path d="M4 3h13l4 4v14H3V3h1Zm3 0v6h10V3M7 21v-8h10v8m-3-16v2"/>',
  soundOn: '<path d="M11 4 6 8H3v8h3l5 4V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  soundOff: '<path d="M11 4 6 8H3v8h3l5 4V4Zm5 5 6 6m0-6-6 6"/>',
  book: '<path d="M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Zm0 0v15M5 8h3m-3 4h3m8-4h3m-3 4h3"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  rotateLeft: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  rotateRight: '<path d="M21 10a9 9 0 1 0-2 8m2-14v6h-6"/>',
  center: '<circle cx="12" cy="12" r="6"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/><circle cx="12" cy="12" r="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  north: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  northeast: '<path d="M5 19 19 5M8 5h11v11"/>',
  east: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  southeast: '<path d="m5 5 14 14M8 19h11V8"/>',
  south: '<path d="M12 4v16m-6-6 6 6 6-6"/>',
  southwest: '<path d="M19 5 5 19m11 0H5V8"/>',
  west: '<path d="M20 12H4m6-6-6 6 6 6"/>',
  northwest: '<path d="M19 19 5 5m11 0H5v11"/>',
};

export function iconMarkup(name) {
  if (!Object.hasOwn(paths, name)) throw new Error(`Unknown interface icon: ${name}`);
  return `<svg class="icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

export function setIcon(element, name) {
  if (element.dataset.renderedIcon === name) return;
  element.innerHTML = iconMarkup(name);
  element.dataset.icon = name;
  element.dataset.renderedIcon = name;
}

export function mountIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((element) => setIcon(element, element.dataset.icon));
}
