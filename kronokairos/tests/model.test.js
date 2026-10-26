import assert from "node:assert/strict";
import {
  DAYS, TERM_WEEKS, defaultState, newSubject, validateSubject, findOverlaps,
  to12h, endTime, dayName, classesOn, nextClass, joinUrl, termEnd,
} from "../js/model.js";

export const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// A valid subject, with fake data only.
const subj = (o = {}) =>
  newSubject({ name: "Math", days: ["Mon"], start: "08:00", minutes: 60, meetingId: "123456789", ...o });
const stateWith = (...subjects) => ({ ...defaultState(), subjects });
const ymd = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate()];

// 26 Oct 2026 is a Monday; 1 Nov 2026 is a Sunday.

// ---------- constants and defaults ----------
t("DAYS is Mon to Sat and has no Sunday", () => {
  assert.deepEqual(DAYS, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  assert.ok(!DAYS.includes("Sun"));
});
t("TERM_WEEKS is 13 and 18", () => assert.deepEqual(TERM_WEEKS, { trimester: 13, semester: 18 }));
t("defaultState matches the contract", () => {
  const s = defaultState();
  assert.equal(s.version, 1);
  assert.deepEqual(s.settings, {
    alarmLeadMinutes: 5, calendarLeadMinutes: [5], snoozeMinutes: 5,
    keepScreenOn: true, termType: "semester", termEndDate: null,
  });
  assert.deepEqual(s.subjects, []);
});
t("defaultState returns independent copies", () => {
  const a = defaultState();
  a.settings.calendarLeadMinutes.push(10);
  a.subjects.push(subj());
  assert.deepEqual(defaultState().settings.calendarLeadMinutes, [5]);
  assert.equal(defaultState().subjects.length, 0);
});

// ---------- newSubject ----------
t("newSubject fills every field", () => {
  const s = newSubject();
  assert.deepEqual(Object.keys(s).sort(),
    ["color", "days", "id", "link", "meetingId", "minutes", "name", "passcode", "start"]);
});
t("newSubject applies partial values", () => {
  const s = newSubject({ name: "Science", minutes: 90 });
  assert.equal(s.name, "Science");
  assert.equal(s.minutes, 90);
  assert.equal(s.start, "08:00");
});
t("newSubject ids are unique", () => {
  assert.equal(new Set(Array.from({ length: 500 }, () => newSubject().id)).size, 500);
});

// ---------- validateSubject ----------
t("valid subject has no errors or warnings", () => {
  assert.deepEqual(validateSubject(subj()), { errors: [], warnings: [] });
});
t("empty and blank names are errors", () => {
  assert.equal(validateSubject(subj({ name: "" })).errors.length, 1);
  assert.equal(validateSubject(subj({ name: "   " })).errors.length, 1);
});
t("no days is an error", () => assert.equal(validateSubject(subj({ days: [] })).errors.length, 1));
t("Sunday is rejected", () => assert.equal(validateSubject(subj({ days: ["Mon", "Sun"] })).errors.length, 1));
t("start must be 24-hour HH:MM", () => {
  for (const bad of ["7:30", "24:00", "12:60", "0730", "", "7:30 AM"]) {
    assert.equal(validateSubject(subj({ start: bad })).errors.length, 1, bad);
  }
  for (const good of ["00:00", "07:30", "23:59"]) {
    assert.equal(validateSubject(subj({ start: good })).errors.length, 0, good);
  }
});
t("minutes: 10 to 300, whole numbers only", () => {
  for (const bad of [9, 301, 0, -5, 80.5, "80", null]) {
    assert.equal(validateSubject(subj({ minutes: bad })).errors.length, 1, String(bad));
  }
  for (const good of [10, 80, 300]) {
    assert.equal(validateSubject(subj({ minutes: good })).errors.length, 0, String(good));
  }
});
t("meetingId must be 9 to 11 digits", () => {
  for (const bad of ["12345678", "123456789012", "12345abc9", "123 456 789"]) {
    assert.equal(validateSubject(subj({ meetingId: bad })).errors.length, 1, bad);
  }
  for (const good of ["123456789", "12345678901"]) {
    assert.equal(validateSubject(subj({ meetingId: good })).errors.length, 0, good);
  }
});
t("empty meetingId is allowed", () => {
  const r = validateSubject(subj({ meetingId: "", link: "https://example.test/j/1" }));
  assert.deepEqual(r.errors, []);
});
t("warns when there is no link and no meeting ID", () => {
  const r = validateSubject(subj({ meetingId: "", link: "" }));
  assert.equal(r.errors.length, 0);
  assert.equal(r.warnings.length, 1);
});
t("warns when the link does not start with http(s)", () => {
  assert.equal(validateSubject(subj({ link: "example.test/j/1" })).warnings.length, 1);
  assert.equal(validateSubject(subj({ link: "https://example.test/j/1" })).warnings.length, 0);
});
t("warns when a class runs past midnight", () => {
  assert.equal(validateSubject(subj({ start: "23:30", minutes: 60 })).warnings.length, 1);
  assert.equal(validateSubject(subj({ start: "23:00", minutes: 60 })).warnings.length, 0);
});

// ---------- time helpers ----------
t("to12h handles midnight and noon", () => {
  assert.equal(to12h("00:00"), "12:00 AM");
  assert.equal(to12h("12:00"), "12:00 PM");
});
t("to12h across the 12:00 boundary", () => {
  assert.equal(to12h("11:59"), "11:59 AM");
  assert.equal(to12h("12:01"), "12:01 PM");
  assert.equal(to12h("12:50"), "12:50 PM");
});
t("to12h ordinary times", () => {
  assert.equal(to12h("07:30"), "7:30 AM");
  assert.equal(to12h("13:05"), "1:05 PM");
  assert.equal(to12h("23:59"), "11:59 PM");
});
t("endTime adds minutes", () => assert.equal(endTime({ start: "07:30", minutes: 80 }), "08:50"));
t("endTime crosses 12:00", () => assert.equal(endTime({ start: "11:30", minutes: 80 }), "12:50"));
t("endTime wraps past midnight", () => assert.equal(endTime({ start: "23:30", minutes: 60 }), "00:30"));
t("dayName covers all seven days including Sunday", () => {
  const names = [26, 27, 28, 29, 30, 31, 1].map((d) => dayName(new Date(2026, d === 1 ? 10 : 9, d)));
  assert.deepEqual(names, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
});

// ---------- overlaps ----------
t("findOverlaps finds same-day overlap", () => {
  const a = subj({ start: "08:00", minutes: 60 });
  const b = subj({ start: "08:30", minutes: 60 });
  const r = findOverlaps([a, b]);
  assert.equal(r.length, 1);
  assert.equal(r[0].day, "Mon");
  assert.ok((r[0].a === a && r[0].b === b));
});
t("findOverlaps ignores classes that only touch", () => {
  assert.deepEqual(findOverlaps([subj({ start: "08:00", minutes: 60 }), subj({ start: "09:00" })]), []);
});
t("findOverlaps ignores different days", () => {
  assert.deepEqual(findOverlaps([subj({ days: ["Mon"] }), subj({ days: ["Tue"] })]), []);
});
t("findOverlaps reports each shared day", () => {
  const a = subj({ days: ["Mon", "Wed", "Fri"] });
  const b = subj({ days: ["Wed", "Fri", "Sat"] });
  assert.deepEqual(findOverlaps([a, b]).map((x) => x.day), ["Wed", "Fri"]);
});
t("findOverlaps handles identical times and three classes", () => {
  const list = [subj(), subj(), subj({ start: "10:00" })];
  assert.equal(findOverlaps(list).length, 1);
});

// ---------- classesOn / nextClass ----------
t("classesOn sorts by start and filters by day", () => {
  const s = stateWith(subj({ name: "B", start: "10:00" }), subj({ name: "A", start: "07:30" }), subj({ name: "C", days: ["Tue"] }));
  assert.deepEqual(classesOn(s, "Mon").map((x) => x.name), ["A", "B"]);
  assert.deepEqual(classesOn(s, "Tue").map((x) => x.name), ["C"]);
});
t("classesOn Sunday is always empty", () => assert.deepEqual(classesOn(stateWith(subj()), "Sun"), []));
t("nextClass finds a later class today", () => {
  const r = nextClass(stateWith(subj({ name: "Math", start: "07:30" })), new Date(2026, 9, 26, 7, 0));
  assert.equal(r.subject.name, "Math");
  assert.deepEqual(ymd(r.startsAt), [2026, 10, 26]);
  assert.equal(r.startsAt.getHours(), 7);
  assert.equal(r.startsAt.getMinutes(), 30);
});
t("nextClass at the exact start moves on to the next one", () => {
  const s = stateWith(subj({ name: "Math", start: "07:30" }), subj({ name: "Sci", days: ["Tue"], start: "09:00" }));
  const r = nextClass(s, new Date(2026, 9, 26, 7, 30));
  assert.equal(r.subject.name, "Sci");
  assert.deepEqual(ymd(r.startsAt), [2026, 10, 27]);
});
t("nextClass wraps to next week for the same weekday", () => {
  const r = nextClass(stateWith(subj({ start: "07:30" })), new Date(2026, 9, 26, 8, 0));
  assert.deepEqual(ymd(r.startsAt), [2026, 11, 2]);
});
t("nextClass skips Sunday (Saturday night to Monday)", () => {
  const s = stateWith(subj({ days: ["Mon", "Sat"], start: "07:30" }));
  const r = nextClass(s, new Date(2026, 9, 31, 23, 0));
  assert.deepEqual(ymd(r.startsAt), [2026, 11, 2]);
});
t("nextClass is null with no subjects", () => assert.equal(nextClass(defaultState(), new Date(2026, 9, 26)), null));

// ---------- joinUrl ----------
t("joinUrl prefers the invite link", () => {
  assert.equal(joinUrl({ link: "https://example.test/j/1", meetingId: "123456789" }), "https://example.test/j/1");
});
t("joinUrl falls back to zoom.us with the meeting ID", () => {
  assert.equal(joinUrl({ link: "", meetingId: "123456789" }), "https://zoom.us/j/123456789");
  assert.equal(joinUrl({ link: "   ", meetingId: "123456789" }), "https://zoom.us/j/123456789");
});
t("joinUrl is null with neither", () => assert.equal(joinUrl({ link: "", meetingId: "" }), null));

// ---------- termEnd ----------
t("termEnd semester is 18 weeks, ending on the day before", () => {
  const e = termEnd(defaultState(), new Date(2026, 9, 26));
  assert.deepEqual(ymd(e), [2027, 2, 28]);
  assert.equal(e.getHours(), 23);
});
t("termEnd trimester is 13 weeks", () => {
  const s = defaultState();
  s.settings.termType = "trimester";
  assert.deepEqual(ymd(termEnd(s, new Date(2026, 9, 26))), [2027, 1, 24]);
});
t("termEnd custom uses the chosen date, end of day", () => {
  const s = defaultState();
  s.settings.termType = "custom";
  s.settings.termEndDate = "2027-03-15";
  const e = termEnd(s, new Date(2026, 9, 26));
  assert.deepEqual(ymd(e), [2027, 3, 15]);
  assert.equal(e.getHours(), 23);
});
t("termEnd custom without a date falls back to semester", () => {
  const s = defaultState();
  s.settings.termType = "custom";
  assert.deepEqual(ymd(termEnd(s, new Date(2026, 9, 26))), [2027, 2, 28]);
});

// ---------- module contract ----------
const CONTRACT = {
  "../js/model.js": ["DAYS", "TERM_WEEKS", "defaultState", "newSubject", "validateSubject", "findOverlaps",
    "to12h", "endTime", "dayName", "classesOn", "nextClass", "joinUrl", "termEnd"],
  "../js/storage.js": ["loadState", "saveState", "onChange", "resetAll"],
  "../js/invite.js": ["parseInvite"],
  "../js/aiImport.js": ["PROMPT", "parseReply"],
  "../js/calendar.js": ["buildICS", "downloadICS"],
  "../js/share.js": ["encodeShare", "decodeShare"],
  "../js/alarms.js": ["startAlarms", "stopAlarms", "onAlarm", "snooze"],
  "../js/ui/today.js": ["render"],
  "../js/ui/schedule.js": ["render"],
  "../js/ui/links.js": ["render"],
  "../js/ui/settings.js": ["render"],
  "../js/ui/subjectForm.js": ["render"],
};
t("every module exports the names in the contract", async () => {
  for (const [file, names] of Object.entries(CONTRACT)) {
    const mod = await import(file);
    for (const n of names) assert.ok(n in mod, `${file} is missing ${n}`);
  }
});
t("stubs return placeholder values instead of throwing", async () => {
  const invite = await import("../js/invite.js");
  const ai = await import("../js/aiImport.js");
  const cal = await import("../js/calendar.js");
  const share = await import("../js/share.js");
  assert.deepEqual(invite.parseInvite("x"), { link: null, meetingId: null, passcode: null });
  assert.equal(ai.parseReply("x").ok, false);
  assert.equal(typeof cal.buildICS(defaultState(), new Date()), "string");
  assert.equal(await share.decodeShare("#s=x"), null);
});

t("joinUrl ignores links that are not http(s)", () => {
  assert.equal(joinUrl({ link: "javascript:alert(1)", meetingId: "123456789" }), "https://zoom.us/j/123456789");
  assert.equal(joinUrl({ link: "zoom.us/j/1", meetingId: "" }), null);
  assert.equal(joinUrl({ link: "HTTPS://example.test/j/1", meetingId: "" }), "HTTPS://example.test/j/1");
});
