import { World } from "./world.js";

const mount = document.getElementById("world");
const loading = document.getElementById("home-loading");
const hero = document.getElementById("home-hero");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

const showFallback = (message) => {
  if (!loading) return;
  loading.hidden = false;
  loading.classList.add("is-fallback");
  loading.innerHTML = `<div class="home-fallback"><p>${message}</p><p class="home-fallback-note">You can still <a href="/play/">play in your browser</a> or <a href="/about/">read the field guide</a>.</p></div>`;
};

if (!mount || !hero) {
  showFallback("The interactive preview could not start.");
} else {
  try {
    const world = new World(mount, null, null);
    if (reduced) world.controls.autoRotate = false;
    if (loading) loading.hidden = true;

    // Keep the town preview live only while the hero is on screen.
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        ([entry]) => {
          world.paused = !entry.isIntersecting;
        },
        { threshold: 0.08 }
      );
      observer.observe(hero);
    }

    document.documentElement.classList.add("has-live-hero");
  } catch (error) {
    console.error(error);
    showFallback("3D graphics could not start on this device.");
  }
}

// Transparent header over the live hero; solid once marketing content rises.
const header = document.querySelector(".site-header");
if (header && hero) {
  const syncHeader = () => {
    header.classList.toggle("is-solid", window.scrollY > hero.clientHeight * 0.55);
  };
  syncHeader();
  window.addEventListener("scroll", syncHeader, { passive: true });
}
