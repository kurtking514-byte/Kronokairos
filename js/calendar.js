// Calendar export (Phase 5). Builds an iCalendar (.ics) file from the saved schedule.
// Pure logic except downloadICS, which touches the DOM. Follows 01_Shared_Contract.md.

import { DAYS, joinUrl, termEnd, dayName } from "./model.js";

const CRLF = "\r\n";
const MAX_LINE_OCTETS = 75; // RFC 5545: lines are folded at 75 octets, not counting the CRLF
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const BYDAY = { Mon: "MO", Tue: "TU", Wed: "WE", Thu: "TH", Fri: "FR", Sat: "SA" };

// Added in front of every exported event title so students can find (and delete) the imported events.
// Change this one value to change the prefix. Include the trailing space.
const EVENT_TITLE_PREFIX = "[Class] ";

// ---------- text helpers ----------

// Escape a TEXT value: backslash first (so we don't double-escape), then ; , and newlines.
export function escapeText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function utf8Length(ch) {
  const code = ch.codePointAt(0);
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

// Fold one logical line at 75 octets. Continuation lines start with one space
// (which counts toward their 75). Never splits a multi-byte character.
export function foldLine(line) {
  let out = "";
  let octets = 0;
  for (const ch of line) {
    const size = utf8Length(ch);
    if (octets + size > MAX_LINE_OCTETS) {
      out += CRLF + " ";
      octets = 1;
    }
    out += ch;
    octets += size;
  }
  return out;
}

// ---------- date helpers ----------

const p2 = (n) => String(n).padStart(2, "0");

// Floating local time: YYYYMMDDTHHMMSS, no Z and no TZID.
function floating(d) {
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}` +
    `T${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}

// The device's time zone (an IANA name like "Asia/Manila"), or null if the browser can't say.
export function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

// Minutes east of UTC in `tz` at the instant `ms`, or null if this browser can't tell.
function offsetAt(ms, tz) {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
      .formatToParts(new Date(ms)).find((x) => x.type === "timeZoneName")?.value ?? "";
    if (part === "GMT") return 0;
    const m = /^GMT([+-])(\d{1,2}):?(\d{2})?$/.exec(part);
    return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : null;
  } catch {
    return null;
  }
}

const icsOffset = (min) => `${min < 0 ? "-" : "+"}${p2(Math.floor(Math.abs(min) / 60))}${p2(Math.abs(min) % 60)}`;

// Wall-clock time in a fixed offset, written YYYYMMDDTHHMMSS (for VTIMEZONE onsets).
function wallAt(ms, offsetMin) {
  const d = new Date(ms + offsetMin * 60000);
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}` +
    `T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}`;
}

// A VTIMEZONE for `tz` covering [fromMs, toMs]: the offset in force at the start, then every change
// (daylight saving) inside the range, found by stepping a day at a time and narrowing to the minute.
// Calendars need this so a class stays at the same local time after a clock change.
export function timeZoneLines(tz, fromMs, toMs) {
  const first = offsetAt(fromMs, tz);
  if (first === null) return null;
  const DAY = 86400000;
  // Summer time if the clocks are further ahead now than at some point in the year.
  const lowest = Math.min(...Array.from({ length: 12 }, (_, i) => offsetAt(fromMs + i * 30 * DAY, tz) ?? first));
  const startKind = first > lowest ? "DAYLIGHT" : "STANDARD";
  const lines = ["BEGIN:VTIMEZONE", `TZID:${tz}`,
    `BEGIN:${startKind}`, "DTSTART:19700101T000000", `TZOFFSETFROM:${icsOffset(first)}`, `TZOFFSETTO:${icsOffset(first)}`, `END:${startKind}`];
  let prevMs = fromMs, prev = first;
  for (let ms = fromMs + DAY; ms <= toMs + DAY; ms += DAY) {
    const off = offsetAt(ms, tz);
    if (off === null || off === prev) { prevMs = ms; continue; }
    let lo = prevMs, hi = ms; // the change happens after lo and at or before hi
    while (hi - lo > 60000) {
      const mid = lo + Math.floor((hi - lo) / 120000) * 60000;
      if (offsetAt(mid, tz) === prev) lo = mid; else hi = mid;
    }
    const kind = off > prev ? "DAYLIGHT" : "STANDARD";
    lines.push(`BEGIN:${kind}`, `DTSTART:${wallAt(hi, prev)}`, `TZOFFSETFROM:${icsOffset(prev)}`, `TZOFFSETTO:${icsOffset(off)}`, `END:${kind}`);
    prev = off;
    prevMs = ms;
  }
  lines.push("END:VTIMEZONE");
  return lines;
}

// DTSTAMP must be UTC, so it is the one value written with a Z.
function utcStamp(d) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// First date on or after `now` (date only) that falls on one of the subject's days.
function firstClassDate(days, now) {
  for (let offset = 0; offset < 7; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    if (days.includes(dayName(d))) return d;
  }
  return null;
}

// ---------- building blocks ----------

// Alarm lead times: the student's choices plus class start, no duplicates, earliest alert first.
function alarmLeads(state) {
  const chosen = state.settings?.calendarLeadMinutes;
  const leads = new Set([0]);
  if (Array.isArray(chosen)) {
    for (const n of chosen) if (Number.isInteger(n) && n > 0) leads.add(n);
  }
  return [...leads].sort((a, b) => b - a);
}

function alarmLines(name, lead) {
  const text = lead === 0
    ? `${name} is starting`
    : `${name} starts in ${lead} ${lead === 1 ? "minute" : "minutes"}`;
  return [
    "BEGIN:VALARM",
    `TRIGGER:-PT${lead}M`,
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(text)}`,
    "END:VALARM",
  ];
}

function descriptionText(subject, url) {
  const parts = [];
  if (url) parts.push(`Join: ${url}`);
  if (subject.meetingId) parts.push(`Meeting ID: ${subject.meetingId}`);
  if (subject.passcode) parts.push(`Passcode: ${subject.passcode}`);
  return parts.join("\n");
}

// Returns the VEVENT lines, or null if the subject cannot make a valid event.
// With a time zone, times are pinned to it (DTSTART;TZID=...) and UNTIL is in UTC, as the
// standard requires; without one they are floating local times.
function eventLines(state, subject, now, leads, tz) {
  const days = DAYS.filter((d) => Array.isArray(subject.days) && subject.days.includes(d));
  const validTime = typeof subject.start === "string" && TIME_RE.test(subject.start);
  if (!days.length || !validTime || !Number.isInteger(subject.minutes) || subject.minutes <= 0) {
    return null;
  }

  const first = firstClassDate(days, now);
  const [h, m] = subject.start.split(":").map(Number);
  const dtstart = new Date(first.getFullYear(), first.getMonth(), first.getDate(), h, m);
  const dtend = new Date(first.getFullYear(), first.getMonth(), first.getDate(), h, m + subject.minutes);

  // A custom term end before the first class would give an invalid rule, so skip the subject.
  const until = termEnd(state, first);
  if (until < dtstart) return null;

  const name = String(subject.name ?? "").trim() || "Class";
  const url = joinUrl(subject);
  const description = descriptionText(subject, url);

  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeText(subject.id)}@kronokairos`,
    `DTSTAMP:${utcStamp(now)}`,
    tz ? `DTSTART;TZID=${tz}:${floating(dtstart)}` : `DTSTART:${floating(dtstart)}`,
    tz ? `DTEND;TZID=${tz}:${floating(dtend)}` : `DTEND:${floating(dtend)}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${days.map((d) => BYDAY[d]).join(",")};UNTIL=${tz ? utcStamp(until) : floating(until)}`,
    `SUMMARY:${escapeText(EVENT_TITLE_PREFIX + name)}`,
  ];
  // URL is a URI value, not TEXT: no escaping, but whitespace and control characters are removed.
  // LOCATION too: Google Calendar and Outlook ignore URL but show the location as a tappable link.
  if (url) lines.push(`URL:${url.replace(/[\s\x00-\x1f\x7f]/g, "")}`, `LOCATION:${escapeText(url)}`);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  for (const lead of leads) lines.push(...alarmLines(name, lead));
  lines.push("END:VEVENT");
  return lines;
}

// ---------- public API ----------

// `timeZone` (an IANA name) pins every class to that zone, so the times don't move when the phone
// travels to another zone; leave it out for floating local times.
export function buildICS(state, now = new Date(), timeZone = null) {
  const leads = alarmLeads(state);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kronokairos//Class Schedule//EN",
    "CALSCALE:GREGORIAN",
  ];
  // The zone block covers yesterday to past the last class: every first class is within a week of
  // today, so its term ends at most a week after the term counted from today.
  const DAY = 86400000;
  const zone = timeZone ? timeZoneLines(timeZone, now.getTime() - DAY, termEnd(state, now).getTime() + 8 * DAY) : null;
  const tz = zone ? timeZone : null; // a zone this browser can't describe: fall back to floating times
  if (zone) lines.push(...zone);
  for (const subject of state.subjects ?? []) {
    const event = eventLines(state, subject, now, leads, tz);
    if (event) lines.push(...event);
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}

// ---------- is the phone calendar still right? ----------
// A downloaded file is a snapshot: the phone calendar never hears about later edits. So we remember
// what went into the last download and compare, to tell the student when to download again.

const CAL_KEY = "kronokairos.calendar"; // { key, subjects: [{ id, name }], at }

// Everything that changes what the file says. Same fingerprint = same file.
export function calendarFingerprint(state) {
  const subjects = (state.subjects ?? [])
    .map(({ id, name, days, start, minutes, link, meetingId, passcode }) => [id, name, days, start, minutes, link, meetingId, passcode])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const { calendarLeadMinutes, termType, termEndDate } = state.settings ?? {};
  return JSON.stringify([subjects, calendarLeadMinutes, termType, termEndDate]);
}

// kind: "empty" (no classes), "never" (never downloaded), "current", or "stale".
// removed: names of classes in the last download that are gone now (they stay in the phone calendar).
export function calendarStatus(state, saved) {
  if (!(state.subjects?.length > 0)) return { kind: "empty", removed: [] };
  if (!saved?.key) return { kind: "never", removed: [] };
  const ids = new Set(state.subjects.map((s) => s.id));
  const removed = (saved.subjects ?? []).filter((s) => !ids.has(s.id)).map((s) => s.name || "Class");
  return { kind: saved.key === calendarFingerprint(state) ? "current" : "stale", removed };
}

export function savedCalendar() {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(CAL_KEY) ?? "null");
  } catch {
    return null;
  }
}

function rememberCalendar(state) {
  try {
    const subjects = state.subjects.map(({ id, name }) => ({ id, name }));
    globalThis.localStorage?.setItem(CAL_KEY, JSON.stringify({ key: calendarFingerprint(state), subjects, at: Date.now() }));
  } catch {
    // Storage blocked: the "out of date" note just can't be shown.
  }
}

export function downloadICS(state) {
  const text = buildICS(state, new Date(), deviceTimeZone()); // pinned to this device's zone
  const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "kronokairos.ics";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  rememberCalendar(state);
}
