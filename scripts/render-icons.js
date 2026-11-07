// Renders icons/tide.svg to the PNG sizes the manifest names, and
// icons/tide-alt.svg at 128 px, with the Chromium the smoke test uses:
// `make icons` after changing an SVG.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ICONS = fileURLToPath(new URL("../icons/", import.meta.url));
const SIZES = [16, 32, 48, 128];

// tide-alt.svg is an alternative design, kept at full size only.
const ICON_SIZES = { tide: SIZES, "tide-alt": [128] };

const browser = await chromium.launch();
try {
  for (const [name, sizes] of Object.entries(ICON_SIZES)) {
    const svg = await readFile(`${ICONS}${name}.svg`, "utf8");
    for (const size of sizes) {
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      const sized = svg.replace(/width="128" height="128"/, `width="${size}" height="${size}"`);
      await page.setContent(`<html><body style="margin:0;background:transparent">${sized}</body></html>`);
      await page.screenshot({ path: `${ICONS}${name}-${size}.png`, omitBackground: true });
      await page.close();
    }
  }
} finally {
  await browser.close();
}
