"use client";

import { useEffect } from "react";

/**
 * Deep-link support for review citations (#review-<id>).
 *
 * The venue page's HTML is streamed, so on a cross-page navigation
 * the browser's native fragment scroll fires before the anchored
 * review article has been parsed/hydrated — and the user lands at
 * the top of a long page instead of on the cited review (verified
 * in tests/e2e/assistant-citation.spec.ts). On mount, if the URL
 * carries a #review- fragment, scroll the element into view
 * explicitly; its `scroll-mt-24` class keeps it clear of the sticky
 * header. Same-document hash changes are left to the browser.
 */
export default function ReviewAnchorScroll() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#review-")) return;
    const el = document.getElementById(hash.slice(1));
    if (el) el.scrollIntoView({ block: "start" });
  }, []);
  return null;
}
