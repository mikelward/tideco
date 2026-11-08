// The keys checklist (SPEC.md §3.4, §7.1): each tide command, the key the
// spec or a preset (§7.4) gives it, and the key Chrome has bound, if any.
// Chrome binds only the four suggested keys at install; the rest are set by hand at
// chrome://extensions/shortcuts, and this list says which are still to do.

// The key a manifest description names, in its closing parentheses.
export function intendedKey(description) {
  return /\(([^)]*)\)$/.exec(description ?? "")?.[1] ?? "";
}

// `manifest` is the manifest's `commands`; `bound` is commands.getAll()'s
// list of {name, shortcut}; `suggested` is a preset's suggestions
// (src/presets.js), by name, where the spec's key is left out. Returns a row
// per command, in manifest order: {name, title, intended, suggestion,
// bound, state}, where suggestion is the preset's {key, why, ...}, and state
// is "bound" (on the key suggested), "other" (bound to a different key) or
// "unbound".
export function checklist(manifest, bound, suggested = {}) {
  const shortcuts = new Map(bound.map((c) => [c.name, c.shortcut ?? ""]));
  return Object.entries(manifest).map(([name, c]) => {
    const suggestion = suggested[name] ?? { key: intendedKey(c.description), why: "spec" };
    const intended = suggestion.key;
    const key = shortcuts.get(name) ?? "";
    const title = (c.description ?? name).replace(/\s*\([^)]*\)$/, "");
    const state = !key ? "unbound" : sameKey(key, intended) ? "bound" : "other";
    return { name, title, intended, suggestion, bound: key, state };
  });
}

// Chrome reports chromeOS's Search key as "Search" and orders modifiers its
// own way, so keys compare as sets of parts.
function sameKey(a, b) {
  if (!a || !b) return false;
  const parts = (k) => new Set(k.split("+").map((p) => p.trim().toLowerCase()));
  const pa = parts(a);
  const pb = parts(b);
  return pa.size === pb.size && [...pa].every((p) => pb.has(p));
}
