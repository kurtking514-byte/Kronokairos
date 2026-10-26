// Phase 3A. The fixed AI prompt and a forgiving parser for the AI's reply.
// The AI never runs on this site: the student copies PROMPT to their own AI app
// and pastes the reply back here.

import { DAYS, newSubject } from "./model.js";

// Exact text from Plan section 6. Do not reword it.
export const PROMPT = `Read the attached screenshots of my class schedule and Zoom invites.
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
- If something isn't visible, use null. Never guess.`;

const RETRY_MESSAGE = "Please reply again using exactly the ZOOMCLASS-V1 format, nothing else.";
const FAIL_PREFIX = "I couldn't read that reply.";
const MAX_INPUT_CHARS = 200000; // a real reply is a few KB
const MAX_SUBJECTS = 30;
const MAX_BLOCKS_TRIED = 5;

// The AI format has no color, so give each card a different one.
const PALETTE = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

const fail = (reason) => ({
  ok: false,
  subjects: [],
  error: `${FAIL_PREFIX} ${reason}`,
  retryMessage: RETRY_MESSAGE,
});
const succeed = (subjects) => ({ ok: true, subjects, error: null, retryMessage: null });

// Never throws. On success every subject is a contract subject plus
// `missing`: the contract fields the AI left empty (for the review screen).
export function parseReply(text) {
  try {
    if (typeof text !== "string" || text.trim() === "") return fail("Nothing was pasted.");
    if (text.length > MAX_INPUT_CHARS) return fail("That is far too long to be a schedule.");
    return readBlocks(normalizeText(text));
  } catch {
    return fail("Something unexpected went wrong.");
  }
}

// Spaces, quotes and dashes that AI apps and word processors swap in.
function normalizeText(text) {
  return text
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u2010-\u2015\u2212]/g, "-");
}

// ---------- find the block ----------

function readBlocks(text) {
  const starts = [...text.matchAll(/ZOOMCLASS-V(\d+)/gi)];
  if (starts.length === 0) return fail("The ZOOMCLASS-V1 block wasn't found.");

  const v1 = starts.filter((m) => m[1] === "1");
  if (v1.length === 0) {
    return fail(`It uses format ZOOMCLASS-V${starts[0][1]}, which this site can't read yet.`);
  }

  // Try each marker in turn: the AI may mention the format name in its chatter first.
  let firstError = null;
  for (const m of v1.slice(0, MAX_BLOCKS_TRIED)) {
    const result = readOneBlock(text, m.index + m[0].length);
    if (result.ok) return result;
    firstError ??= result;
  }
  return firstError;
}

function readOneBlock(text, from) {
  const end = /END-ZOOMCLASS/gi;
  end.lastIndex = from;
  const endMatch = end.exec(text);
  // A missing END marker is forgiven if the list itself is complete.
  const body = text.slice(from, endMatch ? endMatch.index : text.length);

  const list = extractList(body);
  if (list.error) return fail(list.error);

  let items;
  try {
    items = JSON.parse(removeTrailingCommas(list.text));
  } catch {
    return fail("The list inside the block isn't valid.");
  }
  return buildSubjects(items);
}

// Finds the first [...] in the body, skipping brackets inside quoted text.
// Code fences and chatter around it are ignored.
function extractList(body) {
  const start = body.indexOf("[");
  if (start < 0) return { error: "I couldn't find the list of subjects inside the block." };
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return { text: body.slice(start, i + 1) };
  }
  return { error: "The list looks cut off before it ended." };
}

// ",]" and ",}" are not valid JSON. Leaves commas inside quoted text alone.
function removeTrailingCommas(s) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === ",") {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === "]" || s[j] === "}") continue;
    }
    out += c;
  }
  return out;
}

// ---------- turn items into subjects ----------

function buildSubjects(items) {
  if (!Array.isArray(items) || items.length === 0) return fail("The reply has no subjects in it.");
  if (items.length > MAX_SUBJECTS) return fail(`It lists more than ${MAX_SUBJECTS} subjects.`);

  const subjects = [];
  const usedIds = new Set();
  for (const item of items) {
    const subject = toSubject(item, subjects.length);
    if (!subject) continue;
    while (usedIds.has(subject.id)) subject.id = newSubject().id;
    usedIds.add(subject.id);
    subjects.push(subject);
  }
  if (subjects.length === 0) return fail("The reply has no subjects in it.");
  return succeed(subjects);
}

// Keys are matched loosely: meeting_id, meetingId and "Meeting ID" all work.
function looseFields(item) {
  const fields = new Map();
  for (const [key, value] of Object.entries(item)) {
    fields.set(key.toLowerCase().replace(/[\s_-]/g, ""), value);
  }
  return fields;
}

function toSubject(item, index) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const f = looseFields(item);

  const fields = {
    name: cleanText(f.get("subject") ?? f.get("name")),
    days: parseDays(f.get("days")),
    start: parseStart(f.get("start")),
    minutes: parseMinutes(f.get("minutes")),
    link: cleanText(f.get("link")),
    meetingId: parseMeetingId(f.get("meetingid")),
    passcode: cleanText(f.get("passcode") ?? f.get("password")),
  };

  // Empty values become "" (or [] for days) and are listed in `missing`.
  const missing = [];
  for (const [key, value] of Object.entries(fields)) {
    const empty = value === null || value === "" || (Array.isArray(value) && value.length === 0);
    if (empty) missing.push(key);
  }
  if (missing.length === Object.keys(fields).length) return null; // nothing usable

  const subject = newSubject({
    ...fields,
    start: fields.start ?? "",
    minutes: fields.minutes ?? "",
    color: PALETTE[index % PALETTE.length],
  });
  subject.missing = missing;
  return subject;
}

// Strings are trimmed (case is kept). Numbers become text. Anything else is empty.
function cleanText(v) {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

// Accepts "Mon", "monday", "Mon.", a list, or "Mon, Wed". Sunday is dropped.
function parseDays(v) {
  if (typeof v === "string") v = expandRanges(v);
  const pieces = (Array.isArray(v) ? v : [v]).flatMap((x) =>
    typeof x === "string" ? x.split(/[\s,;/&|]+/) : []
  );
  const found = new Set();
  for (const piece of pieces) {
    const m = piece.match(/^(mon|tue|wed|thu|fri|sat)[a-z]*\.?$/i);
    if (m) found.add(m[1][0].toUpperCase() + m[1].slice(1).toLowerCase());
  }
  return DAYS.filter((d) => found.has(d));
}

// "Mon-Fri" or "Monday to Friday" becomes "Mon Tue Wed Thu Fri".
function expandRanges(text) {
  const re = /\b(mon|tue|wed|thu|fri|sat)[a-z]*\.?\s*(?:-|to|through)\s*(mon|tue|wed|thu|fri|sat)[a-z]*/gi;
  return text.replace(re, (_, a, b) => {
    const from = DAYS.findIndex((d) => d.toLowerCase() === a.toLowerCase());
    const to = DAYS.findIndex((d) => d.toLowerCase() === b.toLowerCase());
    return from <= to ? DAYS.slice(from, to + 1).join(" ") : `${a} ${b}`;
  });
}

// Returns "HH:MM" (24-hour) or null. Converts "7:30 AM" style times.
function parseStart(v) {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(?:([ap])\.?\s*m\.?)?$/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  const half = m[3]?.toLowerCase();
  if (m[2] === undefined && !half) return null; // a bare "7" is too vague
  if (minute > 59) return null;
  if (!half && m[1].length === 1) return null; // "1:30" with no AM/PM could be morning or afternoon
  if (half) {
    if (hour < 1 || hour > 12) return null;
    if (half === "a") hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  } else if (hour > 23) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// Whole minutes, 10 to 300. Anything else (or unreadable) counts as missing.
function parseMinutes(v) {
  let n = NaN;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*(?:m|min|mins|minutes?)?\.?$/i);
    if (m) n = parseFloat(m[1]);
  }
  if (!Number.isFinite(n) || n <= 0) return null;
  n = Math.round(n);
  return n >= 10 && n <= 300 ? n : null; // out of range is flagged for the student, not quietly changed
}

// Digits only. Length is checked later by the review screen.
function parseMeetingId(v) {
  if (typeof v === "number" && !Number.isSafeInteger(v)) return "";
  if (typeof v !== "string" && typeof v !== "number") return "";
  return String(v).replace(/\D/g, "");
}
