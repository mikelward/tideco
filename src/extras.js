// The extras that need a permission (SPEC.md §14.1): tiling needs none of
// them. The settings list them all; the dashboard offers the ones still off,
// until you dismiss it. Chrome asks for each only from a click.

import { SETTINGS_KEY } from "./settings.js";
import { DEFAULT_SITES } from "./unread.js";
import { pattern } from "./watchers.js";

export const DISMISSED_KEY = "extrasDismissed";

export const EXTRAS = [
  {
    id: "tabs",
    title: "Find any tab in a keystroke",
    how: "Press Search+Space, type a few letters, and jump to that tab. tide also puts your windows back on their workspaces after Chrome restarts, and tiles Secure Shell's windows. Chrome calls this “read your browsing history”.",
    access: { permissions: ["tabs"] },
    // Tab search works off chromeOS too; the rest is chromeOS's.
    untiled: "Open the dashboard, type a few letters, and jump to that tab. Chrome calls this “read your browsing history”.",
  },
  {
    id: "unread",
    title: "Show unread counts for Gmail, Chat and Calendar",
    how: "Highlight a window when new mail or messages arrive. tide reads only the page title. Add other sites under Unread counts in the settings.",
    access: { origins: DEFAULT_SITES.map(pattern) },
  },
  {
    id: "dim",
    title: "Dim inactive windows",
    how: "Darken the windows you're not using. Chrome calls this “read and change all your data on all websites”; tide only lays a shade over each page.",
    access: { origins: ["<all_urls>"] },
  },
];

// The extras on a platform that tiles, or doesn't (§14.6). Unread counts and
// the dim mark and shade windows tileco manages, so they're chromeOS's alone.
export function extrasFor(tiling, extras = EXTRAS) {
  return tiling ? extras : extras.filter((e) => e.untiled).map((e) => ({ ...e, how: e.untiled }));
}

// Whether Gmail, Chat and Calendar are all in the stored unread counts list;
// `stored` is the shared settings as stored, or undefined for the defaults.
export function hasDefaultSites(stored) {
  const sites = Array.isArray(stored?.watched) ? stored.watched : DEFAULT_SITES;
  return DEFAULT_SITES.every((s) => sites.includes(s));
}

// Puts Gmail, Chat and Calendar back in the shared list, if you'd removed
// any. `storage` is chrome.storage.
export async function addDefaultSites(storage) {
  const stored = (await storage.sync.get(SETTINGS_KEY))[SETTINGS_KEY];
  if (hasDefaultSites(stored)) return;
  const settings = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  const sites = Array.isArray(settings.watched) ? settings.watched : [];
  await storage.sync.set({ [SETTINGS_KEY]: { ...settings, watched: [...sites, ...DEFAULT_SITES.filter((s) => !sites.includes(s))] } });
}

// Whether `extra` is on: its access allowed and, for unread counts, its
// sites in the list. `api` is chrome.
export async function isOn(api, extra) {
  if (!(await api.permissions.contains(extra.access))) return false;
  if (extra.id !== "unread") return true;
  return hasDefaultSites((await api.storage.sync.get(SETTINGS_KEY))[SETTINGS_KEY]);
}
