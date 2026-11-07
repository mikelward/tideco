// Matching windows across a browser restart (SPEC.md §14.2), which gives
// every window a new ID. Each old window is known by its tabs' URLs; each new
// one takes the place of the old one it shares the most URLs with.

// `old` maps old window IDs to their URLs; `current` lists the new windows as
// {id, urls}. Returns a Map from old ID to new ID, best matches first, each
// window used once, and only where they share a URL.
export function matchWindows(old, current) {
  const pairs = [];
  for (const [oldId, oldUrls] of Object.entries(old)) {
    const urls = new Set(oldUrls ?? []);
    for (const w of current) {
      // Both sides as sets, so a window with the same page open twice
      // doesn't outscore an exact match.
      const theirs = new Set(w.urls);
      let shared = 0;
      for (const u of theirs) if (urls.has(u)) shared++;
      if (shared > 0) pairs.push({ from: Number(oldId), to: w.id, shared, extra: theirs.size + urls.size - 2 * shared });
    }
  }
  // Most shared URLs first; then the closest fit, so a window that only
  // shares one tab of many doesn't win over an exact match.
  pairs.sort((a, b) => b.shared - a.shared || a.extra - b.extra);
  const renames = new Map();
  const taken = new Set();
  for (const p of pairs) {
    if (renames.has(p.from) || taken.has(p.to)) continue;
    renames.set(p.from, p.to);
    taken.add(p.to);
  }
  return renames;
}

// The URLs tide remembers for a window: its tabs', at most `limit`.
export function windowUrls(win, limit = 20) {
  return (win.tabs ?? []).map((t) => t.url ?? t.pendingUrl).filter(Boolean).slice(0, limit);
}
