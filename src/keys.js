// The keys checklist (SPEC.md §3.4, §7.1): each tide command, the key the
// spec gives it, and the key Chrome has bound, if any. Chrome binds only the
// four suggested keys at install; the rest are set by hand at
// chrome://extensions/shortcuts, and this list says which are still to do.

// The key a manifest description names, in its closing parentheses.
export function intendedKey(description) {
  return /\(([^)]*)\)$/.exec(description ?? "")?.[1] ?? "";
}

// `manifest` is the manifest's `commands`; `bound` is commands.getAll()'s
// list of {name, shortcut}. Returns a row per command, in manifest order:
// {name, title, intended, bound, state}, where state is "bound", "other"
// (bound to a different key) or "unbound".
export function checklist(manifest, bound) {
  const shortcuts = new Map(bound.map((c) => [c.name, c.shortcut ?? ""]));
  return Object.entries(manifest).map(([name, c]) => {
    const intended = intendedKey(c.description);
    const key = shortcuts.get(name) ?? "";
    const title = (c.description ?? name).replace(/\s*\([^)]*\)$/, "");
    const state = !key ? "unbound" : sameKey(key, intended) ? "bound" : "other";
    return { name, title, intended, bound: key, state };
  });
}

// Chrome reports chromeOS's Search key as "Search" and orders modifiers its
// own way, so keys compare as sets of parts.
function sameKey(a, b) {
  const parts = (k) => new Set(k.split("+").map((p) => p.trim().toLowerCase()));
  const pa = parts(a);
  const pb = parts(b);
  return pa.size === pb.size && [...pa].every((p) => pb.has(p));
}
