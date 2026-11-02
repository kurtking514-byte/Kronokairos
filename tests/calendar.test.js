import assert from "node:assert/strict";
import { defaultState, newSubject } from "../js/model.js";
import { buildICS, downloadICS, escapeText, foldLine, calendarFingerprint, calendarStatus } from "../js/calendar.js";

export const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// 26 Oct 2026 is a Monday. Fake data only.
const NOW = new Date(2026, 9, 26, 12, 15);

const subj = (o = {}) =>
  newSubject({
    id: "abc123", name: "Math", days: ["Mon", "Wed", "Fri"], start: "07:30", minutes: 80,
    link: "https://example.test/j/123456789?pwd=FAKE", meetingId: "123456789", passcode: "Fake1x",
    ...o,
  });
const stateWith = (subjects, settings = {}) => {
  const s = defaultState();
  s.settings = { ...s.settings, ...settings };
  s.subjects = Array.isArray(subjects) ? subjects : [subjects];
  return s;
};

// ---- parsing helpers (kept simple on purpose) ----
const unfold = (ics) => ics.replace(/\r\n[ \t]/g, "");
const logical = (ics) => unfold(ics).split("\r\n").filter((l) => l !== "");
const events = (ics) => {
  const out = [];
  let cur = null;
  for (const l of logical(ics)) {
    if (l === "BEGIN:VEVENT") cur = [];
    else if (l === "END:VEVENT") { out.push(cur); cur = null; }
    else if (cur) cur.push(l);
  }
  return out;
};
const eventOnly = (ev) => ev.slice(0, ev.indexOf("BEGIN:VALARM") === -1 ? ev.length : ev.indexOf("BEGIN:VALARM"));
const prop = (ev, name) => {
  const line = eventOnly(ev).find((l) => l.startsWith(name + ":") || l.startsWith(name + ";"));
  return line === undefined ? undefined : line.slice(line.indexOf(":") + 1);
};
const triggers = (ev) => ev.filter((l) => l.startsWith("TRIGGER:")).map((l) => l.slice(8));
const first = (ics) => events(ics)[0];
const physicalLines = (ics) => ics.split("\r\n").slice(0, -1);
const octets = (s) => Buffer.byteLength(s, "utf8");

// ---------- file structure ----------
t("wraps everything in a VCALENDAR with the required header lines", () => {
  const lines = logical(buildICS(stateWith(subj()), NOW));
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.equal(lines.at(-1), "END:VCALENDAR");
  assert.ok(lines.includes("VERSION:2.0"));
  assert.ok(lines.includes("CALSCALE:GREGORIAN"));
  assert.ok(lines.some((l) => l.startsWith("PRODID:")));
});
t("every line ends with CRLF and there are no bare line feeds", () => {
  const ics = buildICS(stateWith(subj()), NOW);
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/(^|[^\r])\n/.test(ics));
  assert.ok(!/\r(?!\n)/.test(ics));
});
t("BEGIN and END lines are balanced", () => {
  const lines = logical(buildICS(stateWith([subj(), subj({ id: "x2", name: "Sci" })]), NOW));
  for (const kind of ["VCALENDAR", "VEVENT", "VALARM"]) {
    assert.equal(lines.filter((l) => l === `BEGIN:${kind}`).length, lines.filter((l) => l === `END:${kind}`).length, kind);
  }
});
t("no subjects gives a valid calendar with no events", () => {
  const ics = buildICS(defaultState(), NOW);
  assert.equal(events(ics).length, 0);
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
});
t("one VEVENT per class per weekday", () => {
  const ics = buildICS(stateWith([subj(), subj({ id: "b2", name: "English", days: ["Tue"] }), subj({ id: "c3", name: "Sci", days: ["Mon", "Sat"] })]), NOW);
  assert.equal(events(ics).length, 3 + 1 + 2);
});
t("each weekday event has its own UID", () => {
  const uids = events(buildICS(stateWith(subj()), NOW)).map((ev) => prop(ev, "UID"));
  assert.deepEqual(uids, ["abc123-MO@kronokairos", "abc123-WE@kronokairos", "abc123-FR@kronokairos"]);
});
t("every event has the required properties", () => {
  const ev = first(buildICS(stateWith(subj()), NOW));
  for (const p of ["UID", "DTSTAMP", "DTSTART", "DTEND", "RRULE", "SUMMARY"]) assert.ok(prop(ev, p) !== undefined, p);
});
t("buildICS does not change the state it is given", () => {
  const s = stateWith(subj());
  const before = JSON.stringify(s);
  buildICS(s, NOW);
  assert.equal(JSON.stringify(s), before);
});

// ---------- recurrence and days ----------
// Google Calendar on Android keeps only the first day of BYDAY=MO,WE,FR, so each day is its own event.
const bydays = (ics) => events(ics).map((ev) => /BYDAY=([A-Z,]+)/.exec(prop(ev, "RRULE"))[1]);
t("a weekly RRULE with a single BYDAY per event", () => {
  const evs = events(buildICS(stateWith(subj()), NOW));
  assert.ok(prop(evs[0], "RRULE").startsWith("FREQ=WEEKLY;BYDAY=MO;UNTIL="), prop(evs[0], "RRULE"));
  assert.deepEqual(bydays(buildICS(stateWith(subj()), NOW)), ["MO", "WE", "FR"]);
});
t("all six days become six events, in week order", () => {
  const all = subj({ days: ["Sat", "Fri", "Thu", "Wed", "Tue", "Mon"] });
  assert.deepEqual(bydays(buildICS(stateWith(all), NOW)), ["MO", "TU", "WE", "TH", "FR", "SA"]);
  assert.deepEqual(bydays(buildICS(stateWith(subj({ days: ["Sat", "Mon"] })), NOW)), ["MO", "SA"]);
});
t("each weekday event starts on that weekday", () => {
  const starts = events(buildICS(stateWith(subj()), NOW)).map((ev) => prop(ev, "DTSTART"));
  assert.deepEqual(starts, ["20261026T073000", "20261028T073000", "20261030T073000"]);
});
t("every weekday event of a class ends the same term", () => {
  const untils = events(buildICS(stateWith(subj()), NOW)).map((ev) => prop(ev, "RRULE").split("UNTIL=")[1]);
  assert.deepEqual(untils, ["20270228T235959", "20270228T235959", "20270228T235959"]);
});
t("Sunday never appears: it is dropped, and a Sunday-only subject is skipped", () => {
  const ics = buildICS(stateWith([subj({ days: ["Mon", "Sun"] }), subj({ id: "s9", days: ["Sun"] })]), NOW);
  assert.equal(events(ics).length, 1);
  const rule = prop(first(ics), "RRULE");
  assert.ok(rule.includes("BYDAY=MO;"));
  assert.ok(!/BYDAY=[^;\r\n]*SU/.test(unfold(ics)));
});
t("subjects with no usable start, length or days are skipped", () => {
  const bad = [subj({ id: "a", days: [] }), subj({ id: "b", start: "" }), subj({ id: "c", minutes: "" }), subj({ id: "d", minutes: 0 })];
  assert.equal(events(buildICS(stateWith(bad), NOW)).length, 0);
});

// ---------- DTSTART / DTEND ----------
t("DTSTART is today when today is a class day, even if the class already started", () => {
  assert.equal(prop(first(buildICS(stateWith(subj()), NOW)), "DTSTART"), "20261026T073000");
});
t("DTSTART is the first matching day on or after now", () => {
  const wed = subj({ days: ["Wed", "Fri"] });
  assert.equal(prop(first(buildICS(stateWith(wed), NOW)), "DTSTART"), "20261028T073000");
  const sat = new Date(2026, 9, 31, 20, 0);
  assert.deepEqual(events(buildICS(stateWith(subj({ days: ["Mon", "Sat"] }), {}), sat)).map((ev) => prop(ev, "DTSTART")), ["20261102T073000", "20261031T073000"]);
  assert.equal(prop(first(buildICS(stateWith(subj({ days: ["Mon"] })), sat)), "DTSTART"), "20261102T073000");
});
t("DTSTART never lands on a Sunday", () => {
  const sun = new Date(2026, 10, 1, 9, 0);
  assert.equal(prop(first(buildICS(stateWith(subj({ days: ["Mon", "Tue"] })), sun)), "DTSTART"), "20261102T073000");
});
t("DTEND is start plus the class length", () => {
  assert.equal(prop(first(buildICS(stateWith(subj()), NOW)), "DTEND"), "20261026T085000");
});
t("DTEND crosses midnight into the next day", () => {
  const ev = first(buildICS(stateWith(subj({ start: "23:30", minutes: 60, days: ["Mon"] })), NOW));
  assert.equal(prop(ev, "DTSTART"), "20261026T233000");
  assert.equal(prop(ev, "DTEND"), "20261027T003000");
});
t("DTSTART, DTEND and UNTIL are floating (no Z, no TZID)", () => {
  const ev = first(buildICS(stateWith(subj()), NOW));
  const lines = eventOnly(ev);
  assert.ok(!lines.some((l) => l.startsWith("DTSTART;") || l.startsWith("DTEND;")));
  assert.match(prop(ev, "DTSTART"), /^\d{8}T\d{6}$/);
  assert.match(prop(ev, "DTEND"), /^\d{8}T\d{6}$/);
  assert.match(prop(ev, "RRULE"), /UNTIL=\d{8}T\d{6}$/);
});
// ---------- time zone (the real download pins classes to the device's zone) ----------
const zoneBlock = (ics) => {
  const ls = logical(ics);
  return ls.slice(ls.indexOf("BEGIN:VTIMEZONE"), ls.indexOf("END:VTIMEZONE") + 1);
};
t("with a time zone, DTSTART and DTEND carry its TZID and UNTIL is in UTC", () => {
  const ev = first(buildICS(stateWith(subj()), NOW, "America/New_York"));
  const lines = eventOnly(ev);
  assert.ok(lines.includes("DTSTART;TZID=America/New_York:20261026T073000"), lines.join("\n"));
  assert.ok(lines.includes("DTEND;TZID=America/New_York:20261026T085000"));
  assert.match(prop(ev, "RRULE"), /UNTIL=\d{8}T\d{6}Z$/);
});
t("with a time zone, a VTIMEZONE for it comes before the events", () => {
  const ics = buildICS(stateWith(subj()), NOW, "America/New_York");
  const ls = logical(ics);
  assert.ok(ls.indexOf("TZID:America/New_York") > -1);
  assert.ok(ls.indexOf("END:VTIMEZONE") < ls.indexOf("BEGIN:VEVENT"));
});
t("the zone block includes a daylight-saving change inside the term", () => {
  const z = zoneBlock(buildICS(stateWith(subj()), NOW, "America/New_York"));
  // New York starts on summer time (-4) and falls back to -5 at 2 AM on 1 Nov 2026.
  assert.equal(z[2], "BEGIN:DAYLIGHT");
  assert.ok(z.includes("TZOFFSETTO:-0400"));
  const i = z.indexOf("DTSTART:20261101T020000");
  assert.ok(i > 0, z.join("\n"));
  assert.equal(z[i + 1], "TZOFFSETFROM:-0400");
  assert.equal(z[i + 2], "TZOFFSETTO:-0500");
});
t("a zone with no daylight saving has a single fixed offset", () => {
  const z = zoneBlock(buildICS(stateWith(subj()), NOW, "Asia/Manila"));
  assert.equal(z.filter((l) => l.startsWith("BEGIN:STANDARD") || l.startsWith("BEGIN:DAYLIGHT")).length, 1);
  assert.ok(z.includes("TZOFFSETTO:+0800"));
});
t("an unknown time zone falls back to floating times instead of a broken file", () => {
  const ics = buildICS(stateWith(subj()), NOW, "Not/AZone");
  assert.ok(!ics.includes("VTIMEZONE"));
  assert.equal(prop(first(ics), "DTSTART"), "20261026T073000");
  assert.ok(!eventOnly(first(ics)).some((l) => l.startsWith("DTSTART;")));
});
t("DTSTAMP is written in UTC", () => {
  assert.equal(prop(first(buildICS(stateWith(subj()), NOW)), "DTSTAMP"), "20261026T041500Z");
});

// ---------- UNTIL / term end ----------
const untilOf = (state, now = NOW) => prop(first(buildICS(state, now)), "RRULE").split("UNTIL=")[1];

t("UNTIL for semester is 18 weeks from the first class, end of the day before", () => {
  assert.equal(untilOf(stateWith(subj())), "20270228T235959");
});
t("UNTIL for trimester is 13 weeks", () => {
  assert.equal(untilOf(stateWith(subj(), { termType: "trimester" })), "20270124T235959");
});
t("UNTIL for a custom date is the end of that day", () => {
  assert.equal(untilOf(stateWith(subj(), { termType: "custom", termEndDate: "2027-03-15" })), "20270315T235959");
});
t("custom term without a date falls back to semester", () => {
  assert.equal(untilOf(stateWith(subj(), { termType: "custom", termEndDate: null })), "20270228T235959");
});
t("UNTIL is counted from each subject's own first class date", () => {
  const s = stateWith([subj({ days: ["Mon"] }), subj({ id: "w", days: ["Wed"] })]);
  const [a, b] = events(buildICS(s, NOW)).map((ev) => prop(ev, "RRULE").split("UNTIL=")[1]);
  assert.equal(a, "20270228T235959");
  assert.equal(b, "20270302T235959");
});
t("a custom term end before the first class skips the subject instead of writing a bad rule", () => {
  const s = stateWith(subj(), { termType: "custom", termEndDate: "2026-10-01" });
  assert.equal(events(buildICS(s, NOW)).length, 0);
});

// ---------- text fields ----------
t("SUMMARY is the [Class] prefix followed by the subject name", () => {
  assert.equal(prop(first(buildICS(stateWith(subj({ name: "PathFit" })), NOW)), "SUMMARY"), "[Class] PathFit");
  assert.equal(prop(first(buildICS(stateWith(subj()), NOW)), "SUMMARY"), "[Class] Math");
});
t("the raw SUMMARY line in the file is SUMMARY:[Class] Math", () => {
  assert.ok(buildICS(stateWith(subj()), NOW).includes("\r\nSUMMARY:[Class] Math\r\n"));
});
t("every event gets the prefix, and alarm descriptions keep the plain subject name", () => {
  const evs = events(buildICS(stateWith([subj({ days: ["Mon"] }), subj({ id: "b2", name: "Sci", days: ["Mon"] })]), NOW));
  assert.deepEqual(evs.map((ev) => prop(ev, "SUMMARY")), ["[Class] Math", "[Class] Sci"]);
  assert.ok(evs[0].includes("DESCRIPTION:Math is starting"));
});
t("a blank name falls back to Class", () => {
  assert.equal(prop(first(buildICS(stateWith(subj({ name: "  " })), NOW)), "SUMMARY"), "[Class] Class");
});
t("URL is the invite link", () => {
  assert.equal(prop(first(buildICS(stateWith(subj()), NOW)), "URL"), "https://example.test/j/123456789?pwd=FAKE");
});
t("LOCATION also holds the join link, so Google Calendar and Outlook show it", () => {
  assert.equal(prop(first(buildICS(stateWith(subj()), NOW)), "LOCATION"), "https://example.test/j/123456789?pwd=FAKE");
  assert.equal(prop(first(buildICS(stateWith(subj({ link: "" })), NOW)), "LOCATION"), "https://zoom.us/j/123456789");
});
t("URL falls back to zoom.us with the meeting ID", () => {
  const ev = first(buildICS(stateWith(subj({ link: "" })), NOW));
  assert.equal(prop(ev, "URL"), "https://zoom.us/j/123456789");
});
t("subject with no link and no meeting ID has no URL and no DESCRIPTION", () => {
  const ev = first(buildICS(stateWith(subj({ link: "", meetingId: "", passcode: "" })), NOW));
  assert.equal(prop(ev, "URL"), undefined);
  assert.equal(prop(ev, "LOCATION"), undefined);
  assert.equal(prop(ev, "DESCRIPTION"), undefined);
  assert.equal(prop(ev, "SUMMARY"), "[Class] Math");
});
t("DESCRIPTION has the join link, meeting ID and passcode on separate lines", () => {
  const d = prop(first(buildICS(stateWith(subj()), NOW)), "DESCRIPTION");
  assert.equal(d, "Join: https://example.test/j/123456789?pwd=FAKE\\nMeeting ID: 123456789\\nPasscode: Fake1x");
});
t("DESCRIPTION leaves out the passcode line when there is no passcode", () => {
  const d = prop(first(buildICS(stateWith(subj({ passcode: "" })), NOW)), "DESCRIPTION");
  assert.ok(d.includes("Meeting ID: 123456789"));
  assert.ok(!d.includes("Passcode"));
});
t("DESCRIPTION uses the zoom.us fallback link when only a meeting ID exists", () => {
  const d = prop(first(buildICS(stateWith(subj({ link: "" })), NOW)), "DESCRIPTION");
  assert.ok(d.startsWith("Join: https://zoom.us/j/123456789\\n"));
});

// ---------- escaping ----------
t("escapeText handles backslash, semicolon, comma and newline", () => {
  assert.equal(escapeText("a\\b;c,d\ne"), "a\\\\b\\;c\\,d\\ne");
  assert.equal(escapeText("a\r\nb"), "a\\nb");
});
t("backslashes are escaped first, so escapes are not doubled", () => {
  assert.equal(escapeText(";"), "\\;");
  assert.equal(escapeText("\\;"), "\\\\\\;");
});
t("special characters in the name and passcode are escaped in the file", () => {
  const ev = first(buildICS(stateWith(subj({ name: "Math, Sci; A\\B\nC", passcode: "a,b;c" })), NOW));
  assert.equal(prop(ev, "SUMMARY"), "[Class] Math\\, Sci\\; A\\\\B\\nC");
  assert.ok(prop(ev, "DESCRIPTION").endsWith("Passcode: a\\,b\\;c"));
});
t("a raw newline in a field can never create a new line in the file", () => {
  const ics = buildICS(stateWith(subj({ name: "Line1\nSUMMARY:Evil", passcode: "x\r\ny" })), NOW);
  assert.ok(!logical(ics).some((l) => l === "SUMMARY:Evil"));
});
t("whitespace inside a link is removed from URL", () => {
  const ev = first(buildICS(stateWith(subj({ link: "https://example.test/j/1\nBEGIN:VEVENT" })), NOW));
  assert.ok(!prop(ev, "URL").includes("\n"));
  assert.equal(events(buildICS(stateWith(subj({ days: ["Mon"], link: "https://example.test/j/1\nBEGIN:VEVENT" })), NOW)).length, 1);
});

// ---------- folding ----------
t("foldLine leaves short lines alone and folds a 200-character line at 75 octets", () => {
  assert.equal(foldLine("SUMMARY:Math"), "SUMMARY:Math");
  const folded = foldLine("a".repeat(200)).split("\r\n");
  assert.equal(octets(folded[0]), 75);
  for (const part of folded.slice(1)) {
    assert.ok(part.startsWith(" "));
    assert.ok(octets(part) <= 75);
  }
  assert.equal(folded.join("").replace(/ /g, ""), "a".repeat(200));
});
t("a line of exactly 75 octets is not folded; 76 is", () => {
  assert.ok(!foldLine("x".repeat(75)).includes("\r\n"));
  assert.ok(foldLine("x".repeat(76)).includes("\r\n"));
});
t("no physical line in the file is longer than 75 octets", () => {
  const long = subj({ link: "https://example.test/j/123456789?pwd=" + "A1b2C3".repeat(30), name: "Long subject name ".repeat(8) });
  for (const line of physicalLines(buildICS(stateWith(long), NOW))) assert.ok(octets(line) <= 75, line);
});
t("unfolding restores the original text exactly", () => {
  const name = "Long subject name ".repeat(8).trim();
  const ev = first(buildICS(stateWith(subj({ name })), NOW));
  assert.equal(prop(ev, "SUMMARY"), "[Class] " + name);
});
t("folding counts octets, not characters, and never splits a multi-byte character", () => {
  const name = "Ñandú ñ é ✓ ".repeat(12).trim() + "😀".repeat(20);
  const ics = buildICS(stateWith(subj({ name })), NOW);
  for (const line of physicalLines(ics)) assert.ok(octets(line) <= 75, `${octets(line)} octets`);
  assert.equal(prop(first(ics), "SUMMARY"), "[Class] " + name);
  assert.ok(!ics.includes("\uFFFD"));
});

// ---------- UID ----------
t("UID is <subject-id>-<weekday>@kronokairos", () => {
  assert.equal(prop(first(buildICS(stateWith(subj({ id: "k9z8y7" })), NOW)), "UID"), "k9z8y7-MO@kronokairos");
});
t("UID stays the same across exports and edits to the subject", () => {
  const a = prop(first(buildICS(stateWith(subj()), NOW)), "UID");
  const b = prop(first(buildICS(stateWith(subj({ name: "Renamed", start: "09:00" })), new Date(2026, 10, 3))), "UID");
  assert.equal(a, b);
});
t("different subjects get different UIDs", () => {
  const uids = events(buildICS(stateWith([subj(), subj({ id: "zzz999" })]), NOW)).map((e) => prop(e, "UID"));
  assert.equal(new Set(uids).size, 6); // two classes on three days each
});
t("the same input and time give the same file", () => {
  const s = stateWith(subj());
  assert.equal(buildICS(s, NOW), buildICS(s, NOW));
});

// ---------- alarms ----------
t("default settings give an early alarm plus one at class start", () => {
  assert.deepEqual(triggers(first(buildICS(stateWith(subj()), NOW))), ["-PT5M", "-PT0M"]);
});
t("several lead times each get an alarm, earliest first, plus the start alarm", () => {
  const s = stateWith(subj(), { calendarLeadMinutes: [5, 10] });
  assert.deepEqual(triggers(first(buildICS(s, NOW))), ["-PT10M", "-PT5M", "-PT0M"]);
});
t("duplicate lead times and 0 do not create duplicate triggers", () => {
  const s = stateWith(subj(), { calendarLeadMinutes: [0, 5, 5, 10, 10, 0] });
  assert.deepEqual(triggers(first(buildICS(s, NOW))), ["-PT10M", "-PT5M", "-PT0M"]);
});
t("an empty or missing lead list still gives the start alarm", () => {
  assert.deepEqual(triggers(first(buildICS(stateWith(subj(), { calendarLeadMinutes: [] }), NOW))), ["-PT0M"]);
  assert.deepEqual(triggers(first(buildICS(stateWith(subj(), { calendarLeadMinutes: undefined }), NOW))), ["-PT0M"]);
});
t("invalid lead values are ignored", () => {
  const s = stateWith(subj(), { calendarLeadMinutes: [-5, 2.5, "10", null, 15] });
  assert.deepEqual(triggers(first(buildICS(s, NOW))), ["-PT15M", "-PT0M"]);
});
t("each VALARM is a DISPLAY alarm with a description", () => {
  const ev = first(buildICS(stateWith(subj()), NOW));
  assert.equal(ev.filter((l) => l === "ACTION:DISPLAY").length, 2);
  assert.ok(ev.includes("DESCRIPTION:Math is starting"));
  assert.ok(ev.includes("DESCRIPTION:Math starts in 5 minutes"));
});
t("every subject gets its own alarms", () => {
  const evs = events(buildICS(stateWith([subj(), subj({ id: "b2", name: "Sci" })]), NOW));
  for (const ev of evs) assert.deepEqual(triggers(ev), ["-PT5M", "-PT0M"]);
});

// ---------- downloadICS ----------
t("downloadICS creates a Blob and clicks a link named kronokairos.ics", async () => {
  const realDoc = globalThis.document;
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  let blob = null;
  let anchor = null;
  let appended = false;
  globalThis.document = {
    createElement: () => (anchor = { clicked: false, removed: false, click() { this.clicked = true; }, remove() { this.removed = true; } }),
    body: { appendChild: () => { appended = true; } },
  };
  URL.createObjectURL = (b) => { blob = b; return "blob:fake"; };
  URL.revokeObjectURL = () => {};
  try {
    downloadICS(stateWith(subj()));
    assert.equal(anchor.download, "kronokairos.ics");
    assert.equal(anchor.href, "blob:fake");
    assert.ok(anchor.clicked && anchor.removed && appended);
    assert.ok(blob.type.startsWith("text/calendar"));
    assert.ok((await blob.text()).startsWith("BEGIN:VCALENDAR\r\n"));
  } finally {
    globalThis.document = realDoc;
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
  }
});

// ---------- is the phone calendar still right? ----------
const savedFor = (state) => ({ key: calendarFingerprint(state), subjects: state.subjects.map(({ id, name }) => ({ id, name })) });
t("calendar status: no classes, never downloaded, then current", () => {
  assert.equal(calendarStatus(stateWith([]), null).kind, "empty");
  const s = stateWith(subj({ id: "m1", name: "Math" }));
  assert.equal(calendarStatus(s, null).kind, "never");
  assert.equal(calendarStatus(s, savedFor(s)).kind, "current");
});
t("calendar status: editing a time, a link or the term makes it stale", () => {
  const s = stateWith(subj({ id: "m1" }));
  const saved = savedFor(s);
  assert.equal(calendarStatus({ ...s, subjects: [{ ...s.subjects[0], start: "09:00" }] }, saved).kind, "stale");
  assert.equal(calendarStatus({ ...s, subjects: [{ ...s.subjects[0], link: "https://zoom.us/j/1" }] }, saved).kind, "stale");
  assert.equal(calendarStatus({ ...s, settings: { ...s.settings, termType: "trimester" } }, saved).kind, "stale");
});
t("calendar status: a colour change or reordering does not count", () => {
  const a = subj({ id: "a1", name: "Math" }), b = subj({ id: "b2", name: "Art" });
  const s = stateWith([a, b]);
  const saved = savedFor(s);
  assert.equal(calendarStatus({ ...s, subjects: [b, { ...a, color: "#ff0000" }] }, saved).kind, "current");
});
t("calendar status: a deleted class is named so it can be removed from the phone", () => {
  const a = subj({ id: "a1", name: "Math" }), b = subj({ id: "b2", name: "Art" });
  const saved = savedFor(stateWith([a, b]));
  const now = calendarStatus(stateWith([a]), saved);
  assert.equal(now.kind, "stale");
  assert.deepEqual(now.removed, ["Art"]);
});
