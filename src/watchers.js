// The sites whose unread counts tide shows (SPEC.md §10.3), from the
// settings. Each needs its host permission, asked for on the options page,
// and gets the title watcher registered at runtime. A site without its
// permission on this Chromebook (settings sync, grants don't) is left out
// until it has one.

// Named for when it held only sites beyond Gmail, Chat and Calendar, and
// before tico became tide, then tide; kept, so an update replaces the script it
// registered (it persists across sessions).
export const WATCHER_ID = "tico-watch-extra";

// The match pattern for an origin: "https://example.com" -> "https://example.com/*".
export const pattern = (origin) => `${origin}/*`;

// The patterns to register, each site once.
export function watchPatterns(sites) {
  return [...new Set(sites.map(pattern))];
}

// Make the registered watcher match the granted sites. `api` is
// chrome. Returns the patterns now watched.
export async function syncWatchers(api, sites) {
  const granted = [];
  for (const p of watchPatterns(sites)) if (await api.permissions.contains({ origins: [p] })) granted.push(p);
  const [current] = await api.scripting.getRegisteredContentScripts({ ids: [WATCHER_ID] });
  const same = current && current.matches.length === granted.length && current.matches.every((m) => granted.includes(m));
  if (same || (!current && granted.length === 0)) return granted;
  if (current) await api.scripting.unregisterContentScripts({ ids: [WATCHER_ID] });
  if (granted.length > 0) {
    await api.scripting.registerContentScripts([
      { id: WATCHER_ID, matches: granted, js: ["src/unread_watch.js"], runAt: "document_idle", persistAcrossSessions: true },
    ]);
  }
  // A registered script runs on pages loaded from now on, so pages already
  // open on a newly watched site get the watcher now; it starts only once
  // per page, however often it's injected.
  const added = granted.filter((p) => !current?.matches.includes(p));
  if (added.length > 0) {
    for (const tab of await api.tabs.query({ url: added })) {
      try {
        await api.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/unread_watch.js"] });
      } catch (e) {
        // a discarded or closing tab gets the watcher when it next loads
        console.warn(`tide: couldn't watch tab ${tab.id} yet:`, e?.message ?? e);
      }
    }
  }
  return granted;
}

// Whether a page at `url` is on a site the settings name now. A page whose site was removed keeps its injected
// watcher until it reloads (unregistering doesn't remove it), so its
// reports are dropped here.
export function isWatched(url, sites) {
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    // a report with no page address isn't from a watched page
    return false;
  }
  return sites.includes(origin);
}

// `fn` run one call at a time, in the order called, so an older call
// can't finish after a newer one and undo it. A failure doesn't stop the
// calls after it.
export function serialized(fn) {
  let last = Promise.resolve();
  return (...args) => {
    const run = last.then(() => fn(...args));
    last = run.catch(() => {});
    return run;
  };
}
