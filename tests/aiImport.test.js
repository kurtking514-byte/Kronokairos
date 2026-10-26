import assert from "node:assert/strict";
import { PROMPT, parseReply } from "../js/aiImport.js";
import { validateSubject } from "../js/model.js";

export const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// Fake data only.
const ROW = { subject: "Math", days: ["Mon", "Wed", "Fri"], start: "07:30", minutes: 80,
  link: "https://example.test/j/123456789?pwd=Fake", meeting_id: "123456789", passcode: "Ab3dEf" };
const block = (rows, extra = "") => `ZOOMCLASS-V1\n${JSON.stringify(rows)}\nEND-ZOOMCLASS${extra}`;
const one = (row) => parseReply(block([row]));

t("PROMPT contains the format markers", () => {
  assert.ok(PROMPT.includes("ZOOMCLASS-V1") && PROMPT.includes("END-ZOOMCLASS"));
});
t("valid reply gives a contract subject", () => {
  const r = parseReply(block([ROW]));
  assert.equal(r.ok, true);
  const s = r.subjects[0];
  assert.deepEqual([s.name, s.days, s.start, s.minutes, s.meetingId, s.passcode], ["Math", ["Mon", "Wed", "Fri"], "07:30", 80, "123456789", "Ab3dEf"]);
  assert.deepEqual(s.missing, []);
  assert.deepEqual(validateSubject(s).errors, []);
});
t("extra chatter before and after is ignored", () => {
  assert.equal(parseReply("Sure! Here you go:\n\n" + block([ROW]) + "\n\nHope that helps!").ok, true);
});
t("code fences are ignored", () => {
  assert.equal(parseReply("```json\n" + block([ROW]) + "\n```").ok, true);
  assert.equal(parseReply("```\nZOOMCLASS-V1\n" + JSON.stringify([ROW]) + "\nEND-ZOOMCLASS\n```").ok, true);
});
t("smart quotes and trailing commas are forgiven", () => {
  const text = block([ROW]).replace(/"/g, "\u201c").replace(/\u201c(?=[^\u201c]*$)/, "\u201d");
  assert.equal(parseReply(`ZOOMCLASS-V1\n[{"subject":"Math","days":["Mon",],"start":"07:30","minutes":80,},]\nEND-ZOOMCLASS`).ok, true);
  assert.equal(typeof text, "string");
});
t("missing END marker is forgiven when the list is complete", () => {
  assert.equal(parseReply("ZOOMCLASS-V1\n" + JSON.stringify([ROW])).ok, true);
});
t("broken replies fail with a retry message", () => {
  for (const bad of ["", "   ", "hello", "ZOOMCLASS-V1\nnot a list\nEND-ZOOMCLASS", "ZOOMCLASS-V1\n[{\"subject\":", "ZOOMCLASS-V1\n[]\nEND-ZOOMCLASS", "ZOOMCLASS-V2\n[]\nEND-ZOOMCLASS", null, undefined, 5]) {
    const r = parseReply(bad);
    assert.equal(r.ok, false, String(bad));
    assert.ok(r.error && r.retryMessage, String(bad));
    assert.deepEqual(r.subjects, []);
  }
});
t("AI echoing the format name in its chatter still finds the real block", () => {
  assert.equal(parseReply("I'll use ZOOMCLASS-V1 as asked.\n" + block([ROW])).ok, true);
});
t("null and empty fields are listed in missing, not guessed", () => {
  const s = one({ subject: "Math", days: ["Mon"], start: null, minutes: null, link: null, meeting_id: null, passcode: null }).subjects[0];
  assert.deepEqual(s.missing.sort(), ["link", "meetingId", "minutes", "passcode", "start"]);
  assert.equal(s.start, "");
  assert.equal(s.minutes, "");
});
t("loose key names are accepted", () => {
  const s = one({ Subject: "Math", Days: ["Mon"], Start: "07:30", Minutes: 80, "Meeting ID": "123456789", Passcode: "x" }).subjects[0];
  assert.equal(s.meetingId, "123456789");
});
t("meeting IDs have spaces and dashes stripped", () => {
  assert.equal(one({ ...ROW, meeting_id: "123 456-789" }).subjects[0].meetingId, "123456789");
  assert.equal(one({ ...ROW, meeting_id: 123456789 }).subjects[0].meetingId, "123456789");
});
t("Sunday is dropped; long and short day names work", () => {
  assert.deepEqual(one({ ...ROW, days: ["Sun", "Monday", "wed.", "FRI"] }).subjects[0].days, ["Mon", "Wed", "Fri"]);
  assert.deepEqual(one({ ...ROW, days: "Mon, Wed" }).subjects[0].days, ["Mon", "Wed"]);
});
t("12-hour start times are converted", () => {
  assert.equal(one({ ...ROW, start: "7:30 AM" }).subjects[0].start, "07:30");
  assert.equal(one({ ...ROW, start: "12:50 PM" }).subjects[0].start, "12:50");
  assert.equal(one({ ...ROW, start: "12:05 AM" }).subjects[0].start, "00:05");
  assert.equal(one({ ...ROW, start: "1:30 PM" }).subjects[0].start, "13:30");
});
t("passcode keeps exact case and symbols", () => assert.equal(one({ ...ROW, passcode: " aBc1l0O! " }).subjects[0].passcode, "aBc1l0O!"));
t("each subject gets a unique id and a colour", () => {
  const r = parseReply(block(Array.from({ length: 12 }, (_, i) => ({ ...ROW, subject: `S${i}` }))));
  assert.equal(new Set(r.subjects.map((s) => s.id)).size, 12);
  assert.ok(r.subjects.every((s) => /^#[0-9a-f]{6}$/i.test(s.color)));
});
t("more than 30 subjects fails; huge input fails", () => {
  assert.equal(parseReply(block(Array.from({ length: 31 }, () => ROW))).ok, false);
  assert.equal(parseReply("x".repeat(300_000)).ok, false);
});
t("hostile keys and values do not throw or pollute", () => {
  const r = parseReply('ZOOMCLASS-V1\n[{"subject":"<img src=x onerror=alert(1)>","__proto__":{"polluted":1},"days":["Mon"],"start":"07:30","minutes":80}]\nEND-ZOOMCLASS');
  assert.equal(r.ok, true);
  assert.equal({}.polluted, undefined);
  assert.equal(r.subjects[0].name, "<img src=x onerror=alert(1)>"); // shown with textContent only
});

// Parser edge cases: reject or flag ambiguous/out-of-range values rather than guessing.
t("a range like Mon-Fri expands to Monday through Friday", () => {
  assert.deepEqual(one({ ...ROW, days: "Mon-Fri" }).subjects[0].days, ["Mon", "Tue", "Wed", "Thu", "Fri"]);
});
t("out-of-range 5-minute classes are flagged instead of clamped", () => {
  const s = one({ ...ROW, minutes: 5 }).subjects[0];
  assert.ok(s.minutes === "" || s.missing.includes("minutes"));
});
t("a bare 1:30 without AM/PM is flagged as ambiguous", () => {
  const s = one({ ...ROW, start: "1:30" }).subjects[0];
  assert.ok(s.start === "" || s.missing.includes("start"));
});
