import assert from "node:assert/strict";
import { parseInvite } from "../js/invite.js";

export const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const NONE = { link: null, meetingId: null, passcode: null };

// Fake data only.
const FULL = `Teacher Fake is inviting you to a scheduled Zoom meeting.

Topic: Math 7
Join Zoom Meeting
https://us04web.zoom.us/j/123456789?pwd=FakePwd1x

Meeting ID: 123 456 789
Passcode: Ab3dEf`;

t("full invite: link, meeting ID and passcode", () => {
  assert.deepEqual(parseInvite(FULL), {
    link: "https://us04web.zoom.us/j/123456789?pwd=FakePwd1x", meetingId: "123456789", passcode: "Ab3dEf",
  });
});
t("invite without a passcode line gives passcode null", () => {
  const r = parseInvite(FULL.replace(/Passcode: .*/, ""));
  assert.equal(r.passcode, null);
  assert.equal(r.meetingId, "123456789");
});
t("only a link: meeting ID comes from the link", () => {
  const r = parseInvite("https://zoom.us/j/98765432109?pwd=Fake");
  assert.equal(r.meetingId, "98765432109");
  assert.equal(r.passcode, null);
});
t("passcode keeps upper and lower case exactly", () => assert.equal(parseInvite("Passcode: aBcD1l0O").passcode, "aBcD1l0O"));
t("11-digit and 10-digit IDs with spaces", () => {
  assert.equal(parseInvite("Meeting ID: 771 2426 4687").meetingId, "77124264687");
  assert.equal(parseInvite("Meeting ID: 868 602 8919").meetingId, "8686028919");
});
t("a 12-digit meeting ID is rejected", () => assert.equal(parseInvite("Meeting ID: 788 0642 5425 4").meetingId, null));
t("link broken over two lines is glued back together", () => {
  const r = parseInvite("https://us04web.zoom.us/j/123456789?\npwd=FakePwd1x\nMeeting ID: 123 456 789");
  assert.equal(r.link, "https://us04web.zoom.us/j/123456789?pwd=FakePwd1x");
});
t("trailing punctuation is not part of the link", () => {
  assert.equal(parseInvite("Join: https://zoom.us/j/123456789.").link, "https://zoom.us/j/123456789");
});
t("look-alike hosts are not accepted", () => {
  for (const u of ["https://evilzoom.us/j/123456789", "https://zoom.us.evil.test/j/123456789", "https://example.test/j/123456789"]) {
    assert.equal(parseInvite(u).link, null, u);
  }
});
t("calendar and launch links are skipped", () => {
  assert.equal(parseInvite("https://zoom.us/meeting/123456789/calendar/google/add").link, null);
  assert.equal(parseInvite("https://zoom.us/launch/jc/123456789").link, null);
});
t("plain link wins over the notes link, and mynotes is stripped when alone", () => {
  const both = parseInvite("https://zoom.us/j/123456789?mynotes=on\nhttps://zoom.us/j/123456789?pwd=Fake");
  assert.equal(both.link, "https://zoom.us/j/123456789?pwd=Fake");
  assert.equal(parseInvite("https://zoom.us/j/123456789?mynotes=on").link, "https://zoom.us/j/123456789");
});
t("Windows line endings and non-breaking spaces", () => {
  const r = parseInvite("Meeting\u00a0ID:\u00a0123\u00a0456\u00a0789\r\nPasscode:\u00a0Ab3dEf\r\n");
  assert.equal(r.meetingId, "123456789");
  assert.equal(r.passcode, "Ab3dEf");
});
t("password label also works", () => assert.equal(parseInvite("Password: Fake99").passcode, "Fake99"));
t("empty, wrong-type and junk input never throw", () => {
  for (const bad of ["", "   ", "hello", null, undefined, 5, {}, [], "\u0000\u0001"]) {
    assert.deepEqual(parseInvite(bad), NONE, String(bad));
  }
});
t("a huge input is handled quickly", () => {
  const started = Date.now();
  parseInvite("Meeting ID: " + "1 ".repeat(200_000));
  parseInvite("https://zoom.us/j/" + "1".repeat(200_000));
  assert.ok(Date.now() - started < 2000);
});
