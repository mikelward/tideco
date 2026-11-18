// What the worker did lately, for Report a bug (SPEC.md §14.7): its log
// lines, and every workspace and focus change with its cause. Each is a
// ring buffer, newest last, kept in chrome.storage.session too, since MV3
// stops an idle worker (§14.2) and the change you're reporting may be from
// before it slept. The browser closing empties it.

export const LOG_KEY = "recentLog";
export const CHANGES_KEY = "recentChanges";
// More than a report takes (bugreport.js), so a slow report still has its
// span.
export const LIMIT = 200;
export const KEEP = 15 * 60_000;
// A log line past this is cut, so one huge object can't fill the buffer.
const LINE = 1000;

export class Recent {
  // `storage` is chrome.storage.session, or null to keep it in memory only;
  // `warn` says a write failed, and must not write to this buffer itself.
  constructor(storage, key, { limit = LIMIT, keep = KEEP, now = () => Date.now(), warn = console.warn } = {}) {
    this.storage = storage;
    this.key = key;
    this.limit = limit;
    this.keep = keep;
    this.now = now;
    this.warn = warn;
    this.items = [];
    this.writing = null;
    this.dirty = false;
    // What an earlier worker kept goes before anything this one adds.
    this.loaded = !storage
      ? Promise.resolve()
      : storage.get(key).then(
        (stored) => {
          const kept = Array.isArray(stored?.[key]) ? stored[key] : [];
          this.items = [...kept, ...this.items];
          this.prune();
        },
        (e) => this.warn(`tide: couldn't read the recent ${key} an earlier worker kept:`, e),
      );
  }

  // Once what an earlier worker kept is in.
  ready() {
    return this.loaded;
  }

  // Records `text` now, with `extra` fields; returns the write's promise.
  add(text, extra = {}) {
    this.items.push({ t: this.now(), text: String(text).slice(0, LINE), ...extra });
    this.prune();
    return this.save();
  }

  // The entries from time `t` on, oldest first.
  since(t) {
    this.prune();
    return this.items.filter((e) => e.t >= t).map((e) => ({ ...e }));
  }

  prune() {
    const oldest = this.now() - this.keep;
    let drop = Math.max(0, this.items.length - this.limit);
    while (drop < this.items.length && this.items[drop].t < oldest) drop++;
    if (drop > 0) this.items.splice(0, drop);
  }

  // One write at a time; what's added meanwhile goes in one more.
  save() {
    this.dirty = true;
    if (!this.storage) return Promise.resolve();
    if (this.writing) return this.writing;
    this.writing = (async () => {
      await this.loaded;
      while (this.dirty) {
        this.dirty = false;
        try {
          await this.storage.set({ [this.key]: this.items });
        } catch (e) {
          // The entries stay in memory; the next add tries again.
          this.warn(`tide: couldn't keep the recent ${this.key} for a restarted worker:`, e);
          return;
        }
      }
    })().finally(() => {
      this.writing = null;
    });
    return this.writing;
  }

  // The write under way, if any.
  flush() {
    return this.writing ?? Promise.resolve();
  }
}

// One console line as text, as the console would print it.
function format(args) {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (a === undefined || typeof a !== "object") return String(a);
      try {
        return JSON.stringify(a);
      } catch (e) {
        // A cycle, say: its name is enough for a report.
        console.debug("tide: a log line's object couldn't be written out:", e.message);
        return Object.prototype.toString.call(a);
      }
    })
    .join(" ");
}

// Copies each line `target` (the worker's console) logs at `levels` to
// `recent`, still printing it. Returns the console's own functions, which
// record nothing, for a write failure to report with.
export function capture(target, recent, levels = ["error", "warn", "info", "log", "debug"]) {
  const original = {};
  for (const level of levels) {
    const print = target[level];
    original[level] = (...args) => print.apply(target, args);
    target[level] = (...args) => {
      print.apply(target, args);
      recent.add(format(args), { level });
    };
  }
  return original;
}
