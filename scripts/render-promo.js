// Renders the Chrome Web Store's promo tiles, store/promo-*.svg, and its
// screenshots, store/screenshot-*.html, to PNG at the sizes the store asks
// for (PUBLISHING.md §3), with the Chromium the smoke test uses and Inter
// from Google Fonts: `make promo` after changing one. They're the store's
// alone, so they stay out of the ZIP.

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const STORE = fileURLToPath(new URL("../store/", import.meta.url));
const TILES = { "promo-small": [440, 280], "promo-marquee": [1400, 560] };
const FONT = "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=block";

// Fails unless Inter's faces at these weights were registered and loaded.
// document.fonts.check alone is true when no Inter face exists at all, as
// when the stylesheet couldn't load offline, so it can't catch a fallback.
async function requireInter(page, what, weights) {
  const missing = await page.evaluate(async (weights) => {
    await document.fonts.ready;
    const out = [];
    for (const w of weights) {
      const faces = await document.fonts.load(`${w} 16px Inter`);
      if (!faces.some((f) => f.family.replace(/["']/g, "") === "Inter" && f.status === "loaded")) out.push(w);
    }
    return out;
  }, weights);
  if (missing.length > 0) throw new Error(`${what}: Inter ${missing.join(", ")} didn't load, so it would use a fallback font`);
}

const browser = await chromium.launch();
try {
  for (const [name, [width, height]] of Object.entries(TILES)) {
    const svg = await readFile(`${STORE}${name}.svg`, "utf8");
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(`<html><head><link rel="stylesheet" href="${FONT}"></head><body style="margin:0">${svg}</body></html>`);
    await requireInter(page, name, [400, 700]);
    await page.screenshot({ path: `${STORE}${name}.png` });
    await page.close();
  }
  // Every screenshot is 1280x800, the size the store takes.
  for (const file of (await readdir(STORE)).filter((f) => /^screenshot-.*\.html$/.test(f))) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`file://${STORE}${file}`);
    await requireInter(page, file, [400, 500, 600, 700]);
    // The pointer starts at the corner, over the bar's logo, which would
    // show its hover; park it over the windows instead.
    await page.mouse.move(640, 600);
    await page.screenshot({ path: `${STORE}${file.replace(/\.html$/, ".png")}` });
    await page.close();
  }
} finally {
  await browser.close();
}
