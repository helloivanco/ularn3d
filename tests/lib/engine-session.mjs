import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createHeadlessDom } from "./headless-dom.mjs";

const ENGINE_FILES = [
  "lib/lz-string.min.js",
  "lib/diff_match_patch.js",
  "lib/mousetrap.min.js",
  "common/util",
  "common/larn_config",
  "common/frame",
  "common/patch",
  "common/roll",
  "common/cloudflare",
  "common/movie",
  "common/live",
  "config",
  "larn",
  "main",
  "object",
  "options",
  "global",
  "monster",
  "monsterdata",
  "player",
  "mazes",
  "level",
  "create",
  "data",
  "parse",
  "buttons",
  "scores",
  "inventory",
  "aura",
  "movem",
  "action",
  "io",
  "display",
  "storedata",
  "store",
  "mcdopes",
  "savelev",
  "spells",
  "spellsinfo",
  "regen",
  "spheres",
  "help",
  "state",
  "bill",
  "altar",
  "fountain",
  "potion",
  "scroll",
  "stairs",
  "throne",
  "devmode",
  "gotw",
  "explore",
  "determinism",
  "party",
];

const sourceOf = (file) => {
  const path = file.endsWith(".js") ? `public/engine/${file}` : `public/engine/${file}.js`;
  return `\n// Source: ${file}\n${readFileSync(path, "utf8")}\n`;
};

let cachedSource = null;
const engineSource = () => {
  if (!cachedSource) cachedSource = ENGINE_FILES.map(sourceOf).join("\n");
  return cachedSource;
};

const copyGlobals = (sandbox) => {
  const names = [
    "Object", "Array", "Math", "JSON", "Promise", "Date", "Map", "Set", "WeakMap", "WeakSet",
    "Symbol", "Proxy", "Reflect", "Number", "Boolean", "RegExp", "Error", "TypeError",
    "ReferenceError", "RangeError", "SyntaxError", "URIError", "EvalError", "parseInt", "parseFloat",
    "isNaN", "isFinite", "Infinity", "NaN", "decodeURIComponent", "encodeURIComponent", "encodeURI",
    "decodeURI", "Uint8Array", "Uint8ClampedArray", "Uint16Array", "Uint32Array", "Int8Array",
    "Int16Array", "Int32Array", "Float32Array", "Float64Array", "ArrayBuffer", "DataView", "BigInt",
    "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "structuredClone", "queueMicrotask",
    "setTimeout", "clearTimeout", "setInterval", "clearInterval", "atob", "btoa", "crypto",
    "performance", "Intl",
  ];
  for (const name of names) {
    if (globalThis[name] !== undefined) sandbox[name] = globalThis[name];
  }
  sandbox.console = console;
  sandbox.Image = function Image() {
    return { src: "", onload: null, onerror: null };
  };
  sandbox.Audio = function Audio() {
    return { play() { return Promise.resolve(); }, pause() {}, src: "" };
  };
  sandbox.Node = function Node() {};
};

/**
 * Boot the classic engine in a fresh vm. `seed` installs one RNG stream
 * before the dungeon is built. Omit `seed` for today's unseeded solo rules.
 */
export const bootEngine = (options = {}) => {
  const dom = createHeadlessDom();
  const sandbox = {
    document: dom.document,
    window: null,
    localStorage: dom.localStorage,
    sessionStorage: dom.localStorage,
    location: dom.location,
    navigator: dom.navigator,
    Storage: dom.Storage,
    HTMLElement: function HTMLElement() {},
    Element: function Element() {},
    Node: function Node() {},
  };
  copyGlobals(sandbox);
  sandbox.window = Object.assign(sandbox, dom.window);
  sandbox.window.window = sandbox.window;
  sandbox.globalThis = sandbox.window;
  sandbox.self = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(engineSource(), sandbox, { filename: "engine-headless.js" });
  const api = sandbox;
  if (options.seed != null) {
    api.installEngineHost(api.createEngineHost(options.seed, {
      skipPaint: options.skipPaint !== false,
      skipDelay: true,
    }));
  }
  // The 3D bridge replaces isMobile so contextual buttons exist at every size.
  // Replay has to follow that, or the browser welcome line will not match.
  api.isMobile = () => true;
  api.ULARN = true;
  api.GOTW = false;
  api.PARAMS = { ularn: "true" };
  api.playerID = "local";
  api.setGameConfig();
  api.loadPreferences();
  api.overridePref("no_intro", true);
  api.overridePref("side_inventory", false);
  api.overridePref("auto_pickup", false);
  api.initHelpPages();
  api.logname = options.name || "Adventurer";
  api.player = new api.Player();
  api.setGameDifficulty(options.difficulty || 0);
  api.setclass(options.character || "Adventurer");
  if (!api.game_started) throw new Error("headless game did not start");
  return api;
};

export const playInputs = async (api, inputs, actor = 0) => {
  const log = [];
  for (let seq = 0; seq < inputs.length; seq++) {
    const action = inputs[seq];
    if (typeof api.pushInput === "function") {
      api.pushInput({ actor, turn: api.gtime, action, seq });
    }
    api.mainloop(null, action);
    log.push({ actor, turn: api.gtime, action, seq });
  }
  return log;
};

export const scriptedRun = async ({ seed, inputs, character, partyOfOne = false }) => {
  const api = bootEngine({ seed, character, skipPaint: true });
  if (partyOfOne) api.enablePartyOfOne();
  const log = await playInputs(api, inputs);
  const state = api.captureGameState();
  state.party = null;
  return {
    checksum: api.checksumGameState(state),
    state,
    log,
    gtime: api.gtime,
    x: api.player.x,
    y: api.player.y,
    hp: api.player.HP,
    level: api.level,
    api,
  };
};

/** 500 waits. Fixed, and long enough to pass monster spawns and regen. */
export const SOLO_LOCK_TURNS = 500;
export const SOLO_LOCK_SEED = 0x0c001a33;
export const soloLockInputs = () => Array.from({ length: SOLO_LOCK_TURNS }, () => ".");
