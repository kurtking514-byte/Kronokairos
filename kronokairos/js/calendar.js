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
function eventLines(state, subject, now, leads) {
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
    `DTSTART:${floating(dtstart)}`,
    `DTEND:${floating(dtend)}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${days.map((d) => BYDAY[d]).join(",")};UNTIL=${floating(until)}`,
    `SUMMARY:${escapeText(EVENT_TITLE_PREFIX + name)}`,
  ];
  // URL is a URI value, not TEXT: no escaping, but whitespace and control characters are removed.
  if (url) lines.push(`URL:${url.replace(/[\s\x00-\x1f\x7f]/g, "")}`);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  for (const lead of leads) lines.push(...alarmLines(name, lead));
  lines.push("END:VEVENT");
  return lines;
}

// ---------- public API ----------

export function buildICS(state, now = new Date()) {
  const leads = alarmLeads(state);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kronokairos//Class Schedule//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const subject of state.subjects ?? []) {
    const event = eventLines(state, subject, now, leads);
    if (event) lines.push(...event);
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}

export function downloadICS(state) {
  const text = buildICS(state, new Date());
  const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "kronokairos.ics";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
