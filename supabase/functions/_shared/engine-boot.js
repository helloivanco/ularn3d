import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createHeadlessDom } from "./headless-dom.js";
import { concatEngineFiles } from "./engine-files.js";

/** Pinned bundle. The hash is the file bytes, so a changed download is refused. */
export const ENGINE_SOURCE_SHA256 = "53868af2da5fbdc532f9bb9441c3045163a91fe605e15dca10e0bf993bf9f03b";
const ENGINE_COMMIT = "caa0b28145ab4ca8db87b4c0cf9c86e81a5dcc9b";
const ENGINE_SOURCE_URLS = [
  `https://raw.githubusercontent.com/helloivanco/ularn3d/${ENGINE_COMMIT}/supabase/functions/_shared/engine-source.js`,
  `https://cdn.jsdelivr.net/gh/helloivanco/ularn3d@${ENGINE_COMMIT}/supabase/functions/_shared/engine-source.js`,
];

let cachedSource = null;

const sha256 = async (text) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

/** Pull the engine string out of the generated module. */
export const extractEngineBundle = (text) => {
  const marker = "export const ENGINE_SOURCE = ";
  const at = text.indexOf(marker);
  if (at < 0) throw new Error("engine bundle shape");
  const literal = text.slice(at + marker.length).trim().replace(/;\s*$/, "");
  const source = JSON.parse(literal);
  if (typeof source !== "string" || source.length < 1000) throw new Error("engine bundle empty");
  return source;
};

const repoEngineSource = () => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const root = join(here, "../../../public/engine");
    if (!existsSync(join(root, "determinism.js"))) return null;
    return concatEngineFiles((rel) => readFileSync(join(root, rel), "utf8"));
  } catch {
    return null;
  }
};

const siblingEngineSource = () => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, "engine-source.js");
    if (!existsSync(path)) return null;
    return extractEngineBundle(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const fetchPinnedEngineSource = async () => {
  let lastError = null;
  for (const url of ENGINE_SOURCE_URLS) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`engine bundle ${response.status}`);
      const text = await response.text();
      const hash = await sha256(text);
      if (hash !== ENGINE_SOURCE_SHA256) throw new Error("engine bundle hash");
      return extractEngineBundle(text);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("engine bundle fetch");
};

/**
 * Repo scripts when this process can see public/engine. The Edge isolate uses
 * the sibling bundle, or the same pinned file when that bundle is not on disk.
 */
export const ensureEngineSource = async () => {
  if (cachedSource) return cachedSource;
  cachedSource = repoEngineSource() || siblingEngineSource() || await fetchPinnedEngineSource();
  return cachedSource;
};

const loadEngineSource = () => {
  if (cachedSource) return cachedSource;
  const source = repoEngineSource() || siblingEngineSource();
  if (!source) throw new Error("engine source is not loaded");
  cachedSource = source;
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
  vm.runInContext(loadEngineSource(), sandbox, { filename: "engine-headless.js" });
  vm.runInContext(
    "globalThis.__replayScore = function () {\n" +
      "  var card = new LocalScore();\n" +
      "  return { score: card.score, won: !!card.winner, killedBy: card.what || '' };\n" +
      "};\n",
    sandbox,
    { filename: "replay-score.js" },
  );
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
