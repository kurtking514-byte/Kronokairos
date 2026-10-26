import assert from "node:assert/strict";
import { PROMPT, parseReply } from "../js/aiImport.js";
import { validateSubject } from "../js/model.js";

export const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const RETRY = "Please reply again using exactly the ZOOMCLASS-V1 format, nothing else.";

// Fake data only.
const MATH = {
  subject: "Math", days: ["Mon", "Wed", "Fri"], start: "07:30", minutes: 80,
  link: "https://us04web.zoom.us/j/12345678901?pwd=fakeToken", meeting_id: "123 4567 8901", passcode: "AbC123",
};
const block = (items) => `ZOOMCLASS-V1\n${JSON.stringify(items)}\nEND-ZOOMCLASS`;
const one = (item, text) => parseReply(text ?? block([item])).subjects?.[0];
const expectFail = (r) => {
  assert.equal(r.ok, false);
  assert.deepEqual(r.subjects, []);
  assert.ok(r.error.startsWith("I couldn't read that reply."), r.error);
  assert.equal(r.retryMessage, RETRY);
};

// ---------- PROMPT ----------
t("PROMPT is exactly the text in Plan section 6", () => {
  assert.equal(PROMPT, `Read the attached screenshots of my class schedule and Zoom invites.
Reply with ONLY the block below, with nothing before or after it.

ZOOMCLASS-V1
[{"subject":"","days":["Mon","Wed","Fri"],"start":"07:30","minutes":80,"link":"","meeting_id":"","passcode":""}]
END-ZOOMCLASS

Rules:
- One object per subject. Add more objects to the list as needed.
- days: only Mon, Tue, Wed, Thu, Fri, Sat.
- start: 24-hour HH:MM.
- minutes: class length as a number. If only an end time is shown, calculate it.
- meeting_id: digits only, no spaces.
- Copy passcodes exactly, keeping uppercase and lowercase.
- If something isn't visible, use null. Never guess.`);
});
t("PROMPT contains both markers and the null rule", () => {
  assert.ok(PROMPT.includes("\nZOOMCLASS-V1\n"));
  assert.ok(PROMPT.includes("\nEND-ZOOMCLASS\n"));
  assert.ok(PROMPT.endsWith("If something isn't visible, use null. Never guess."));
});

// ---------- good replies ----------
t("clean reply becomes a contract subject", () => {
  const r = parseReply(block([MATH]));
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
  assert.equal(r.retryMessage, null);
  const s = r.subjects[0];
  assert.deepEqual(
    { ...s, id: "x", color: "x" },
    {
      id: "x", name: "Math", color: "x", days: ["Mon", "Wed", "Fri"], start: "07:30", minutes: 80,
      link: MATH.link, meetingId: "12345678901", passcode: "AbC123", missing: [],
    }
  );
  assert.deepEqual(validateSubject(s).errors, []);
});
t("several subjects get unique ids and different colors", () => {
  const items = ["A", "B", "C", "D"].map((n) => ({ ...MATH, subject: n }));
  const subs = parseReply(block(items)).subjects;
  assert.equal(subs.length, 4);
  assert.equal(new Set(subs.map((s) => s.id)).size, 4);
  assert.equal(new Set(subs.map((s) => s.color)).size, 4);
  assert.deepEqual(subs.map((s) => s.name), ["A", "B", "C", "D"]);
});
t("chatter before and after the block is ignored", () => {
  const r = parseReply(`Sure, here you go!\n\n${block([MATH])}\n\nLet me know if you need anything else.`);
  assert.equal(r.ok, true);
  assert.equal(r.subjects[0].name, "Math");
});
t("chatter that names the format before the block is ignored", () => {
  const r = parseReply(`Here is your schedule in the ZOOMCLASS-V1 format [as asked]:\n${block([MATH])}`);
  assert.equal(r.ok, true);
  assert.equal(r.subjects.length, 1);
});
t("code fences around or inside the reply are ignored", () => {
  for (const text of [
    "```\n" + block([MATH]) + "\n```",
    "```json\n" + block([MATH]) + "\n```",
    "ZOOMCLASS-V1\n```json\n" + JSON.stringify([MATH]) + "\n```\nEND-ZOOMCLASS",
  ]) {
    assert.equal(parseReply(text).subjects[0].name, "Math");
  }
});
t("curly quotes are repaired", () => {
  const text = block([MATH]).replace(/"/g, (_, i) => (i % 2 ? "\u201d" : "\u201c"));
  assert.equal(parseReply(text).subjects[0].name, "Math");
  assert.equal(parseReply('ZOOMCLASS-V1\n[{\u201csubject\u201d:\u201cMath\u201d,\u201cdays\u201d:[\u201cMon\u201d]}]\nEND-ZOOMCLASS').subjects[0].name, "Math");
});
t("smart dashes are turned into plain hyphens", () => {
  assert.equal(one({ ...MATH, subject: "Math \u2013 Section A\u2014B" }).name, "Math - Section A-B");
});
t("trailing commas are removed", () => {
  const text = 'ZOOMCLASS-V1\n[{"subject":"Math","days":["Mon","Wed",],"start":"07:30","minutes":80,},]\nEND-ZOOMCLASS';
  const s = parseReply(text).subjects[0];
  assert.deepEqual(s.days, ["Mon", "Wed"]);
});
t("commas and brackets inside quoted text are left alone", () => {
  const s = one({ ...MATH, subject: "Algebra, ] [part 2],", passcode: "a,]b" });
  assert.equal(s.name, "Algebra, ] [part 2],");
  assert.equal(s.passcode, "a,]b");
});
t("escaped quotes and backslashes inside text are handled", () => {
  const name = 'The "Big" ] Class \\ [2]';
  const s = one({ ...MATH, subject: name, passcode: 'a"b' });
  assert.equal(s.name, name);
  assert.equal(s.passcode, 'a"b');
  const trailing = 'ZOOMCLASS-V1\n[{"subject":"A \\"x\\" ,]","days":["Mon"],}]\nEND-ZOOMCLASS';
  assert.equal(parseReply(trailing).subjects[0].name, 'A "x" ,]');
});
t("lowercase markers and extra spaces are accepted", () => {
  assert.equal(parseReply(`zoomclass-v1  \n${JSON.stringify([MATH])}\n  end-zoomclass`).ok, true);
});
t("a missing END marker is forgiven when the list is complete", () => {
  assert.equal(parseReply(`ZOOMCLASS-V1\n${JSON.stringify([MATH])}\nThat's all!`).ok, true);
});
t("non-breaking spaces and odd whitespace are trimmed", () => {
  const s = one({ ...MATH, subject: "\u00a0 Math\u00a0 ", passcode: " AbC123 " });
  assert.equal(s.name, "Math");
  assert.equal(s.passcode, "AbC123");
});

// ---------- nulls and missing ----------
t("null fields become empty and are listed in missing", () => {
  const s = one({ subject: "Math", days: ["Mon"], start: "07:30", minutes: 80, link: null, meeting_id: null, passcode: null });
  assert.equal(s.link, "");
  assert.equal(s.meetingId, "");
  assert.equal(s.passcode, "");
  assert.deepEqual(s.missing, ["link", "meetingId", "passcode"]);
});
t("empty strings and absent keys count as missing too", () => {
  const s = one({ subject: "", days: ["Mon"] });
  assert.deepEqual(s.missing, ["name", "start", "minutes", "link", "meetingId", "passcode"]);
  assert.equal(s.name, "");
  assert.equal(s.start, "");
  assert.equal(s.minutes, "");
});
t("an item with every field empty is dropped", () => {
  const r = parseReply(block([{ subject: null, days: null, start: null, minutes: null, link: null, meeting_id: null, passcode: null }, MATH]));
  assert.equal(r.subjects.length, 1);
  assert.equal(r.subjects[0].name, "Math");
});
t("items that are not objects are skipped", () => {
  const r = parseReply(block(["oops", null, 5, [1], MATH]));
  assert.equal(r.subjects.length, 1);
});
t("every subject has the contract fields and a missing array", () => {
  const keys = ["color", "days", "id", "link", "meetingId", "minutes", "missing", "name", "passcode", "start"];
  for (const s of parseReply(block([MATH, { subject: "X" }])).subjects) {
    assert.deepEqual(Object.keys(s).sort(), keys);
    assert.ok(Array.isArray(s.missing));
  }
});
t("other key spellings work (name, meetingId, Meeting ID, password)", () => {
  const s = one({ name: "Math", days: ["Mon"], start: "07:30", minutes: 80, "Meeting ID": "123 456 789", Password: "xY9" });
  assert.equal(s.name, "Math");
  assert.equal(s.meetingId, "123456789");
  assert.equal(s.passcode, "xY9");
});

// ---------- days ----------
t("Sunday is dropped", () => {
  assert.deepEqual(one({ ...MATH, days: ["Sun", "Mon", "Sunday"] }).days, ["Mon"]);
});
t("a Sunday-only subject keeps no days and is flagged", () => {
  const s = one({ ...MATH, days: ["Sun"] });
  assert.deepEqual(s.days, []);
  assert.ok(s.missing.includes("days"));
});
t("full day names, lowercase, dots and strings are understood", () => {
  assert.deepEqual(one({ ...MATH, days: ["Monday", "wed.", "FRI"] }).days, ["Mon", "Wed", "Fri"]);
  assert.deepEqual(one({ ...MATH, days: "Tue, Thu / Sat" }).days, ["Tue", "Thu", "Sat"]);
});
t("days are de-duplicated and put in week order", () => {
  assert.deepEqual(one({ ...MATH, days: ["Fri", "Mon", "Fri", "Wed"] }).days, ["Mon", "Wed", "Fri"]);
});

// ---------- times ----------
t("12-hour times are converted", () => {
  const cases = { "7:30 AM": "07:30", "7:30am": "07:30", "7:30 a.m.": "07:30", "1:05 PM": "13:05", "12:00 AM": "00:00", "12:30 PM": "12:30", "11:59 pm": "23:59", "7 AM": "07:00" };
  for (const [given, expected] of Object.entries(cases)) {
    assert.equal(one({ ...MATH, start: given }).start, expected, given);
  }
});
t("24-hour times are padded and kept", () => {
  assert.equal(one({ ...MATH, start: "7:30" }).start, "07:30");
  assert.equal(one({ ...MATH, start: "13:05" }).start, "13:05");
  assert.equal(one({ ...MATH, start: "07:30:00" }).start, "07:30");
});
t("invalid times become empty and are flagged", () => {
  for (const bad of ["25:00", "12:60", "13:00 PM", "0:30 AM", "soon", "7", "", 730, null]) {
    const s = one({ ...MATH, start: bad });
    assert.equal(s.start, "", String(bad));
    assert.ok(s.missing.includes("start"), String(bad));
  }
});

// ---------- minutes ----------
t("minutes are clamped to 10..300 and rounded", () => {
  assert.equal(one({ ...MATH, minutes: 5 }).minutes, 10);
  assert.equal(one({ ...MATH, minutes: 400 }).minutes, 300);
  assert.equal(one({ ...MATH, minutes: 79.6 }).minutes, 80);
});
t("minutes written as text are understood", () => {
  assert.equal(one({ ...MATH, minutes: "80" }).minutes, 80);
  assert.equal(one({ ...MATH, minutes: "80 min" }).minutes, 80);
  assert.equal(one({ ...MATH, minutes: "90 minutes" }).minutes, 90);
});
t("zero, negative or unreadable minutes are flagged, not guessed", () => {
  for (const bad of [0, -30, "an hour", NaN, null, {}]) {
    const s = one({ ...MATH, minutes: bad });
    assert.equal(s.minutes, "", String(bad));
    assert.ok(s.missing.includes("minutes"), String(bad));
  }
});

// ---------- IDs and passcodes ----------
t("meeting IDs are reduced to digits", () => {
  assert.equal(one({ ...MATH, meeting_id: "123 456 7890" }).meetingId, "1234567890");
  assert.equal(one({ ...MATH, meeting_id: "123-4567-8901" }).meetingId, "12345678901");
  assert.equal(one({ ...MATH, meeting_id: 12345678901 }).meetingId, "12345678901");
});
t("a meeting ID with no digits is missing", () => {
  const s = one({ ...MATH, meeting_id: "n/a" });
  assert.equal(s.meetingId, "");
  assert.ok(s.missing.includes("meetingId"));
});
t("passcode case is kept exactly", () => {
  assert.equal(one({ ...MATH, passcode: "aBcD9xYz" }).passcode, "aBcD9xYz");
});
t("a numeric passcode becomes text", () => {
  assert.equal(one({ ...MATH, passcode: 123456 }).passcode, "123456");
});

// ---------- failures ----------
t("an empty list fails", () => {
  expectFail(parseReply("ZOOMCLASS-V1\n[]\nEND-ZOOMCLASS"));
});
t("a list with only empty items fails", () => {
  expectFail(parseReply(block([{ subject: null }, {}])));
});
t("broken JSON fails with the retry message", () => {
  expectFail(parseReply('ZOOMCLASS-V1\n[{"subject":"Math", days: Mon}]\nEND-ZOOMCLASS'));
});
t("a list that is cut off fails", () => {
  const r = parseReply('ZOOMCLASS-V1\n[{"subject":"Math","days":["Mon"],"start":"07:3');
  expectFail(r);
  assert.ok(r.error.includes("cut off"));
});
t("missing markers fail", () => {
  expectFail(parseReply(JSON.stringify([MATH])));
  expectFail(parseReply("Sorry, I can't read those screenshots."));
});
t("markers without a list fail", () => {
  expectFail(parseReply("ZOOMCLASS-V1\nno list here\nEND-ZOOMCLASS"));
  expectFail(parseReply('ZOOMCLASS-V1\n{"subject":"Math"}\nEND-ZOOMCLASS'));
});
t("an unknown version is rejected with a clear message", () => {
  const r = parseReply(`ZOOMCLASS-V2\n${JSON.stringify([MATH])}\nEND-ZOOMCLASS`);
  expectFail(r);
  assert.ok(r.error.includes("ZOOMCLASS-V2"));
});
t("a V1 block still works when a V2 mention is also present", () => {
  assert.equal(parseReply(`(not ZOOMCLASS-V2)\n${block([MATH])}`).ok, true);
});
t("too many subjects fail", () => {
  expectFail(parseReply(block(Array.from({ length: 31 }, () => MATH))));
  assert.equal(parseReply(block(Array.from({ length: 30 }, () => MATH))).ok, true);
});
t("very long input is rejected quickly", () => {
  const started = Date.now();
  expectFail(parseReply("x".repeat(300000)));
  expectFail(parseReply("ZOOMCLASS-V1 ".repeat(20000)));
  expectFail(parseReply("ZOOMCLASS-V1\n[" + '{"a":"'.repeat(30000)));
  assert.ok(Date.now() - started < 2000);
});
t("a long reply with lots of chatter still works", () => {
  const r = parseReply("blah ".repeat(15000) + block([MATH]) + " blah".repeat(15000));
  assert.equal(r.ok, true);
});
t("non-string input never throws", () => {
  for (const bad of [null, undefined, 42, {}, [], true, () => 1, Symbol("x"), 10n]) {
    expectFail(parseReply(bad));
  }
  expectFail(parseReply(""));
  expectFail(parseReply("   \n "));
});
t("random junk never throws and always returns the full result shape", () => {
  const bits = ["ZOOMCLASS-V1", "END-ZOOMCLASS", "[", "]", "{", "}", '"', ",", ":", "null", '"subject"', '"days"', "\n", " ", "\\", "```", "\u201c", "1"];
  for (let i = 0; i < 3000; i++) {
    let s = "";
    for (let j = Math.floor(Math.random() * 30); j > 0; j--) s += bits[Math.floor(Math.random() * bits.length)];
    const r = parseReply(s);
    assert.deepEqual(Object.keys(r).sort(), ["error", "ok", "retryMessage", "subjects"]);
    if (r.ok) for (const sub of r.subjects) assert.ok(Array.isArray(sub.missing));
  }
});
