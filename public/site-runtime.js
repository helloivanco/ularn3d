const desktop = location.protocol === "ularn:";
document.documentElement.dataset.runtime = desktop ? "desktop" : "web";
if (desktop) {
  const begin = document.getElementById("begin");
  for (const node of begin?.childNodes || []) {
    if (node.nodeType === Node.TEXT_NODE)
      node.textContent = node.textContent.replace("Play in browser", "Begin expedition");
  }
  // Keep the desktop shell focused on the game rather than the marketing home.
  for (const link of document.querySelectorAll('a.brand[href="/"]')) {
    link.setAttribute("href", "/play/");
  }
}
const windowsVersion = document.getElementById("windows-download-version");
if (!desktop && windowsVersion) {
  fetch("/api/windows-download?file=info", { signal: AbortSignal.timeout(8000) })
    .then(response => response.ok ? response.json() : null)
    .then(info => {
      if (!info || !/^\d+\.\d+\.\d+$/.test(info.version)) return;
      const filename = `Ularn-${info.version}.windows.exe`;
      const url = `https://github.com/helloivanco/ularn3d/releases/download/v${info.version}/${filename}`;
      if (info.filename !== filename || info.url !== url) return;
      const card = windowsVersion.closest("a");
      // Pin the link to the displayed release, even if a newer release is
      // published while this page or its metadata response remains cached.
      card.href = url;
      card.setAttribute("aria-label", `Download Ularn 3D for Windows, version ${info.version}`);
      windowsVersion.textContent = `v${info.version} · `;
      windowsVersion.hidden = false;
    })
    .catch(() => {});
}
