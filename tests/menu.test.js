import assert from "node:assert/strict";
import { moonPhase, moonName, moonPath } from "../js/ui/menu.js";

export const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// Published 2026 moon dates (UTC).
t("moon: new moon on 2026-11-09", () => {
  assert.equal(moonName(moonPhase(new Date("2026-11-09T07:00:00Z"))), "New moon");
});
t("moon: full moon on 2026-11-24", () => {
  assert.equal(moonName(moonPhase(new Date("2026-11-24T15:00:00Z"))), "Full moon");
});
t("moon: first quarter on 2026-11-17", () => {
  assert.equal(moonName(moonPhase(new Date("2026-11-17T12:00:00Z"))), "First quarter");
});
t("moon: phase stays between 0 and 1 for old dates", () => {
  const p = moonPhase(new Date("1990-05-01T00:00:00Z"));
  assert.ok(p >= 0 && p < 1);
});
t("moon: full moon draws the whole disc, lit on both sides", () => {
  const d = moonPath(0.4999, 0, 0, 10);
  assert.match(d, /^M 0 -10 A 10 10 0 0 1 0 10 A 9\.99\d* 10 0 0 1 0 -10 Z$/);
});
t("moon: waxing is lit on the right, waning on the left", () => {
  assert.match(moonPath(0.3, 0, 0, 10), /^M 0 -10 A 10 10 0 0 1 /);
  assert.match(moonPath(0.7, 0, 0, 10), /^M 0 -10 A 10 10 0 0 0 /);
});
