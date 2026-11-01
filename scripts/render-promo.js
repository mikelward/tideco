// Renders the Chrome Web Store's promo tiles, store/promo-*.svg, to PNG at
// the sizes the store asks for (PUBLISHING.md §3), with the Chromium the
// smoke test uses and Inter from Google Fonts: `make promo` after changing
// one. They're the store's alone, so they stay out of the ZIP.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const STORE = fileURLToPath(new URL("../store/", import.meta.url));
const TILES = { "promo-small": [440, 280], "promo-marquee": [1400, 560] };
const FONT = "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=block";

const browser = await chromium.launch();
try {
  for (const [name, [width, height]] of Object.entries(TILES)) {
    const svg = await readFile(`${STORE}${name}.svg`, "utf8");
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(`<html><head><link rel="stylesheet" href="${FONT}"></head><body style="margin:0">${svg}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    if (!(await page.evaluate(() => document.fonts.check("700 56px Inter")))) {
      throw new Error(`${name}: Inter didn't load, so the tile would use a fallback font`);
    }
    await page.screenshot({ path: `${STORE}${name}.png` });
    await page.close();
  }
} finally {
  await browser.close();
}
