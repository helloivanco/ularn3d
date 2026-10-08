import { createHeadlessDom } from "./headless-dom.js";
import { concatEngineFiles } from "./engine-files.js";
import { createScriptEngine } from "./script-context.js";
import { BUNDLED_ENGINE_SHA256, ENGINE_PART_COUNT } from "./engine-bundle-meta.js";

const builtin = (name) => {
  try {
    if (typeof process !== "undefined" && typeof process.getBuiltinModule === "function") {
      return process.getBuiltinModule(name);
    }
  } catch {
    return null;
  }
  return null;
};

const decodeBundle = async (b64) => {
  if (typeof b64 !== "string" || b64.length < 1000) return null;
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex !== BUNDLED_ENGINE_SHA256) throw new Error("engine bundle checksum");
  return text;
};

const bundledEngineSource = async () => {
  try {
    let b64 = "";
    for (let i = 0; i < ENGINE_PART_COUNT; i++) {
      const mod = await import(`./engine-part-${i}.js`);
      b64 += mod.PART || "";
    }
    return await decodeBundle(b64);
  } catch {
    return null;
  }
};

const hostedEngineSource = async () => {
  const env = globalThis.Deno?.env;
  if (!env?.get) return null;
  const url = env.get("SUPABASE_URL");
  const key = env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  const { createClient } = await import("npm:@supabase/supabase-js@2");
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc("replay_engine_bundle");
  if (error) return null;
  return decodeBundle(data);
};

let vmApi = null;

const bindVm = (mod) => {
  if (!mod) return null;
  if (typeof mod.createContext === "function") return mod;
  if (mod.default && typeof mod.default.createContext === "function") return mod.default;
  return null;
};

const loadVmSync = () => {
  if (vmApi) return vmApi;
  try {
    if (typeof process !== "undefined" && typeof process.getBuiltinModule === "function") {
      vmApi = bindVm(process.getBuiltinModule("vm"));
    }
  } catch {
    vmApi = null;
  }
  return vmApi;
};

/** The Edge bundler rejects a static node:vm import. Load it when the replay starts. */
export const ensureVm = async () => {
  if (loadVmSync()) return vmApi;
  const loaded = await import("node:" + "vm");
  vmApi = bindVm(loaded);
  if (!vmApi) throw new Error("vm missing");
  return vmApi;
};

/** Hash of the bundled engine-source.js. A changed bundle is refused by the unit test. */
export const ENGINE_SOURCE_SHA256 = "b1730861136856b47f263929699c18a0a73e0c7b10560aca1756bb84618f021a";

let cachedSource = null;

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
    const fs = builtin("fs");
    const path = builtin("path");
    const url = builtin("url");
    if (!fs?.existsSync || !path || !url?.fileURLToPath) return null;
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const root = path.join(here, "../../../public/engine");
    if (!fs.existsSync(path.join(root, "determinism.js"))) return null;
    return concatEngineFiles((rel) => fs.readFileSync(path.join(root, rel), "utf8"));
  } catch {
    return null;
  }
};

const siblingEngineSource = () => {
  try {
    const fs = builtin("fs");
    const path = builtin("path");
    const url = builtin("url");
    if (!fs?.existsSync || !path || !url?.fileURLToPath) return null;
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const file = path.join(here, "engine-source.js");
    if (!fs.existsSync(file)) return null;
    return extractEngineBundle(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

/**
 * The replay engine ships as gzip parts next to this file. A cold start does
 * not download it from GitHub. The hosted function reads those same parts from
 * private.replay_engine_part (service role only) when the parts are not in the
 * isolate. submit-score relies on verify_jwt staying enabled: it reads the
 * caller from that JWT and does not sign anyone in itself.
 */
export const ensureEngineSource = async () => {
  await ensureVm();
  if (cachedSource) return cachedSource;
  const bundled = await bundledEngineSource() || await hostedEngineSource();
  if (typeof bundled === "string" && bundled.length > 1000) {
    cachedSource = bundled;
    return cachedSource;
  }
  cachedSource = repoEngineSource() || siblingEngineSource();
  if (!cachedSource) throw new Error("engine bundle missing");
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

let vmContextsWork = null;
let forcedContext = null;

/** Node can contextify vm. The edge isolate cannot, so replay uses the script sandbox. */
const contextsWork = () => {
  if (vmContextsWork != null) return vmContextsWork;
  const vm = loadVmSync();
  if (!vm) return (vmContextsWork = false);
  try {
    const probe = {};
    vm.createContext(probe);
    vm.runInContext("var __ularnProbe = 1;", probe);
    vmContextsWork = probe.__ularnProbe === 1;
  } catch {
    vmContextsWork = false;
  }
  return vmContextsWork;
};

/** Tests pin "script" so a replay uses the same sandbox the edge isolate uses. */
export const forceEngineContext = (mode = null) => {
  forcedContext = mode;
};

const bootVm = (source) => {
  const vm = loadVmSync();
  if (!vm) throw new Error("engine vm is not loaded");
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
  vm.runInContext(source, sandbox, { filename: "engine-headless.js" });
  vm.runInContext(
    "globalThis.__replayScore = function () {\n" +
      "  var card = new LocalScore();\n" +
      "  return { score: card.score, won: !!card.winner, killedBy: card.what || '' };\n" +
      "};\n",
    sandbox,
    { filename: "replay-score.js" },
  );
  return sandbox;
};

/**
 * Boot the classic engine. `seed` installs one RNG stream before the dungeon
 * is built. Omit `seed` for today's unseeded solo rules.
 */
export const bootEngine = (options = {}) => {
  const mode = options.context || forcedContext || (contextsWork() ? "vm" : "script");
  const api = mode === "script" ? createScriptEngine(loadEngineSource()) : bootVm(loadEngineSource());
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
