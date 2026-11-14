import { test } from "node:test";
import assert from "node:assert/strict";
import {
  abbreviation,
  checkZone,
  city,
  clockRow,
  dstNote,
  formatOffset,
  hoursFromLocal,
  inBar,
  nextOffsetChange,
  offsetMinutes,
  scrub,
  strip,
} from "./clocks.js";

// 2026-10-24 23:30 in London (BST), 15:30 in LA, 18:30 in NYC, 09:30 on the 25th in Sydney.
const T = new Date("2026-10-24T22:30:00Z");

test("the row is SYD, LAX, NYC, LON, then local with its date", () => {
  assert.deepEqual(clockRow(T, "Asia/Tokyo"), [
    { label: "SYD", time: "09:30", day: 0 },
    { label: "LAX", time: "15:30", day: -1 },
    { label: "NYC", time: "18:30", day: -1 },
    { label: "LON", time: "23:30", day: -1 },
    { label: "Oct 25", time: "07:30", day: 0, local: true },
  ]);
});

test("a listed zone that is the local zone is hidden", () => {
  const row = clockRow(T, "Europe/London");
  assert.deepEqual(row.map((r) => r.label), ["SYD", "LAX", "NYC", "Oct 24"]);
});

test("a zone that only shares local's offset stays", () => {
  const row = clockRow(T, "Europe/Dublin");
  assert.deepEqual(row.map((r) => r.label), ["SYD", "LAX", "NYC", "LON", "Oct 24"]);
});

test("a later date shows +1", () => {
  const row = clockRow(new Date("2026-10-24T20:00:00Z"), "America/Los_Angeles");
  assert.deepEqual(row.find((r) => r.label === "LON"), { label: "LON", time: "21:00", day: 0 });
  const late = clockRow(new Date("2026-10-25T05:30:00Z"), "America/Los_Angeles");
  assert.deepEqual(late.find((r) => r.label === "LON"), { label: "LON", time: "05:30", day: 1 });
});

test("an unknown zone is an error naming it", () => {
  assert.throws(() => checkZone("Mars/Olympus_Mons"), /Mars\/Olympus_Mons/);
  checkZone("America/New_York");
});

test("London leaves BST at 01:00 UTC on Sunday 25 October 2026", () => {
  assert.equal(offsetMinutes(T, "Europe/London"), 60);
  assert.equal(nextOffsetChange(T, "Europe/London").toISOString(), "2026-10-25T01:00:00.000Z");
});

test("a zone with no DST has no next change", () => {
  assert.equal(nextOffsetChange(T, "Asia/Tokyo"), null);
});

test("abbreviations follow tzdata, not Chrome's GMT+1", () => {
  assert.equal(abbreviation(T, "Europe/London"), "BST");
  assert.equal(abbreviation(new Date("2026-12-01T12:00:00Z"), "Europe/London"), "GMT");
  assert.equal(abbreviation(T, "Europe/Paris"), "CEST");
  assert.equal(abbreviation(T, "America/Los_Angeles"), "PDT");
  assert.equal(abbreviation(T, "Australia/Sydney"), "AEDT");
});

test("a clock's city is its own, else the zone's last part", () => {
  assert.equal(city({ zone: "America/Los_Angeles", city: "San Francisco" }), "San Francisco");
  assert.equal(city({ zone: "America/Los_Angeles" }), "Los Angeles");
});

test("hours from local can be fractional and negative", () => {
  assert.equal(hoursFromLocal(T, "Europe/Paris", "America/Los_Angeles"), -9);
  assert.equal(hoursFromLocal(T, "Europe/London", "Asia/Kolkata"), 4.5);
});

test("a zone's strip sits on local hours and splits at midnight", () => {
  // LA is 9 h behind Paris: its 07-19 day is Paris 16-04, its 09-17 work Paris 18-02.
  assert.deepEqual(strip(T, "Europe/Paris", "America/Los_Angeles"), [
    { kind: "day", start: 16, end: 24 },
    { kind: "day", start: 0, end: 4 },
    { kind: "work", start: 18, end: 24 },
    { kind: "work", start: 0, end: 2 },
  ]);
  assert.deepEqual(strip(T, "Europe/Paris", "Europe/Paris", { day: [6, 22], work: [8, 16] }), [
    { kind: "day", start: 6, end: 22 },
    { kind: "work", start: 8, end: 16 },
  ], "the hours come from settings");
  assert.deepEqual(strip(T, "Europe/Paris", "Europe/Paris"), [
    { kind: "day", start: 7, end: 19 },
    { kind: "work", start: 9, end: 17 },
  ]);
});

test("the DST note names each change and the week the gap is off", () => {
  assert.equal(
    dstNote(T, "Australia/Sydney"),
    "London moves to GMT on Sun, Oct 25; New York and Los Angeles move to EST/PST on Sun, Nov 1. " +
      "Until Sun, Nov 1, London is 4 h ahead of New York instead of 5.",
  );
});

test("with no change in three weeks there's no note", () => {
  assert.equal(dstNote(new Date("2026-07-01T12:00:00Z"), "Asia/Tokyo"), null);
});

test("a sideways scroll, with no step up or down, leaves the time as it is", () => {
  // A trackpad's horizontal swipe is a wheel event whose deltaY is 0.
  const at = new Date("2026-10-24T22:37:00Z");
  assert.equal(scrub(at, 0).getTime(), at.getTime());
  assert.equal(scrub(at, Math.sign(-0)).getTime(), at.getTime());
});

test("scrubbing lands on the next quarter hour, then steps by 15 minutes", () => {
  const at = new Date("2026-10-24T22:31:00Z");
  assert.equal(scrub(at, 1).toISOString(), "2026-10-24T22:45:00.000Z");
  assert.equal(scrub(at, -1).toISOString(), "2026-10-24T22:30:00.000Z");
  assert.equal(scrub(new Date("2026-10-24T22:30:00Z"), -1).toISOString(), "2026-10-24T22:15:00.000Z");
});

test("the DST search is bounded and quick", () => {
  // With nothing changing in three weeks, the note searches no further.
  const start = performance.now();
  for (let i = 0; i < 10; i++) dstNote(new Date("2026-07-01T12:00:00Z"), "Asia/Tokyo");
  assert.ok(performance.now() - start < 500, "ten notes in under half a second");
  assert.equal(nextOffsetChange(new Date("2026-07-01T12:00:00Z"), "Europe/London", 21 * 86400000), null);
});

test("a change is found to the minute from any start", () => {
  assert.equal(
    nextOffsetChange(new Date("2026-10-24T22:30:17.250Z"), "Europe/London").toISOString(),
    "2026-10-25T01:00:00.000Z",
  );
});

test("offsets read in hours and minutes, exactly", () => {
  assert.equal(formatOffset(-9), "\u22129 h");
  assert.equal(formatOffset(5.5), "+5 h 30 m");
  // New York from Kathmandu.
  assert.equal(formatOffset(hoursFromLocal(T, "Asia/Kathmandu", "America/New_York")), "\u22129 h 45 m");
});

// The search once looped forever here, when it rounded only one end of the
// bisection.
test("a change in the last partial minute of a search step is found", () => {
  assert.equal(
    nextOffsetChange(new Date("2026-10-24T19:00:17.250Z"), "Europe/London").toISOString(),
    "2026-10-25T01:00:00.000Z",
  );
});

// tide's clocks.json can keep a zone for the clock panel and out of the bar
// (tide SPEC.md §7.3): every one is in the bar unless it says bar: false.
test("the bar leaves out a clock set bar: false", () => {
  const clocks = [
    { zone: "Australia/Sydney", label: "SYD", bar: false },
    { zone: "America/Los_Angeles", label: "LAX" },
    { zone: "Europe/London", label: "LON", bar: true },
  ];
  assert.deepEqual(inBar(clocks).map((c) => c.label), ["LAX", "LON"]);
  assert.deepEqual(clockRow(T, "Asia/Tokyo", inBar(clocks)).map((r) => r.label).slice(0, 2), ["LAX", "LON"]);
});
