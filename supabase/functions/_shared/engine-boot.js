import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createHeadlessDom } from "./headless-dom.js";
import { concatEngineFiles } from "./engine-files.js";
import { ENGINE_SOURCE } from "./engine-source.js";

let cachedSource = null;

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

/** Repo scripts when they are on disk. The bundled copy is what the Edge isolate runs. */
export const loadEngineSource = () => {
  if (cachedSource) return cachedSource;
  cachedSource = repoEngineSource() || ENGINE_SOURCE;
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
