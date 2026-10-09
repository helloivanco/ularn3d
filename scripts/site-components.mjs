/** Shared marketing chrome. Expanded in dev and in the production HTML. */

const parseAttrs = (source) => {
  const attrs = {};
  for (const match of String(source).matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
};

const currentAttr = (current, page) => (current === page ? ' aria-current="page"' : "");

export const renderSiteHeader = ({ variant = "", current = "" } = {}) => {
  const hero = variant === "hero" ? " site-header--hero" : "";
  return `<header class="site-header${hero}">
      <a class="brand" href="/" aria-label="Ularn 3D home">
        <img src="/favicon.svg" width="38" height="38" alt="" />
        <span class="brand-word">ULARN 3D<small>THE CAVES BELOW</small></span>
      </a>
      <nav class="site-nav" aria-label="Main">
        <a class="text-link" href="/about/"${currentAttr(current, "about")}>About</a>
        <a class="text-link" href="/changelog/"${currentAttr(current, "changelog")}>What’s New</a>
        <a class="nav-cta" href="/play/">Play <span aria-hidden="true">↗</span></a>
        <a
          class="nav-cta nav-cta--secondary web-only"
          href="/downloads/Ularn.windows.exe"
          aria-label="Download Ularn 3D for Windows"
          >Download for Windows</a
        >
      </nav>
    </header>`;
};

const FOOTER_LINKS = {
  home: [
    ["Play", "/play/"],
    ["About", "/about/"],
    ["What’s New", "/changelog/"],
    ["GitHub", "https://github.com/helloivanco/ularn3d", ' rel="noopener noreferrer"'],
    ["Windows", "/downloads/Ularn.windows.exe", ' class="web-only"', true],
  ],
  about: [
    ["Play", "/play/"],
    ["What’s New", "/changelog/"],
    ["History", "#history"],
    ["GitHub", "https://github.com/helloivanco/ularn3d", ' rel="noopener noreferrer"'],
    ["Top ↑", "#guide"],
  ],
  changelog: [
    ["Play", "/play/"],
    ["About", "/about/"],
    ["What’s New", "/changelog/"],
    ["GitHub", "https://github.com/helloivanco/ularn3d", ' rel="noopener noreferrer"'],
    ["Releases", "https://github.com/helloivanco/ularn3d/releases", ' rel="noopener noreferrer"'],
  ],
};

const footerLink = ([text, href, extra = "", webOnly = false]) => {
  const classes = ["text-link"];
  if (webOnly) classes.push("web-only");
  const attrs = extra.replace(' class="web-only"', "");
  return `<a class="${classes.join(" ")}" href="${href}"${attrs}>${text}</a>`;
};

export const renderSiteFooter = ({ page = "" } = {}) => {
  const links = FOOTER_LINKS[page];
  if (!links) throw new Error(`Unknown site footer page: ${page || "(missing)"}`);
  return `<footer class="site-footer wrap">
      <a class="footer-brand" href="/">ULARN 3D</a>
      <p class="footer-copy">
        Free dungeon crawler.
        <a class="text-link" href="/engine/LICENSE">License</a>.
      </p>
      <p class="footer-version">
        <a href="/changelog/" aria-label="Ularn 3D version v__APP_VERSION__, see what’s new">v__APP_VERSION__</a>
      </p>
      <nav aria-label="Footer">
        ${links.map(footerLink).join("\n        ")}
      </nav>
    </footer>`;
};

const expandTag = (html, name, render) =>
  html.replace(new RegExp(`<site-${name}\\b([^>]*)>\\s*</site-${name}>`, "g"), (_, attrs) => render(parseAttrs(attrs)));

/** Replace header and footer tags with one shared copy of each. */
export const expandSiteComponents = (html) =>
  expandTag(expandTag(html, "header", renderSiteHeader), "footer", renderSiteFooter);
