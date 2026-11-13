// Float rules (SPEC.md §5.4), as tide for Linux's Floating page makes them
// (its SPEC.md §6.4, §16): each names a site, and that site's app windows
// open floating. Chrome shows no window class, so the site is the app, by
// its origin, as the app keys and unread counts know a site (§9.1, §10.3).
// An app window is an installed web app's (`type: "app"`) or one of the app
// popups tide opens for an app key; a tab window's site changes with its
// tabs, so no rule covers one. Pure functions; tide.js and the pages hold
// the windows and the storage.

// As many as tide for Linux takes.
export const MAX_RULES = 64;

// The site `raw` names, as typed or stored: {site}, its origin, or {error}.
// One typed without a scheme is taken as https, as is a host and port,
// such as example.com:8443, which siteName gives for one.
export function checkSite(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") return { error: "type a site's address, such as https://meet.google.com" };
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:(?!\d+(?:[/?#]|$))/i.test(text) ? text : `https://${text}`);
  } catch {
    return { error: `"${text}" isn't a site's address` };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { error: `"${text}" isn't a website` };
  return { site: url.origin };
}

// The rules as stored, checked for settings.js: a list of {site}, each a
// website, none twice, at most MAX_RULES. Each site becomes its origin.
export function checkFloating(rules) {
  if (!Array.isArray(rules)) throw new Error("must be a list");
  if (rules.length > MAX_RULES) throw new Error(`has ${rules.length} rules, more than ${MAX_RULES}`);
  const seen = new Set();
  return rules.map((r, i) => {
    const at = `rule ${i + 1}`;
    if (typeof r !== "object" || r === null || Array.isArray(r)) throw new Error(`${at} must be an object, like {"site": "https://meet.google.com"}`);
    const unknown = Object.keys(r).filter((k) => k !== "site");
    if (unknown.length > 0) throw new Error(`${at}: ${unknown.join(", ")} isn't site`);
    const { site, error } = checkSite(r.site);
    if (error) throw new Error(`${at}: ${error}`);
    if (seen.has(site)) throw new Error(`${at}: ${site} is listed already`);
    seen.add(site);
    return { site };
  });
}

// A site as the pages name it: an https one by its host,
// "meet.google.com", which checkSite reads back as the same site; any
// other by its origin.
export function siteName(site) {
  try {
    const url = new URL(site);
    return url.protocol === "https:" ? url.host : url.origin;
  } catch {
    // Not a URL: shown as it is.
    return String(site);
  }
}

// The site of window `win`'s active tab, by its origin, or null for a page
// that isn't a website or an address Chrome hides (no tab search). A tab
// still loading its first page has only the address it's going to.
export function siteOf(win) {
  const tab = win?.tabs?.find((t) => t.active) ?? win?.tabs?.[0];
  const url = tab?.url || tab?.pendingUrl || "";
  if (!/^https?:/.test(url)) return null;
  try {
    return new URL(url).origin;
  } catch {
    // An address Chrome gave that doesn't parse names no site.
    return null;
  }
}

// Whether a rule could cover window `win`: an installed web app's window,
// or one of the app popups tide opened (`appPopups`, a Set of IDs).
export function ruleable(win, appPopups) {
  return win?.type === "app" || appPopups.has(win?.id);
}

// The place (from 0) of the rule for `site` among `rules`, or -1.
export function coveringRule(rules, site) {
  return site === null ? -1 : rules.findIndex((r) => r.site === site);
}

// The windows to float now that the rules are `after` (SPEC.md §5.4): each
// of `windows`, {id, site, floating, big}, that `after` covers and `before`
// didn't, tiled now and neither maximized nor full screen (`big`). A window
// you tiled under a rule that covered it already stays tiled, and a list
// reordered, or a rule taken out, floats nothing and tiles nothing. With
// no `before`, none: nothing says what the windows met.
export function newlyCovered(windows, before, after) {
  if (!before) return [];
  return windows
    .filter((w) => !w.floating && !w.big && w.site !== null)
    .filter((w) => coveringRule(after, w.site) >= 0 && coveringRule(before, w.site) < 0)
    .map((w) => w.id);
}

// The rules with one for `raw` added at the end: {rules} or {error}.
export function withRule(rules, raw) {
  const { site, error } = checkSite(raw);
  if (error) return { error };
  if (coveringRule(rules, site) >= 0) return { error: `${siteName(site)} is listed already` };
  if (rules.length >= MAX_RULES) return { error: `there are ${MAX_RULES} rules already, as many as there can be` };
  return { rules: [...rules, { site }] };
}

// A change names its rule by place and site, so one made from a page that
// shows rules since changed elsewhere is refused, not built on.
const STALE = "the rules changed since this page showed them; try again";

export function movedRule(rules, index, site, step) {
  if (rules[index]?.site !== site) return { error: STALE };
  const to = index + step;
  if (to < 0 || to >= rules.length) return { rules };
  const out = [...rules];
  [out[index], out[to]] = [out[to], out[index]];
  return { rules: out };
}

export function withoutRule(rules, index, site) {
  if (rules[index]?.site !== site) return { error: STALE };
  return { rules: rules.filter((_, i) => i !== index) };
}

// The Floating page's Floating now (§13): the app windows floating that no
// rule covers, one per site, in the order given, each {id, site, title}.
// `state` is tide's stored state, which says which windows float; `windows`
// are Chrome's, with their tabs. A window whose site Chrome hides can't be
// named, so it isn't listed.
export function floatingNow(state, windows, rules) {
  const appPopups = new Set((state?.appPopups ?? []).map(Number));
  const out = [];
  for (const w of windows) {
    if (!state?.windows?.[w.id]?.floating || !ruleable(w, appPopups)) continue;
    const site = siteOf(w);
    if (site === null || coveringRule(rules, site) >= 0 || out.some((o) => o.site === site)) continue;
    const tab = w.tabs?.find((t) => t.active) ?? w.tabs?.[0];
    out.push({ id: w.id, site, title: tab?.title ?? "" });
  }
  return out;
}

// Asking to always float a window you floated with Search+Shift+F (§5.4),
// once per site until the browser restarts: whether to ask about `site`,
// and the sites asked about since, `asked`, to keep. Not for a site Chrome
// hides, one a rule covers, or one asked about already, whatever the
// answer.
export function askFloat(asked, rules, site) {
  const list = Array.isArray(asked) ? asked.filter((s) => typeof s === "string") : [];
  if (site === null || coveringRule(rules, site) >= 0 || list.includes(site)) return { ask: false, asked: list };
  return { ask: true, asked: [...list, site] };
}

// The question's window: small, in the bottom-right corner of the work
// area `area` ({left, top, width, height}), as a notification sits.
export const ASK_SIZE = { width: 420, height: 170 };
const ASK_MARGIN = 16;

export function askBounds(area) {
  const width = Math.min(ASK_SIZE.width, area.width);
  const height = Math.min(ASK_SIZE.height, area.height);
  return {
    left: Math.max(area.left, area.left + area.width - width - ASK_MARGIN),
    top: Math.max(area.top, area.top + area.height - height - ASK_MARGIN),
    width,
    height,
  };
}

// The question's words for `site`.
export function askText(site) {
  const name = siteName(site);
  return { title: `Always float ${name}?`, body: `New ${name} app windows will open floating.` };
}

// In storage.session: the sites asked about, and the site the Floating page
// fills its field with when Edit rule… opens it.
export const ASKED_KEY = "floatAsked";
export const FILL_KEY = "floatFill";
// The page that asks, under src/.
export const ASK_PAGE = "floatask.html";
