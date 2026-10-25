"use client";

import { useEffect, useState } from "react";

export interface FavoriteIdsResult {
  authenticated: boolean;
  venueIds: string[];
}

/**
 * Shared one-shot fetch of GET /api/me/favorites.
 *
 * Public pages render favorite state as "off" (their data is cached
 * without user context); every heart/button on the page hydrates from
 * this single module-level promise, so N cards still cause ONE request
 * per page load. A failed fetch resolves to the anonymous shape (hearts
 * stay off) — hydration must never break the page.
 */
let sharedPromise: Promise<FavoriteIdsResult> | null = null;

export function fetchFavoriteIds(): Promise<FavoriteIdsResult> {
  if (!sharedPromise) {
    sharedPromise = fetch("/api/me/favorites")
      .then(async (r) => {
        if (!r.ok) throw new Error(`favorites fetch failed: ${r.status}`);
        return (await r.json()) as FavoriteIdsResult;
      })
      .catch(() => ({ authenticated: false, venueIds: [] }));
  }
  return sharedPromise;
}

/** Resolved favorites for this page, or `null` while the fetch is in flight. */
export function useFavoriteIds(): FavoriteIdsResult | null {
  const [result, setResult] = useState<FavoriteIdsResult | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchFavoriteIds().then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return result;
}
