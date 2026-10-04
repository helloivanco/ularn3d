import { createHeadlessDom } from "./headless-dom.js";

/**
 * The Edge isolate exposes node:vm, then rejects createContext unless the
 * process may spawn commands. This runs the same scripts with function and
 * var bindings kept live, which matches the vm checksums.
 */

const reserved = new Set(
  "break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof new return super switch this throw try typeof var void while with yield enum await let static implements package private protected public interface eval arguments"
    .split(" "),
);

const occupied = new Set(
  "document window localStorage sessionStorage location navigator Storage HTMLElement Element Node console Image Audio Object Array Math JSON Promise Date Map Set WeakMap WeakSet Symbol Proxy Reflect Number Boolean String Function RegExp Error TypeError ReferenceError RangeError SyntaxError URIError EvalError parseInt parseFloat isNaN isFinite Infinity NaN decodeURIComponent encodeURIComponent encodeURI decodeURI Uint8Array Uint8ClampedArray Uint16Array Uint32Array Int8Array Int16Array Int32Array Float32Array Float64Array ArrayBuffer DataView BigInt URL URLSearchParams TextEncoder TextDecoder structuredClone queueMicrotask setTimeout clearTimeout setInterval clearInterval atob btoa crypto performance Intl process Buffer global fetch Deno EdgeRuntime setImmediate clearImmediate require module exports fsfunc FS Rollbar WebSocket Worker EventSource XMLHttpRequest __dirname __filename globalThis self"
    .split(" "),
);

const intrinsics = [
  "Object", "Array", "Math", "JSON", "Promise", "Date", "Map", "Set", "WeakMap", "WeakSet",
  "Symbol", "Proxy", "Reflect", "Number", "Boolean", "String", "Function", "RegExp", "Error",
  "TypeError", "ReferenceError", "RangeError", "SyntaxError", "URIError", "EvalError",
  "parseInt", "parseFloat", "isNaN", "isFinite", "Infinity", "NaN", "decodeURIComponent",
  "encodeURIComponent", "encodeURI", "decodeURI", "Uint8Array", "Uint8ClampedArray",
  "Uint16Array", "Uint32Array", "Int8Array", "Int16Array", "Int32Array", "Float32Array",
  "Float64Array", "ArrayBuffer", "DataView", "BigInt", "URL", "URLSearchParams", "TextEncoder",
  "TextDecoder", "structuredClone", "queueMicrotask", "setTimeout", "clearTimeout",
  "setInterval", "clearInterval", "atob", "btoa", "crypto", "performance", "Intl",
];

const hidden = [
  "process", "Buffer", "global", "Deno", "EdgeRuntime", "setImmediate", "clearImmediate",
  "require", "module", "exports", "fsfunc", "FS", "Rollbar", "WebSocket", "Worker",
  "EventSource", "XMLHttpRequest",
];

const consider = (names, name) => {
  if (!name || reserved.has(name) || occupied.has(name) || !/^[A-Za-z_$][\w$]*$/.test(name)) return;
  names.add(name);
};

const bindings = (source) => {
  const vars = new Set();
  const fns = new Set();
  for (const match of source.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) consider(fns, match[1]);
  for (const match of source.matchAll(/\bvar\s+([^;=]+)/g)) {
    for (const part of match[1].split(",")) consider(vars, part.trim().split(/[=\s]/)[0]);
  }
  for (const name of fns) vars.delete(name);
  return { vars, fns };
};

const accessor = (name, read, write) =>
  `globalThis.Object.defineProperty(__ularnSandbox, ${JSON.stringify(name)}, {configurable:true, enumerable:true, get(){return ${read};}, set(v){${write};}});`;

let cachedSource = null;
let cachedRun = null;

const compile = (source) => {
  const { vars, fns } = bindings(source);
  const varBridge = [...vars].map((name) =>
    `var ${name};\n${accessor(name, name, `${name}=v`)}`
  ).join("\n");
  const fnBridge = [...fns].map((name) => {
    const slot = `__ularnBind_${name}`;
    return `try { var ${slot} = ${name}; ${accessor(name, slot, `${slot}=v; ${name}=v`)} } catch (e) {}`;
  }).join("\n");
  const score = "__ularnSandbox.__replayScore = function () { var card = new LocalScore(); return { score: card.score, won: !!card.winner, killedBy: card.what || '' }; };";
  const body = `${varBridge}\nwith (__ularnSandbox) {\n${source}\n${fnBridge}\n${score}\n}\n`;
  return new Function("__ularnSandbox", body);
};

const scriptSandbox = () => {
  const dom = createHeadlessDom();
  const sandbox = {
    document: dom.document,
    localStorage: dom.localStorage,
    sessionStorage: dom.localStorage,
    location: dom.location,
    navigator: dom.navigator,
    Storage: dom.Storage,
    HTMLElement: function HTMLElement() {},
    Element: function Element() {},
    Node: function Node() {},
    console,
    Image: function Image() {
      return { src: "", onload: null, onerror: null };
    },
    Audio: function Audio() {
      return { play() { return Promise.resolve(); }, pause() {}, src: "" };
    },
    fetch: function fetch() {
      throw new ReferenceError("fetch is not defined");
    },
  };
  for (const name of intrinsics) {
    if (globalThis[name] !== undefined) sandbox[name] = globalThis[name];
  }
  // Deno timer functions reject a foreign `this`. Calls inside `with` supply the sandbox.
  sandbox.setTimeout = (fn, ms, ...args) => globalThis.setTimeout(fn, ms, ...args);
  sandbox.clearTimeout = (id) => globalThis.clearTimeout(id);
  sandbox.setInterval = (fn, ms, ...args) => globalThis.setInterval(fn, ms, ...args);
  sandbox.clearInterval = (id) => globalThis.clearInterval(id);
  if (typeof globalThis.atob === "function") sandbox.atob = (value) => globalThis.atob(value);
  if (typeof globalThis.btoa === "function") sandbox.btoa = (value) => globalThis.btoa(value);
  if (typeof globalThis.queueMicrotask === "function") {
    sandbox.queueMicrotask = (fn) => globalThis.queueMicrotask(fn);
  }
  for (const name of hidden) sandbox[name] = undefined;
  sandbox.window = Object.assign(sandbox, dom.window);
  sandbox.window.window = sandbox.window;
  sandbox.globalThis = sandbox.window;
  sandbox.self = sandbox.window;
  return sandbox;
};

/** Install one fresh engine into a DOM stand-in. `source` is the concatenated classic scripts. */
export const createScriptEngine = (source) => {
  if (cachedSource !== source) {
    cachedRun = compile(source);
    cachedSource = source;
  }
  const sandbox = scriptSandbox();
  cachedRun(sandbox);
  return sandbox;
};
