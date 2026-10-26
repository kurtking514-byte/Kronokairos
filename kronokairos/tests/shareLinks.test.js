import assert from "node:assert/strict";
import { defaultState, newSubject, validateSubject } from "../js/model.js";
import { encodeShare, decodeShare } from "../js/share.js";

export const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// Fake data only. Anything validateSubject accepts must survive a share link (QA bug H1).
const stateWith = (o) => ({ ...defaultState(), subjects: [newSubject({ id: "a1", name: "Math", days: ["Mon"], start: "07:30", minutes: 80, meetingId: "123456789", ...o })] });
const roundTrip = async (o) => {
  const url = await encodeShare(stateWith(o));
  return decodeShare(url.slice(url.indexOf("#")));
};

t("a link without https:// still shares", async () => {
  assert.deepEqual(validateSubject(stateWith({ link: "zoom.us/j/123456789" }).subjects[0]).errors, []);
  const r = await roundTrip({ link: "zoom.us/j/123456789" });
  assert.notEqual(r, null);
  assert.ok(r.subjects[0].link === "" || /^https?:\/\//.test(r.subjects[0].link));
});
t("a very long name still shares (cut to 100)", async () => {
  const r = await roundTrip({ name: "x".repeat(150) });
  assert.notEqual(r, null);
  assert.equal(r.subjects[0].name.length, 100);
});
t("a very long passcode still shares", async () => assert.notEqual(await roundTrip({ passcode: "p".repeat(150) }), null));
t("a javascript: link never comes out of a share link", async () => {
  const r = await roundTrip({ link: "javascript:alert(1)" });
  assert.ok(r === null || !/^javascript:/i.test(r.subjects[0].link));
});
