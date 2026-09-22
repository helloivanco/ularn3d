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
