// The bar's background in light and dark mode (SPEC.md §8.1), as tide's
// appearance.json has it (lightBarColor, darkBarColor): a color as #rrggbb
// or #rgb, or null for the page's own. The bar's text stays the mode's, so
// a color must contrast with it by at least BAR_CONTRAST, WCAG's AAA.

export const BAR_CONTRAST = 7;

// The mode's text color (launcher.css's --fg), and the bar's own color
// without its transparency, which the options page shows for Default.
export const TEXT = Object.freeze({ light: "#1e1e1e", dark: "#f6f5f4" });
export const DEFAULT_BAR = Object.freeze({ light: "#ffffff", dark: "#101214" });

// `v` as #rrggbb in lower case, or "" when it isn't #rrggbb or #rgb.
export function hexColor(v) {
  if (typeof v !== "string") return "";
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${[...v.slice(1)].map((c) => c + c).join("")}`.toLowerCase();
  return "";
}

// The WCAG contrast ratio of two #rrggbb colors, from 1 to 21.
export function contrast(a, b) {
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Checks lightBarColor (`dark` false) or darkBarColor: null, or a color the
// mode's text reads on, as #rrggbb.
export function checkBarColor(dark) {
  return (v) => {
    if (v === null) return null;
    const c = hexColor(v);
    if (c === "") throw new Error('must be a color as #rrggbb or #rgb, such as "#1a1d2e", or null');
    if (contrast(c, dark ? TEXT.dark : TEXT.light) < BAR_CONTRAST) {
      throw new Error(`is too ${dark ? "light" : "dark"} for the bar's text; choose a ${dark ? "darker" : "lighter"} color`);
    }
    return c;
  };
}
