// Pure logic. No DOM, no storage. Follows 01_Shared_Contract.md exactly.

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const TERM_WEEKS = { trimester: 13, semester: 18 };

const ALL_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function defaultState() {
  return {
    version: 1,
    settings: {
      alarmLeadMinutes: 5,
      calendarLeadMinutes: [5],
      snoozeMinutes: 5,
      keepScreenOn: true,
      termType: "semester",
      termEndDate: null,
    },
    subjects: [],
  };
}

function randomId() {
  return Math.random().toString(36).slice(2, 8).padEnd(6, "0");
}

export function newSubject(partial = {}) {
  return {
    id: randomId(),
    name: "",
    color: "#3b82f6",
    days: [],
    start: "08:00",
    minutes: 60,
    link: "",
    meetingId: "",
    passcode: "",
    ...partial,
  };
}

export function validateSubject(s) {
  const errors = [];
  const warnings = [];

  if (!s || typeof s.name !== "string" || s.name.trim() === "") {
    errors.push("Enter a subject name.");
  }
  if (!Array.isArray(s?.days) || s.days.length === 0) {
    errors.push("Pick at least one day.");
  } else if (s.days.some((d) => !DAYS.includes(d))) {
    errors.push("Days must be Monday to Saturday.");
  }
  if (typeof s?.start !== "string" || !TIME_RE.test(s.start)) {
    errors.push("Enter a start time.");
  }
  if (!Number.isInteger(s?.minutes) || s.minutes < 10 || s.minutes > 300) {
    errors.push("Class length must be 10 to 300 minutes.");
  }
  if (s?.meetingId && !/^\d{9,11}$/.test(s.meetingId)) {
    errors.push("Meeting ID must be 9 to 11 digits.");
  }

  if (!s?.link && !s?.meetingId) {
    warnings.push("No link or meeting ID yet. You will not get a join button.");
  }
  if (s?.link && !/^https?:\/\//i.test(s.link)) {
    warnings.push("The link should start with https://");
  }
  if (TIME_RE.test(s?.start ?? "") && Number.isInteger(s?.minutes)) {
    if (toMinutes(s.start) + s.minutes > 1440) {
      warnings.push("This class runs past midnight.");
    }
  }
  return { errors, warnings };
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function findOverlaps(subjects) {
  const out = [];
  for (let i = 0; i < subjects.length; i++) {
    for (let j = i + 1; j < subjects.length; j++) {
      const a = subjects[i];
      const b = subjects[j];
      const aStart = toMinutes(a.start);
      const bStart = toMinutes(b.start);
      if (!(aStart < bStart + b.minutes && bStart < aStart + a.minutes)) continue;
      for (const day of a.days) {
        if (b.days.includes(day)) out.push({ a, b, day });
      }
    }
  }
  return out;
}

export function to12h(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function endTime(subject) {
  const total = (toMinutes(subject.start) + subject.minutes) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function dayName(date) {
  return ALL_DAY_NAMES[date.getDay()];
}

export function classesOn(state, day) {
  return state.subjects
    .filter((s) => s.days.includes(day))
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
}

// Looks up to 7 days ahead so a class that already started today
// is found again next week. Sunday never has classes, so it is skipped.
export function nextClass(state, now = new Date()) {
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    for (const subject of classesOn(state, dayName(day))) {
      const [h, m] = subject.start.split(":").map(Number);
      const startsAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
      if (startsAt > now) return { subject, startsAt }; // sorted, so first hit is earliest
    }
  }
  return null;
}

export function joinUrl(subject) {
  const link = (subject.link ?? "").trim();
  if (/^https?:\/\//i.test(link)) return link; // never hand a javascript: or other link to an href
  const id = (subject.meetingId ?? "").trim();
  return id ? `https://zoom.us/j/${id}` : null;
}

// Last moment repeating events may occur (the calendar UNTIL value).
// trimester/semester: end of the day before (firstDate + N weeks).
// custom: end of termEndDate; falls back to semester if the date is missing or bad.
export function termEnd(state, firstDate) {
  const { termType, termEndDate } = state.settings;
  if (termType === "custom" && /^\d{4}-\d{2}-\d{2}$/.test(termEndDate ?? "")) {
    const [y, mo, d] = termEndDate.split("-").map(Number);
    return new Date(y, mo - 1, d, 23, 59, 59);
  }
  const weeks = TERM_WEEKS[termType] ?? TERM_WEEKS.semester;
  return new Date(
    firstDate.getFullYear(), firstDate.getMonth(),
    firstDate.getDate() + weeks * 7 - 1, 23, 59, 59
  );
}
