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

const footerLink = ([text, href, extra = ""]) => {
  if (text === "GitHub") return `<a class="text-link footer-github" href="${href}"${extra} aria-label="GitHub" title="GitHub"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.56 9.56 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.565 4.943.358.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z"/></svg></a>`;
  return `<a class="text-link" href="${href}"${extra}>${text}</a>`;
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
