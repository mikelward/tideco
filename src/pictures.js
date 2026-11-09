// Pictures of windows for the overview (SPEC.md §6.5). Chrome captures a
// window only while it shows (tabs.captureVisibleTab captures its active
// tab's surface), and tide parks other workspaces' windows by minimizing
// them, so each window's latest picture is taken while it shows and kept,
// shrunk, in storage.session, where the overview page reads it. A window
// with none shows its icon.
//
// captureVisibleTab needs all-sites access, the dim's (§10.1); tide asks
// for nothing more. Chrome allows two captures a second
// (MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND), so they're spaced out.

// The access a capture needs: `<all_urls>`, or activeTab, which lasts only
// for a tab you clicked tide's button in (permissions_data.cc,
// CanCaptureVisiblePage).
export const ACCESS = { origins: ["<all_urls>"] };
// Chrome's limit is two a second; a little more apart leaves room.
export const CAPTURE_GAP = 600;
// A shown window's picture is taken again once it's this old.
export const FRESH = 15_000;
// How wide a picture is kept, in pixels: a card is at most about 400 wide.
export const PICTURE_WIDTH = 480;

const PREFIX = "picture:";

// Window `id`'s picture's key in storage.session: {url, at}, `url` a JPEG
// data URL and `at` when it was taken.
export const pictureKey = (id) => `${PREFIX}${id}`;

// The pictures among storage.session's `items`, by window ID.
export function picturesIn(items) {
  const out = {};
  for (const [key, value] of Object.entries(items ?? {})) {
    if (key.startsWith(PREFIX) && typeof value?.url === "string") out[key.slice(PREFIX.length)] = value;
  }
  return out;
}

// A JPEG data URL `width` pixels wide at most, from data URL `raw`, using
// what a service worker has: no DOM, so OffscreenCanvas.
export async function shrink(raw, width = PICTURE_WIDTH) {
  const [, b64] = raw.split(",", 2);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes]));
  try {
    const scale = Math.min(1, width / bitmap.width);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    const out = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg", quality: 0.75 })).arrayBuffer());
    let s = "";
    for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
    return `data:image/jpeg;base64,${btoa(s)}`;
  } finally {
    bitmap.close();
  }
}

// A timer that doesn't keep Node's tests running; in Chrome, setTimeout's.
function defaultLater(f, ms) {
  const t = setTimeout(f, ms);
  t?.unref?.();
}

export class Pictures {
  // `api` is chrome; the clock, timer and shrinking are the tests' to
  // replace.
  constructor(api, { now = () => Date.now(), later = defaultLater, shrink: shrinkWith = shrink } = {}) {
    this.api = api;
    this.now = now;
    this.later = later;
    this.shrink = shrinkWith;
    // When the last capture was asked for, and each window's.
    this.last = -Infinity;
    this.taken = new Map();
    // Windows waiting for a picture, in turn, and whether one's turn is
    // set.
    this.queue = [];
    this.waiting = false;
    this.shown = () => false;
    // Windows whose capture failed once, which then log at debug level.
    this.failed = new Set();
    // Whether `taken` has the pictures an earlier worker kept: Chrome
    // stops an idle worker, and storage.session outlives it.
    this.loaded = false;
  }

  // Take window `id`'s picture now, if Chrome's limit allows: "taken",
  // "busy" (too soon after the last), or "failed".
  async take(id) {
    const t = this.now();
    if (t - this.last < CAPTURE_GAP) return "busy";
    this.last = t;
    this.taken.set(id, t);
    try {
      const raw = await this.api.tabs.captureVisibleTab(id, { format: "jpeg", quality: 80 });
      const url = await this.shrink(raw);
      await this.api.storage.session.set({ [pictureKey(id)]: { url, at: t } });
      return "taken";
    } catch (e) {
      // chrome:// pages, the Web Store and other extensions' pages refuse,
      // every time: such a window keeps its icon. Its first refusal warns,
      // the rest are debug.
      const log = this.failed.has(id) ? console.debug : console.warn;
      log(`tide: couldn't take window ${id}'s picture; it shows its icon:`, e?.message ?? e);
      this.failed.add(id);
      return "failed";
    }
  }

  // Take the pictures of windows `ids` that are older than FRESH, one per
  // turn, CAPTURE_GAP apart. `shown(id)` says, at its turn, whether a window
  // still shows: one hidden since has nothing to capture.
  refresh(ids, shown) {
    this.shown = shown;
    const t = this.now();
    for (const id of ids) {
      if (this.queue.includes(id) || t - (this.taken.get(id) ?? -Infinity) < FRESH) continue;
      this.queue.push(id);
    }
    this.schedule();
  }

  schedule() {
    if (this.waiting || this.queue.length === 0) return;
    this.waiting = true;
    const wait = Math.max(0, this.last + CAPTURE_GAP - this.now());
    this.later(() => this.next().catch((e) => console.error("tide: couldn't take the next window's picture:", e)), wait);
  }

  async next() {
    this.waiting = false;
    const id = this.queue.shift();
    // A capture tide took in between, before a switch, used this turn.
    if (id !== undefined && this.shown(id) && (await this.take(id)) === "busy") this.queue.unshift(id);
    this.schedule();
  }

  // Forget the pictures of windows not in `alive`, which have closed.
  async forget(alive) {
    if (!this.loaded) {
      this.loaded = true;
      const kept = picturesIn(await this.api.storage.session.get(null));
      for (const [id, { at }] of Object.entries(kept)) {
        if (!this.taken.has(Number(id))) this.taken.set(Number(id), at ?? -Infinity);
      }
    }
    const gone = [...this.taken.keys()].filter((id) => !alive.has(id));
    if (gone.length === 0) return;
    for (const id of gone) {
      this.taken.delete(id);
      this.failed.delete(id);
    }
    this.queue = this.queue.filter((id) => alive.has(id));
    await this.api.storage.session.remove(gone.map(pictureKey));
  }
}
