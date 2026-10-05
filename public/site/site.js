const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const show = (node) => node.classList.add("is-visible");

if (!prefersReduced) {
  const nodes = document.querySelectorAll(".reveal");
  if (nodes.length && "IntersectionObserver" in window) {
    const rootMargin = "0px 0px -8% 0px";
    const watch = (threshold) => {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            show(entry.target);
            observer.unobserve(entry.target);
          }
        },
        { rootMargin, threshold }
      );
      return observer;
    };
    const nearby = watch(0.15);
    // 15% of a section taller than the window can never intersect, so it stayed at opacity 0.
    const tall = watch(0);
    const limit = window.innerHeight * 0.92;
    for (const node of nodes) {
      const tooTall = node.getBoundingClientRect().height * 0.15 > limit;
      (tooTall ? tall : nearby).observe(node);
    }
  } else {
    for (const node of nodes) show(node);
  }
} else {
  for (const node of document.querySelectorAll(".reveal")) show(node);
}
