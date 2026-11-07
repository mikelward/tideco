// Tests for `make zip`, the store upload (PUBLISHING.md §4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json")));

// The packaged manifest, read back by packaged().
let packagedManifest;

// The files in the ZIP `make zip` builds, by path.
function packaged() {
  const dist = mkdtempSync(join(tmpdir(), "tide-zip-"));
  try {
    execFileSync("make", ["-s", "zip", `DIST=${dist}`], { cwd: ROOT, stdio: "pipe" });
    const zip = join(dist, `tide-${version}.zip`);
    packagedManifest = JSON.parse(execFileSync("unzip", ["-p", zip, "manifest.json"], { encoding: "utf8" }));
    return new Set(execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n").filter((f) => f && !f.endsWith("/")));
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
}

const version = execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const files = packaged();

test("the ZIP has manifest.json at its top and no tests", () => {
  assert.ok(files.has("manifest.json"));
  for (const f of files) {
    assert.doesNotMatch(f, /_test\.js$|fake_chrome\.js$|^test\/|^node_modules\//, f);
  }
});

// Each commit on main is one higher, as the store requires of an update. The
// checked-in version is a placeholder for unpacked loads.
test("the ZIP's version is the commit count", () => {
  assert.equal(manifest.version, "0");
  assert.match(version, /^[1-9]\d*$/);
  assert.equal(packagedManifest.version, version);
  assert.deepEqual({ ...packagedManifest, version: manifest.version }, manifest, "nothing else in the manifest changes");
});

test("every file the manifest names is in the ZIP", () => {
  const named = [
    manifest.background.service_worker,
    manifest.options_ui.page,
    "src/unread_watch.js",
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
  ];
  for (const f of named) assert.ok(files.has(f), f);
});

// A page or module that loads a file left out would fail only once
// installed, so follow every import, script, stylesheet and image.
test("every file a packaged page or module loads is in the ZIP", () => {
  for (const f of files) {
    if (!/\.(js|html)$/.test(f)) continue;
    const text = readFileSync(join(ROOT, f), "utf8");
    const refs = [...text.matchAll(/(?:from\s+|import\s*\(\s*|\b(?:src|href)=)["'](\.{0,2}\/?[\w./-]+\.(?:js|css|html|png|svg))["']/g)].map((m) => m[1]);
    for (const ref of refs) {
      const path = ref.startsWith("/") ? ref.slice(1) : posix.normalize(posix.join(posix.dirname(f), ref));
      assert.ok(files.has(path), `${f} loads ${ref}, which isn't packaged`);
    }
  }
});

// A shallow clone counts only the commits it has, so its version could be
// lower than one already published.
test("a shallow clone refuses to build the ZIP", () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-shallow-"));
  try {
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${ROOT}`, join(dir, "tide")], { stdio: "pipe" });
    // The Makefile under test, not the one last committed.
    copyFileSync(join(ROOT, "Makefile"), join(dir, "tide", "Makefile"));
    assert.throws(
      () => execFileSync("make", ["-s", "zip", `DIST=${join(dir, "dist")}`], { cwd: join(dir, "tide"), stdio: "pipe" }),
      (e) => /history is shallow/.test(e.stderr.toString()),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
