// Phase 4. The page alarm engine: decides WHEN to ring. It has no screen of its own;
// js/ui/alarmPopup.js listens with onAlarm() and shows the popup and plays the sound.
// Alarms only work while this page is open. The calendar file is the backup.

import { classesOn, dayName } from "./model.js";

const CHECK_MS = 5000; // how often we look at the clock
const CATCH_UP_MS = 10 * 60 * 1000; // ring an alarm we slept through, up to 10 minutes late
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

let getStateFn = null;
let timer = null;
let running = false;
let wakeLock = null;
let wakePending = false;

const listeners = [];
const fired = new Set(); // "YYYY-MM-DD|subjectId|early" or "...|start": each rings once per day
const snoozes = new Map(); // subjectId -> { at (ms), startsAt, kind }
const lastAlarm = new Map(); // subjectId -> { startsAt, kind }, so a snooze rings the same kind again

const pad = (n) => String(n).padStart(2, "0");
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function startsAtToday(subject, now) {
  const m = TIME_RE.exec(subject.start ?? "");
  if (!m) return null; // a class without a valid time never rings
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(m[1]), Number(m[2]));
}

function emit(subject, startsAt, kind) {
  lastAlarm.set(subject.id, { startsAt, kind });
  for (const callback of [...listeners]) {
    try {
      callback({ subject, startsAt, kind });
    } catch {
      /* one broken listener must not stop the others */
    }
  }
}

function readState() {
  try {
    const state = getStateFn?.();
    return state && Array.isArray(state.subjects) ? state : null;
  } catch {
    return null;
  }
}

function leadMinutes(state) {
  const n = Number(state.settings?.alarmLeadMinutes);
  return Number.isFinite(n) && n >= 0 ? n : 5;
}

// Forget yesterday's "already rang" marks.
function pruneFired(now) {
  const today = dateKey(now);
  for (const key of fired) if (!key.startsWith(today)) fired.delete(key);
}

function fireDueSnoozes(state, now) {
  for (const [id, s] of [...snoozes]) {
    if (now.getTime() < s.at) continue;
    snoozes.delete(id);
    // A snoozed "early" alarm that runs out after class began is dropped: the start alarm covers it.
    if (s.kind === "early" && now >= s.startsAt) continue;
    const subject = state.subjects.find((x) => x.id === id);
    if (subject) emit(subject, s.startsAt, s.kind); // a deleted subject just drops its snooze
  }
}

// Looks at the clock once. The timer calls this every few seconds.
// Exported so it can be tested with a pretend clock.
export function checkAlarms(now = new Date()) {
  const state = readState();
  if (!state) return;
  pruneFired(now);
  fireDueSnoozes(state, now);

  const day = dayName(now);
  if (day === "Sun") return; // no Sunday classes, no Sunday alarms
  const lead = leadMinutes(state);

  for (const subject of classesOn(state, day)) {
    const startsAt = startsAtToday(subject, now);
    if (!startsAt) continue;
    const keyBase = `${dateKey(now)}|${subject.id}|`;
    const earlyAt = new Date(startsAt.getTime() - lead * 60000);

    const earlyDue = lead > 0 && now >= earlyAt && now < startsAt && now - earlyAt <= CATCH_UP_MS;
    if (earlyDue && !fired.has(`${keyBase}early`)) {
      fired.add(`${keyBase}early`);
      emit(subject, startsAt, "early");
    }
    const startDue = now >= startsAt && now - startsAt <= CATCH_UP_MS;
    if (startDue && !fired.has(`${keyBase}start`)) {
      fired.add(`${keyBase}start`);
      fired.add(`${keyBase}early`); // too late for the early one once class has started
      emit(subject, startsAt, "start");
    }
  }
}

// Call once, from the tap on "Start alarms". getState must return the current state.
export function startAlarms(getState) {
  getStateFn = typeof getState === "function" ? getState : null;
  if (!running) {
    running = true;
    timer = setInterval(() => checkAlarms(), CHECK_MS);
  }
  checkAlarms();
  syncWakeLock();
}

export function stopAlarms() {
  running = false;
  if (timer) clearInterval(timer);
  timer = null;
  snoozes.clear();
  syncWakeLock();
}

// Returns a function that removes this listener.
export function onAlarm(callback) {
  if (typeof callback !== "function") return () => {};
  listeners.push(callback);
  return () => {
    const i = listeners.indexOf(callback);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function snooze(subjectId, minutes) {
  const state = readState();
  let mins = Number(minutes);
  if (!Number.isFinite(mins) || mins <= 0) {
    mins = Number(state?.settings?.snoozeMinutes);
    if (!Number.isFinite(mins) || mins <= 0) mins = 5;
  }
  const last = lastAlarm.get(subjectId);
  snoozes.set(subjectId, {
    at: Date.now() + mins * 60000,
    startsAt: last?.startsAt ?? new Date(),
    kind: last?.kind ?? "start",
  });
}

// Extra helper for the Today screen's "Alarms on / off" chip.
export function alarmsRunning() {
  return running;
}

// ---------- keep the screen on (optional, fails quietly) ----------

async function syncWakeLock() {
  try {
    const wanted = running && readState()?.settings?.keepScreenOn === true;
    if (!wanted) {
      const lock = wakeLock;
      wakeLock = null;
      await lock?.release();
      return;
    }
    if (wakeLock || wakePending) return;
    if (typeof navigator === "undefined" || !navigator.wakeLock) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    wakePending = true;
    const lock = await navigator.wakeLock.request("screen");
    wakePending = false;
    if (!running) {
      await lock.release();
      return;
    }
    wakeLock = lock;
    lock.addEventListener("release", () => {
      if (wakeLock === lock) wakeLock = null;
    });
  } catch {
    wakePending = false; // unsupported, denied, or low battery: carry on without it
  }
}

// When the student comes back to the page: catch up on anything missed, and
// get the wake lock back (browsers drop it whenever the page is hidden).
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!running || document.visibilityState !== "visible") return;
    checkAlarms();
    syncWakeLock();
  });
}
