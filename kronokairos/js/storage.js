import { DAYS, defaultState, newSubject } from "./model.js";

const KEY = "kronokairos.v1";
const listeners = [];

// localStorage can be missing or blocked (private mode, cookies off).
function store() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// Fill in anything missing and drop Sunday, so later code can trust the shape.
function cleanSubject(s) {
  const full = { ...newSubject(), ...s };
  full.days = Array.isArray(s.days) ? s.days.filter((d) => DAYS.includes(d)) : [];
  if (typeof full.minutes === "string" && /^\d+$/.test(full.minutes.trim())) full.minutes = Number(full.minutes);
  for (const key of ["name", "link", "meetingId", "passcode"]) if (typeof full[key] !== "string") full[key] = "";
  return full;
}

// A class with no usable time would break the screens, so it is skipped.
const usable = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s.start) && Number.isInteger(s.minutes);

function sanitize(raw) {
  if (!raw || typeof raw !== "object" || raw.version !== 1) return null;
  if (!Array.isArray(raw.subjects)) return null;
  return {
    version: 1,
    settings: { ...defaultState().settings, ...(raw.settings ?? {}) },
    subjects: raw.subjects
      .filter((s) => s && typeof s === "object" && typeof s.id === "string")
      .map(cleanSubject)
      .filter(usable),
  };
}

export function loadState() {
  try {
    const text = store()?.getItem(KEY);
    if (!text) return defaultState();
    return sanitize(JSON.parse(text)) ?? defaultState();
  } catch {
    return defaultState();
  }
}

// Returns true if the data was really written. Listeners are told either way.
export function saveState(state) {
  let ok = false;
  try {
    const s = store();
    if (s) {
      s.setItem(KEY, JSON.stringify(state));
      ok = true;
    }
  } catch {
    ok = false;
  }
  for (const cb of listeners) cb(state);
  return ok;
}

export function onChange(callback) {
  listeners.push(callback);
}

export function resetAll() {
  try {
    store()?.removeItem(KEY);
  } catch {
    /* storage blocked: nothing to clear */
  }
  const fresh = defaultState();
  for (const cb of listeners) cb(fresh);
}
