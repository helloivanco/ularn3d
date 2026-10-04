/** Minimal DOM for the classic engine. Display only; game rules never read it back. */

const element = (id = "") => {
  const node = {
    id,
    nodeType: 1,
    style: {},
    className: "",
    innerHTML: "",
    textContent: "",
    value: "",
    disabled: false,
    hidden: false,
    dataset: {},
    children: [],
    childNodes: [],
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      },
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute(name, value) {
      node[name] = value;
    },
    getAttribute(name) {
      return node[name] ?? null;
    },
    appendChild(child) {
      node.children.push(child);
      node.childNodes.push(child);
      return child;
    },
    removeChild(child) {
      node.children = node.children.filter((item) => item !== child);
      return child;
    },
    replaceChildren() {
      node.children = [];
      node.childNodes = [];
    },
    focus() {},
    blur() {},
    click() {},
    remove() {},
    querySelector() {
      return element();
    },
    querySelectorAll() {
      return [];
    },
    getElementsByTagName() {
      return [];
    },
    getBoundingClientRect() {
      return { x: 0, y: 0, width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 };
    },
    getContext() {
      return {
        canvas: node,
        font: "",
        fillStyle: "",
        fillRect() {},
        clearRect() {},
        fillText() {},
        measureText() {
          return { width: 8 };
        },
        beginPath() {},
        stroke() {},
        moveTo() {},
        lineTo() {},
        arc() {},
        save() {},
        restore() {},
      };
    },
  };
  return node;
};

export const createHeadlessDom = () => {
  const byId = new Map();
  const body = element("body");
  const root = element("html");
  root.clientWidth = 1440;
  root.clientHeight = 900;
  const document = {
    body,
    documentElement: root,
    title: "Ularn",
    hidden: false,
    visibilityState: "visible",
    readyState: "complete",
    fonts: {
      load: async () => [],
      ready: Promise.resolve(),
    },
    head: element("head"),
    createElement: (tag) => element(tag),
    createTextNode: (text) => ({ textContent: text, nodeType: 3 }),
    getElementById: (id) => {
      if (!byId.has(id)) byId.set(id, element(id));
      return byId.get(id);
    },
    querySelector: () => element(),
    querySelectorAll: () => [],
    getElementsByTagName: (tag) => (tag === "body" ? [body] : []),
    addEventListener() {},
    removeEventListener() {},
  };
  for (const id of ["LARN", "FOOTER", "HELP", "STATS", "ACTIONS", "RUN", "KEYPAD", "CONTEXT", "KEYBOARD", "FAIL", "ALL"]) {
    byId.set(id, element(id));
  }
  const location = {
    hostname: "play.ularn.test",
    protocol: "http:",
    href: "http://play.ularn.test/play/",
    search: "",
    hash: "",
    pathname: "/play/",
  };
  const storageMap = new Map();
  function Storage() {}
  Storage.prototype.getItem = function getItem(key) {
    return storageMap.has(key) ? storageMap.get(key) : null;
  };
  Storage.prototype.setItem = function setItem(key, value) {
    storageMap.set(String(key), String(value));
  };
  Storage.prototype.removeItem = function removeItem(key) {
    storageMap.delete(key);
  };
  Storage.prototype.clear = function clear() {
    storageMap.clear();
  };
  Storage.prototype.key = function key(index) {
    return [...storageMap.keys()][index] ?? null;
  };
  const localStorage = new Storage();
  const navigator = {
    userAgent: "UlarnHeadless",
    cookieEnabled: true,
    onLine: true,
    platform: "Linux",
    maxTouchPoints: 0,
    language: "en-US",
    sendBeacon() {
      return true;
    },
  };
  const window = {
    document,
    location,
    navigator,
    localStorage,
    sessionStorage: localStorage,
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 1,
    history: { replaceState() {}, pushState() {} },
    screen: { width: 1440, height: 900 },
    getComputedStyle: () => ({
      width: "800px",
      height: "600px",
      lineHeight: "16px",
      fontSize: "16px",
      getPropertyValue: () => "",
    }),
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    scrollTo() {},
    alert() {},
    confirm: () => false,
    prompt: () => "",
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
  };
  return { document, window, location, navigator, localStorage, Storage, body };
};
