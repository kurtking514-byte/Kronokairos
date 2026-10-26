import assert from "node:assert/strict";
import { loadState, saveState } from "../js/storage.js";

export const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const fakeStore = (value) => {
  globalThis.localStorage = { getItem: () => value, setItem() {}, removeItem() {} };
};
const good = { id: "a1", name: "Math", color: "#3b82f6", days: ["Mon"], start: "07:30", minutes: 80, link: "", meetingId: "", passcode: "" };
const load = (subjects) => { fakeStore(JSON.stringify({ version: 1, settings: {}, subjects })); return loadState().subjects; };

t("corrupt JSON gives the default state", () => { fakeStore("{nope"); assert.deepEqual(loadState().subjects, []); });
t("wrong version gives the default state", () => { fakeStore(JSON.stringify({ version: 2, subjects: [good] })); assert.deepEqual(loadState().subjects, []); });
t("minutes saved as text become a number", () => assert.equal(load([{ ...good, minutes: "80" }])[0].minutes, 80));
t("a class with an unusable start time is skipped", () => assert.equal(load([good, { ...good, id: "b2", start: "" }, { ...good, id: "c3", start: "7:30 AM" }]).length, 1));
t("a class with no start field gets the default 08:00", () => { const { start, ...rest } = good; assert.equal(load([rest])[0].start, "08:00"); });
t("a class with unusable minutes is skipped", () => assert.equal(load([{ ...good, minutes: "abc" }, { ...good, id: "b2", minutes: 80.5 }]).length, 0));
t("Sunday and non-array days are removed", () => {
  assert.deepEqual(load([{ ...good, days: ["Mon", "Sun"] }])[0].days, ["Mon"]);
  assert.deepEqual(load([{ ...good, days: "Mon" }])[0].days, []);
});
t("text fields that are not text become empty", () => assert.equal(load([{ ...good, passcode: 5, link: null }])[0].passcode, ""));
t("saveState returns false when storage is missing", () => { delete globalThis.localStorage; assert.equal(saveState({ version: 1 }), false); });
