import { useCallback, useEffect, useState } from 'react';

/**
 * Renders a long list a page at a time: the first `step` items, then `step` more whenever the end
 * of what is rendered comes within reach of the list's scroll box. A district with 2,000 issues
 * then mounts tens of rows, not thousands, and a keystroke in the search re-renders tens too.
 *
 * Put `<li ref={sentinel} aria-hidden />` after the rows while `more` is true; it must be a direct
 * child of the scrolling element. Changing `resetKey` (a filter, a sort, a tab) starts over.
 */
export function useProgressive<T>(items: T[], resetKey: unknown, step = 50) {
  const [limit, setLimit] = useState(step);
  const [key, setKey] = useState(resetKey);
  if (key !== resetKey) {
    // Adjusting state while rendering, as React recommends for "reset when a prop changes".
    setKey(resetKey);
    setLimit(step);
  }
  const more = items.length > limit;

  const [node, setNode] = useState<HTMLElement | null>(null);
  const sentinel = useCallback((el: HTMLElement | null) => setNode(el), []);
  useEffect(() => {
    if (!node || !more || typeof IntersectionObserver === 'undefined') return;
    // Observing again after each page makes it report again if the end is still in reach.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((n) => n + step);
      },
      { root: node.parentElement, rootMargin: '0px 0px 800px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, more, limit, step]);

  return { shown: more ? items.slice(0, limit) : items, more, sentinel };
}
