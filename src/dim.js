// The dim on unfocused windows (SPEC.md §10.1): a full-page black overlay,
// 10% by default, that ignores the pointer. `overlay` runs inside the page, through
// chrome.scripting, so it uses nothing from this module.

export function overlay(on, strength = 0.1) {
  // The old name, kept: pages still dimmed when tide updates hold this element.
  const ID = "tico-dim";
  const old = document.getElementById(ID);
  if (!on) {
    old?.remove();
    return;
  }
  const background = `rgba(0,0,0,${strength})`;
  if (old) {
    old.style.background = background;
    return;
  }
  const el = document.createElement("div");
  el.id = ID;
  el.style.cssText = `position:fixed;inset:0;background:${background};pointer-events:none;z-index:2147483647`;
  document.documentElement.append(el);
}
