const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (!prefersReduced) {
  const nodes = document.querySelectorAll(".reveal");
  if (nodes.length && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.15 }
    );
    for (const node of nodes) observer.observe(node);
  } else {
    for (const node of nodes) node.classList.add("is-visible");
  }
} else {
  for (const node of document.querySelectorAll(".reveal")) node.classList.add("is-visible");
}
