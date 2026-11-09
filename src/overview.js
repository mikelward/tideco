// The overview's cards (SPEC.md §6.5), free of chrome.* so it tests in
// Node: each workspace with a window as a group, the one showing first,
// then the rest in bar order, and each window on it as a card with its
// picture or icon, its title and its app. Typing filters them with the
// launcher's fuzzy match.

import { appOf } from "./apps.js";
import { fuzzyScore } from "./launcher.js";
import { barOrder } from "./workspaces.js";

function host(url) {
  try {
    return new URL(url).host;
  } catch {
    // chrome:// and blank pages have no host worth naming
    return "";
  }
}

// What a card calls window `w`'s app: the app key's app it belongs to, by
// its site or by the key that opened it, else a browser window, else its
// site.
function appName(w, info, apps) {
  const tab = w.tabs?.find((t) => t.active) ?? w.tabs?.[0];
  const app = appOf(w, apps) ?? apps.find((a) => a.command === info.app);
  if (app?.name) return app.name;
  if (w.type === "normal") return "Browser window";
  return host(tab?.url || tab?.pendingUrl || "") || "App";
}

// The card for window `w`, as windows.getAll({populate: true}) gives it,
// whose place in tide's state is `info`. Without tab search or all-sites
// access Chrome hides a tab's title and icon, so the card has only its app.
export function card(w, info, { apps = [], pictures = {} } = {}) {
  const tab = w.tabs?.find((t) => t.active) ?? w.tabs?.[0];
  const app = appName(w, info, apps);
  const tabs = w.type === "normal" && (w.tabs?.length ?? 0) > 1 ? `${w.tabs.length} tabs` : null;
  const minimized = Boolean(info.minimizedByYou);
  // With no title, the app is the title, and isn't said twice.
  const title = tab?.title || "";
  return {
    id: w.id,
    title: title || app,
    app,
    detail: [title ? app : null, tabs, minimized ? "minimized" : null].filter(Boolean).join(" · "),
    icon: tab?.favIconUrl || null,
    picture: pictures[w.id]?.url ?? null,
    minimized,
  };
}

// A workspace's windows in card order: each display's in turn, as tide
// knows the displays, its tiles in stack order, then its floats; then any
// left over, such as one whose display went.
function ordered(state, name) {
  const ids = state.workspaces[name].windows.filter((id) => Object.hasOwn(state.windows, id));
  const out = [];
  for (const d of state.present) {
    const here = ids.filter((id) => (state.windows[id].display ?? state.present[0]) === d);
    out.push(...here.filter((id) => !state.windows[id].floating), ...here.filter((id) => state.windows[id].floating));
  }
  return [...out, ...ids.filter((id) => !out.includes(id))];
}

// The groups, from tide's `state` and Chrome's `windows`: [{name, current,
// cards}]. A workspace with no window that's open is left out, but the
// one showing never is.
export function groups({ state, windows = [], apps = [], pictures = {} }) {
  if (!state) return [];
  const open = new Map(windows.map((w) => [w.id, w]));
  const bar = barOrder(state);
  const names = [state.current, ...bar.filter((n) => n !== state.current)];
  const out = [];
  for (const name of names) {
    if (!Object.hasOwn(state.workspaces, name)) continue;
    const cards = ordered(state, name)
      .filter((id) => open.has(id))
      .map((id) => card(open.get(id), state.windows[id], { apps, pictures }));
    if (cards.length > 0 || name === state.current) out.push({ name, current: name === state.current, cards });
  }
  return out;
}

// Whether `c` matches `query`, by its title or its app.
export function matches(query, c) {
  const q = query.trim();
  return q === "" || fuzzyScore(q, c.title) !== null || fuzzyScore(q, c.app) !== null;
}

// The groups showing for `query`: their matching cards, and only groups
// with one, except the one showing while nothing is typed.
export function filtered(all, query) {
  const typed = query.trim() !== "";
  return all
    .map((g) => ({ ...g, cards: g.cards.filter((c) => matches(query, c)) }))
    .filter((g) => g.cards.length > 0 || (!typed && g.current));
}

// The cards showing, in order, which the arrows step through.
export const cardsOf = (shown) => shown.flatMap((g) => g.cards);

// The window selected among `cards`: `selected` if it's there, else the
// first, else null.
export function keep(cards, selected) {
  if (cards.some((c) => c.id === selected)) return selected;
  return cards[0]?.id ?? null;
}

// The window `by` cards from `selected`, stopping at either end.
export function step(cards, selected, by) {
  if (cards.length === 0) return null;
  const i = cards.findIndex((c) => c.id === selected);
  return cards[Math.min(cards.length - 1, Math.max(0, (i < 0 ? 0 : i) + by))].id;
}

// The window the overview starts on: the one you were in on the workspace
// showing.
export function focusedIn(state) {
  return state?.workspaces?.[state.current]?.focused ?? null;
}

// What the overview says it can't show, and why: titles need tab search or
// all-sites access, and pictures need all-sites access, the dim's (§14.1).
export function notes({ tabs = false, pictures = false } = {}) {
  const out = [];
  if (!tabs && !pictures) out.push("No titles: they need tab search");
  if (!pictures) out.push("No pictures: they need the dim's access");
  return out;
}
