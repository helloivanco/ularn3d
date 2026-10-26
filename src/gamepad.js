/* Controller support over the standard Gamepad mapping. A pad only presses
   what a keyboard or pointer could: engine keys, HUD buttons and focused
   controls. Polling runs only while a pad is connected. */

export const BUTTON = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
// Screen space, y down, starting east and turning clockwise. North is always
// up the stick, as with the arrow keys, whatever the camera's orbit.
const COMPASS = ["l", "n", "j", "b", "h", "y", "k", "u"];
const FOCUS_DELAY = 380, FOCUS_REPEAT = 140, DPAD_SETTLE = 60;

/** One of the eight movement keys, or null inside the dead zone. */
export function stickKey(x, y, deadzone = 0.5) {
  if (!(Math.hypot(x, y) >= deadzone)) return null;
  const sector = Math.round(Math.atan2(y, x) / (Math.PI / 4));
  return COMPASS[(sector + 8) % 8];
}

export function dpadKey(up, down, left, right) {
  const x = (right ? 1 : 0) - (left ? 1 : 0), y = (down ? 1 : 0) - (up ? 1 : 0);
  return x || y ? stickKey(x, y, 0.1) : null;
}

const isDiagonal = (key) => "yubn".includes(key);
const center = (rect) => ({ x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 });

/**
 * Spatial focus: the nearest rectangle in a direction ("up", "down", "left",
 * "right"), with distance across the travel axis counting double. -1 if none.
 */
export function pickSpatial(origin, rects, direction) {
  const from = center(origin), horizontal = direction === "left" || direction === "right";
  const sign = direction === "right" || direction === "down" ? 1 : -1;
  let best = -1, bestScore = Infinity;
  rects.forEach((rect, index) => {
    const to = center(rect);
    const along = ((horizontal ? to.x - from.x : to.y - from.y)) * sign;
    const across = Math.abs(horizontal ? to.y - from.y : to.x - from.x);
    if (along <= 2) return;
    const score = along + across * 2;
    if (score < bestScore) { bestScore = score; best = index; }
  });
  return best;
}

const FOCUSABLE = 'button, input:not([type=hidden]), select, a[href], [tabindex]:not([tabindex="-1"])';
const visible = (el) => !el.disabled && !el.closest("[hidden]") && el.getClientRects().length > 0 &&
  getComputedStyle(el).visibility !== "hidden";
export const focusables = (root) => [...root.querySelectorAll(FOCUSABLE)].filter(visible);

/**
 * `surface()` describes the screen: { kind: "play" | "direction" | "menu",
 * root, preferred, back } or null. Play receives movement and named actions;
 * a direction prompt receives single movement keys; menus move focus.
 */
export function mountGamepad({ surface, move, release, press, act, back, connected, activeChanged }) {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return null;
  let frame = 0, last = [], held = null, moving = null, dpadPending = null, focusHeld = null, lastKind = null;
  const pad = () => [...navigator.getGamepads()].find((gamepad) => gamepad?.connected !== false && gamepad) || null;
  const down = (gamepad, index) => {
    const button = gamepad.buttons[index];
    return !!button && (button.pressed || button.value > 0.5);
  };
  // While the pad leads, focus rings show and prompts name pad buttons.
  const setActive = (on) => {
    if (document.body.classList.contains("pad-active") === on) return;
    document.body.classList.toggle("pad-active", on);
    activeChanged?.(on);
  };
  const markActive = () => setActive(true);
  const quiet = () => setActive(false);
  for (const type of ["pointerdown", "keydown"]) addEventListener(type, quiet, { capture: true, passive: true });

  function focusMove(view, direction) {
    const items = focusables(view.root);
    if (!items.length) return;
    const current = items.includes(document.activeElement) ? document.activeElement : null;
    if (!current) { focusTo(view.preferred && visible(view.preferred) ? view.preferred : items[0]); return; }
    // Sliders take left and right as a value change, like the arrow keys.
    if (current.matches("input[type=range]") && (direction === "left" || direction === "right")) {
      current.value = Number(current.value) + (direction === "right" ? 1 : -1) * Number(current.step || 1) * 5;
      current.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    const index = pickSpatial(current.getBoundingClientRect(), items.map((el) => el.getBoundingClientRect()), direction);
    if (index >= 0) focusTo(items[index]);
  }
  function focusTo(el) {
    el.focus({ preventScroll: false, focusVisible: true });
    el.scrollIntoView?.({ block: "nearest" });
  }
  function choose(view) {
    const items = focusables(view.root);
    if (!items.length) { view.start?.(); return; }
    const el = items.includes(document.activeElement) ? document.activeElement : null;
    // Nothing focused yet: A takes the screen's main action, or finds the first control.
    if (!el) {
      if (view.preferred && visible(view.preferred)) { focusTo(view.preferred); view.preferred.click(); }
      else focusTo(items[0]);
      return;
    }
    if (el.matches("select")) {
      el.selectedIndex = (el.selectedIndex + 1) % el.options.length;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.matches("input[type=range], input[type=text], input:not([type])")) {
      return;
    } else el.click();
  }
  function stopMoving() {
    if (moving) release();
    moving = null; dpadPending = null;
  }

  function poll(now) {
    frame = 0;
    const gamepad = pad();
    if (!gamepad) { stopMoving(); last = []; return; }
    frame = requestAnimationFrame(poll);
    const buttons = gamepad.buttons.map((_, index) => down(gamepad, index)), before = last;
    const pressed = (index) => buttons[index] && !before[index];
    const view = surface();
    const kind = view?.kind || null;
    if (kind !== lastKind) { stopMoving(); focusHeld = null; held = null; lastKind = kind; }
    const stick = stickKey(gamepad.axes[0] || 0, gamepad.axes[1] || 0);
    const cross = dpadKey(buttons[BUTTON.UP], buttons[BUTTON.DOWN], buttons[BUTTON.LEFT], buttons[BUTTON.RIGHT]);
    if (buttons.some(Boolean) || stick) markActive();
    last = buttons;
    if (!view) return;

    if (kind === "play") {
      // A lone d-pad direction waits a moment, so a diagonal press is not read as
      // two steps. A tap released sooner still takes its one step.
      let want = stick || cross;
      if (!stick && cross && !moving) {
        if (isDiagonal(cross)) dpadPending = null;
        else if (dpadPending?.key !== cross) { dpadPending = { key: cross, since: now }; want = null; }
        else if (now - dpadPending.since < DPAD_SETTLE) want = null;
      } else if (!cross && dpadPending && !moving && !stick) {
        move(dpadPending.key); release();
        dpadPending = null;
      } else if (!cross) dpadPending = null;
      if (want !== moving) {
        if (want) { moving = want; move(want); }
        else stopMoving();
      }
      if (pressed(BUTTON.A)) act("step");
      if (pressed(BUTTON.B)) act("cancel");
      if (pressed(BUTTON.X)) act("explore");
      if (pressed(BUTTON.Y)) act("inventory");
      if (pressed(BUTTON.LB)) act("rotate-left");
      if (pressed(BUTTON.RB)) act("rotate-right");
      if (pressed(BUTTON.LT)) act("zoom-out");
      if (pressed(BUTTON.RT)) act("zoom-in");
      if (pressed(BUTTON.VIEW)) act("map");
      if (pressed(BUTTON.MENU)) act("menu");
      if (pressed(BUTTON.L3)) act("wait");
      if (pressed(BUTTON.R3)) act("center");
      return;
    }
    if (kind === "direction") {
      const key = stick || cross;
      if (key && key !== held) press(key);
      held = key;
      if (pressed(BUTTON.B)) back(view);
      return;
    }
    // Menus: the d-pad or stick walks focus, repeating while held.
    const direction = buttons[BUTTON.UP] ? "up" : buttons[BUTTON.DOWN] ? "down" : buttons[BUTTON.LEFT] ? "left" : buttons[BUTTON.RIGHT] ? "right"
      : stick ? { k: "up", j: "down", h: "left", l: "right", y: "up", u: "up", b: "down", n: "down" }[stick] : null;
    if (!direction) focusHeld = null;
    else if (focusHeld?.direction !== direction) { focusHeld = { direction, next: now + FOCUS_DELAY }; focusMove(view, direction); }
    else if (now >= focusHeld.next) { focusHeld.next = now + FOCUS_REPEAT; focusMove(view, direction); }
    if (pressed(BUTTON.A)) choose(view);
    if (pressed(BUTTON.B)) back(view);
    if (pressed(BUTTON.MENU) && view.start) view.start();
  }

  const wake = () => { if (!frame && pad()) frame = requestAnimationFrame(poll); };
  addEventListener("gamepadconnected", () => { connected?.(); wake(); });
  addEventListener("gamepaddisconnected", () => { if (!pad()) { stopMoving(); quiet(); } });
  wake();
  return { wake, active: () => !!frame };
}
