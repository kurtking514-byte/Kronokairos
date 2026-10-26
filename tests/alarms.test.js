import assert from "node:assert/strict";
import { defaultState, newSubject, dayName } from "../js/model.js";
import { startAlarms, stopAlarms, onAlarm, snooze, checkAlarms, alarmsRunning } from "../js/alarms.js";

export const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// Fake data and pretend times only. These tests do NOT check real sound, vibration,
// Wake Lock, notifications, or Join links on a real device. Test those by hand (Phase 4, Step A).
//
// The engine keeps its "already rang" and snooze records in module-level state that the tests
// cannot reset. So every test uses its own Monday (one week apart, far in the future) and its
// own subject ids, and each test stops the engine and removes its listeners when it ends.

let dateSeq = 0;
let idSeq = 0;

// A fresh Monday for every call: Jan 6 2031, Jan 13 2031, ...
const nextMonday = () => {
  const d = new Date(2031, 0, 6 + 7 * dateSeq++);
  assert.equal(dayName(d), "Mon", "test helper must hand out Mondays");
  return d;
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// at(date, "08:55") or at(date, "08:55:30") -> local Date on that day
const at = (d, hms) => {
  const [h, m, s = 0] = hms.split(":").map(Number);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, s);
};
const seconds = (hms) => {
  const [h, m, s = 0] = hms.split(":").map(Number);
  return h * 3600 + m * 60 + s;
};

// A class with a unique id. Defaults: every day Monday to Saturday, 09:00, 60 minutes.
const sub = (o = {}) =>
  newSubject({
    id: `alarm-test-${++idSeq}`,
    name: "Fake Class",
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    start: "09:00",
    minutes: 60,
    ...o,
  });

const stateOf = (subjects, settings = {}) => {
  const s = defaultState();
  s.settings = { ...s.settings, keepScreenOn: false, ...settings }; // no Wake Lock in these tests
  s.subjects = Array.isArray(subjects) ? subjects : [subjects];
  return s;
};

// Looks at the clock every 5 seconds from `from` to `to` (inclusive), like the real timer does.
const sweep = (d, from, to, stepSec = 5) => {
  for (let sec = seconds(from); sec <= seconds(to); sec += stepSec) {
    checkAlarms(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, sec));
  }
};

const kinds = (events) => events.map((e) => e.kind);

// Runs `body` with the engine started on `state`, the interval timer replaced by a recorder
// (so no real timer is ever left running), and a listener collecting alarms.
// Everything is put back in `finally`, whatever happens.
async function withEngine(state, body) {
  const realSet = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  const timers = { started: [], cleared: [] };
  globalThis.setInterval = (callback, ms) => {
    const handle = { callback, ms };
    timers.started.push(handle);
    return handle;
  };
  globalThis.clearInterval = (handle) => { timers.cleared.push(handle); };
  const events = [];
  const off = onAlarm((e) => events.push(e));
  try {
    startAlarms(() => state);
    events.length = 0; // startAlarms checks once with the REAL clock; ignore anything that produced
    await body({ events, timers, state });
  } finally {
    off();
    stopAlarms(); // also clears any pending snoozes
    globalThis.setInterval = realSet;
    globalThis.clearInterval = realClear;
  }
}

// Runs `body` with Date.now() frozen at `when`. snooze() reads Date.now() for its due time.
function withNow(when, body) {
  const real = Date.now;
  Date.now = () => when.getTime();
  try {
    return body();
  } finally {
    Date.now = real;
  }
}

// One class at 09:00. The engine wakes up once at `time` (lead minutes optional).
// Returns the alarms it fired.
async function wake(time, settings = {}, classOverrides = {}) {
  const d = nextMonday();
  const s = sub(classOverrides);
  let result = [];
  await withEngine(stateOf(s, settings), ({ events }) => {
    checkAlarms(at(d, time));
    result = [...events];
  });
  return result;
}

// ---------- early and start alarms ----------

t("the early alarm fires at start minus the lead time, not a second before", async () => {
  const d = nextMonday();
  const s = sub();
  await withEngine(stateOf(s), ({ events }) => {
    checkAlarms(at(d, "08:54:59"));
    assert.equal(events.length, 0);
    checkAlarms(at(d, "08:55:00"));
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "early");
    assert.equal(events[0].subject.id, s.id);
    assert.equal(events[0].startsAt.getTime(), at(d, "09:00").getTime());
  });
});

t("the start alarm fires at class time, not a second before", async () => {
  const d = nextMonday();
  const s = sub();
  await withEngine(stateOf(s), ({ events }) => {
    sweep(d, "08:55:00", "08:59:59");
    assert.deepEqual(kinds(events), ["early"]);
    checkAlarms(at(d, "09:00:00"));
    assert.deepEqual(kinds(events), ["early", "start"]);
    assert.equal(events[1].subject.id, s.id);
    assert.equal(events[1].startsAt.getTime(), at(d, "09:00").getTime());
  });
});

t("checking every 5 seconds all morning rings each alarm exactly once", async () => {
  const d = nextMonday();
  await withEngine(stateOf(sub()), ({ events }) => {
    sweep(d, "07:00:00", "11:00:00");
    assert.deepEqual(kinds(events), ["early", "start"]);
  });
});

t("repeated checks at the same instant do not repeat an alarm", async () => {
  const d = nextMonday();
  await withEngine(stateOf(sub()), ({ events }) => {
    for (let i = 0; i < 5; i++) checkAlarms(at(d, "08:55:00"));
    for (let i = 0; i < 5; i++) checkAlarms(at(d, "09:00:00"));
    assert.deepEqual(kinds(events), ["early", "start"]);
  });
});

t("two classes ring independently, each once", async () => {
  const d = nextMonday();
  const a = sub({ name: "A", start: "09:00" });
  const b = sub({ name: "B", start: "09:30" });
  await withEngine(stateOf([a, b]), ({ events }) => {
    sweep(d, "08:00:00", "10:30:00");
    assert.deepEqual(events.map((e) => `${e.subject.name}:${e.kind}`), ["A:early", "A:start", "B:early", "B:start"]);
  });
});

t("alarmLeadMinutes sets when the early alarm rings", async () => {
  const d = nextMonday();
  await withEngine(stateOf(sub(), { alarmLeadMinutes: 10 }), ({ events }) => {
    checkAlarms(at(d, "08:49:59"));
    assert.equal(events.length, 0);
    checkAlarms(at(d, "08:50:00"));
    assert.deepEqual(kinds(events), ["early"]);
  });
});

t("a lead time of 0 gives only the start alarm", async () => {
  const d = nextMonday();
  await withEngine(stateOf(sub(), { alarmLeadMinutes: 0 }), ({ events }) => {
    sweep(d, "08:00:00", "10:00:00");
    assert.deepEqual(kinds(events), ["start"]);
  });
});

t("the same class rings again on its next day", async () => {
  const first = nextMonday();
  const second = nextMonday();
  await withEngine(stateOf(sub()), ({ events }) => {
    sweep(first, "08:50:00", "09:05:00");
    sweep(second, "08:50:00", "09:05:00");
    assert.deepEqual(kinds(events), ["early", "start", "early", "start"]);
    assert.equal(events[2].startsAt.getTime(), at(second, "09:00").getTime());
  });
});

t("a class with no valid start time never rings", async () => {
  const d = nextMonday();
  await withEngine(stateOf([sub({ start: "" }), sub({ start: "9am" })]), ({ events }) => {
    sweep(d, "00:00:00", "23:59:55", 55);
    assert.equal(events.length, 0);
  });
});

// ---------- catch-up after the page was asleep ----------

t("waking up at, or up to 10 minutes after, class start still rings the start alarm", async () => {
  for (const time of ["09:00:00", "09:00:01", "09:05:00", "09:09:59", "09:10:00"]) {
    assert.deepEqual(kinds(await wake(time)), ["start"], time);
  }
});

t("waking up more than 10 minutes after class start rings nothing", async () => {
  for (const time of ["09:10:01", "09:30:00", "12:00:00"]) {
    assert.deepEqual(await wake(time), [], time);
  }
});

t("an early alarm is caught up when up to 10 minutes late, and not later", async () => {
  // Lead 30: early alarm is due at 08:30. Waking at 08:40:00 is exactly 10 minutes late.
  assert.deepEqual(kinds(await wake("08:30:00", { alarmLeadMinutes: 30 })), ["early"]);
  assert.deepEqual(kinds(await wake("08:40:00", { alarmLeadMinutes: 30 })), ["early"]);
  assert.deepEqual(await wake("08:40:01", { alarmLeadMinutes: 30 }), []);
});

t("waking up after class started rings only the start alarm, never the missed early one", async () => {
  const d = nextMonday();
  await withEngine(stateOf(sub()), ({ events }) => {
    checkAlarms(at(d, "09:03:00"));
    assert.deepEqual(kinds(events), ["start"]);
    sweep(d, "09:03:05", "09:20:00"); // nothing more, in particular no late "early"
    assert.deepEqual(kinds(events), ["start"]);
  });
});

t("after a long sleep only alarms inside the 10-minute window ring", async () => {
  const d = nextMonday();
  const old = sub({ name: "Old", start: "08:00" });
  const recent = sub({ name: "Recent", start: "09:00" });
  await withEngine(stateOf([old, recent]), ({ events }) => {
    checkAlarms(at(d, "09:02:00")); // Old started 62 minutes ago, Recent 2 minutes ago
    assert.deepEqual(events.map((e) => `${e.subject.name}:${e.kind}`), ["Recent:start"]);
  });
});

// ---------- Sunday and unscheduled days ----------

t("no alarms on Sunday, even for a class whose data wrongly includes Sunday", async () => {
  const monday = nextMonday();
  const sunday = addDays(monday, -1);
  assert.equal(dayName(sunday), "Sun");
  const normal = sub();
  const bad = sub({ days: ["Mon", "Sun"], start: "10:00" });
  await withEngine(stateOf([normal, bad]), ({ events }) => {
    sweep(sunday, "08:00:00", "11:00:00");
    assert.equal(events.length, 0);
    // Control: the same classes do ring on the Monday right after.
    sweep(monday, "08:50:00", "09:05:00");
    assert.ok(events.length > 0);
    assert.ok(events.every((e) => e.subject.id === normal.id));
  });
});

t("a class not scheduled today does not ring, but rings on its own day", async () => {
  const monday = nextMonday();
  const tuesday = addDays(monday, 1);
  const s = sub({ days: ["Tue"] });
  await withEngine(stateOf(s), ({ events }) => {
    sweep(monday, "08:00:00", "10:00:00");
    assert.equal(events.length, 0);
    sweep(tuesday, "08:50:00", "09:05:00");
    assert.deepEqual(kinds(events), ["early", "start"]);
  });
});

t("only the classes scheduled today ring when several share a time", async () => {
  const d = nextMonday();
  const today = sub({ name: "Today", days: ["Mon"] });
  const other = sub({ name: "Other", days: ["Wed", "Fri"] });
  await withEngine(stateOf([today, other]), ({ events }) => {
    sweep(d, "08:50:00", "09:05:00");
    assert.deepEqual(events.map((e) => `${e.subject.name}:${e.kind}`), ["Today:early", "Today:start"]);
  });
});

// ---------- snooze ----------

t("snooze rings the same alarm again after the set minutes, once", async () => {
  const d = nextMonday();
  const s = sub();
  await withEngine(stateOf(s), ({ events }) => {
    checkAlarms(at(d, "09:00:00"));
    assert.deepEqual(kinds(events), ["start"]);
    withNow(at(d, "09:00:10"), () => snooze(s.id, 5)); // due 09:05:10
    checkAlarms(at(d, "09:05:09"));
    assert.equal(events.length, 1, "not before the snooze runs out");
    checkAlarms(at(d, "09:05:10"));
    assert.equal(events.length, 2);
    assert.equal(events[1].kind, "start");
    assert.equal(events[1].subject.id, s.id);
    assert.equal(events[1].startsAt.getTime(), events[0].startsAt.getTime());
    sweep(d, "09:05:15", "09:30:00");
    assert.equal(events.length, 2, "a snooze rings once");
  });
});

t("a snoozed early alarm rings as an early alarm again while class has not started", async () => {
  const d = nextMonday();
  const s = sub();
  await withEngine(stateOf(s), ({ events }) => {
    checkAlarms(at(d, "08:55:00"));
    withNow(at(d, "08:55:05"), () => snooze(s.id, 2)); // due 08:57:05
    checkAlarms(at(d, "08:57:04"));
    assert.equal(events.length, 1);
    checkAlarms(at(d, "08:57:05"));
    assert.deepEqual(kinds(events), ["early", "early"]);
    sweep(d, "08:57:10", "09:05:00"); // the normal start alarm still comes
    assert.deepEqual(kinds(events), ["early", "early", "start"]);
  });
});

t("a snoozed early alarm that runs out after class began is dropped, and the start alarm rings instead", async () => {
  const d = nextMonday();
  const s = sub();
  await withEngine(stateOf(s), ({ events }) => {
    checkAlarms(at(d, "08:55:00"));
    withNow(at(d, "08:55:00"), () => snooze(s.id, 10)); // would be due at 09:05:00
    checkAlarms(at(d, "09:05:00"));
    assert.deepEqual(kinds(events), ["early", "start"]); // no second "early"
    sweep(d, "09:05:05", "09:30:00");
    assert.deepEqual(kinds(events), ["early", "start"]);
  });
});

t("snooze with no minutes uses settings.snoozeMinutes; explicit and bad values behave", async () => {
  // snoozeMinutes 7, no minutes given -> rings at 7 minutes
  const d1 = nextMonday();
  const a = sub();
  await withEngine(stateOf(a, { snoozeMinutes: 7 }), ({ events }) => {
    checkAlarms(at(d1, "09:00:00"));
    withNow(at(d1, "09:00:00"), () => snooze(a.id));
    checkAlarms(at(d1, "09:06:59"));
    assert.equal(events.length, 1);
    checkAlarms(at(d1, "09:07:00"));
    assert.equal(events.length, 2);
  });
  // an explicit number beats the setting
  const d2 = nextMonday();
  const b = sub();
  await withEngine(stateOf(b, { snoozeMinutes: 7 }), ({ events }) => {
    checkAlarms(at(d2, "09:00:00"));
    withNow(at(d2, "09:00:00"), () => snooze(b.id, 3));
    checkAlarms(at(d2, "09:02:59"));
    assert.equal(events.length, 1);
    checkAlarms(at(d2, "09:03:00"));
    assert.equal(events.length, 2);
  });
  // a missing or unusable setting falls back to 5 minutes
  const d3 = nextMonday();
  const c = sub();
  await withEngine(stateOf(c, { snoozeMinutes: null }), ({ events }) => {
    checkAlarms(at(d3, "09:00:00"));
    withNow(at(d3, "09:00:00"), () => snooze(c.id, 0));
    checkAlarms(at(d3, "09:04:59"));
    assert.equal(events.length, 1);
    checkAlarms(at(d3, "09:05:00"));
    assert.equal(events.length, 2);
  });
});

t("snoozing one class does not make another class ring again", async () => {
  const d = nextMonday();
  const a = sub({ name: "A" });
  const b = sub({ name: "B" });
  await withEngine(stateOf([a, b]), ({ events }) => {
    checkAlarms(at(d, "09:00:00"));
    assert.equal(events.length, 2);
    withNow(at(d, "09:00:00"), () => snooze(a.id, 5));
    checkAlarms(at(d, "09:05:00"));
    assert.deepEqual(events.slice(2).map((e) => e.subject.name), ["A"]);
  });
});

t("a snoozed alarm for a deleted subject is dropped, and stays dropped", async () => {
  const d = nextMonday();
  const s = sub();
  await withEngine(stateOf(s), ({ events, state }) => {
    checkAlarms(at(d, "09:00:00"));
    assert.equal(events.length, 1);
    withNow(at(d, "09:00:00"), () => snooze(s.id, 5)); // due 09:05:00
    state.subjects = []; // the student deletes the class while snoozed
    checkAlarms(at(d, "09:05:00")); // must not throw and must not ring
    assert.equal(events.length, 1);
    state.subjects = [s]; // class comes back: the old snooze must not come back with it
    sweep(d, "09:05:05", "09:30:00");
    assert.equal(events.length, 1);
  });
});

t("snoozing an id the engine never rang for does not throw or ring", async () => {
  const d = nextMonday();
  await withEngine(stateOf(sub({ days: ["Tue"] })), ({ events }) => {
    withNow(at(d, "09:00:00"), () => snooze("alarm-test-no-such-class", 1));
    sweep(d, "09:00:00", "09:10:00");
    assert.equal(events.length, 0);
  });
});

// ---------- stopping ----------

t("startAlarms starts one 5-second timer even if called twice; stopAlarms clears it", async () => {
  const state = stateOf(sub());
  await withEngine(state, ({ timers }) => {
    assert.equal(alarmsRunning(), true);
    assert.equal(timers.started.length, 1);
    assert.equal(timers.started[0].ms, 5000);
    startAlarms(() => state); // second call must not add another timer
    assert.equal(timers.started.length, 1);
    assert.equal(timers.cleared.length, 0);

    stopAlarms();
    assert.equal(alarmsRunning(), false);
    assert.deepEqual(timers.cleared, [timers.started[0]]);
    stopAlarms(); // stopping twice is harmless
    assert.equal(timers.cleared.length, 1);

    startAlarms(() => state); // a restart makes a fresh timer
    assert.equal(alarmsRunning(), true);
    assert.equal(timers.started.length, 2);
  });
  assert.equal(alarmsRunning(), false, "withEngine cleans up after itself");
});

t("stopAlarms drops pending snoozes, so they do not ring after a restart", async () => {
  const d = nextMonday();
  const s = sub();
  const state = stateOf(s);
  await withEngine(state, ({ events }) => {
    checkAlarms(at(d, "09:00:00"));
    assert.equal(events.length, 1);
    // Snooze 15 minutes: due at 09:15, which is past the 10-minute catch-up window for the
    // normal start alarm. So at 09:15 only a surviving snooze could ring.
    // (startAlarms always checks once with the real clock, which also forgets the "already rang"
    // marks for pretend dates. That is why the snooze is longer than the catch-up window.)
    withNow(at(d, "09:00:00"), () => snooze(s.id, 15));
    stopAlarms();
    startAlarms(() => state);
    events.length = 0;
    checkAlarms(at(d, "09:15:00"));
    sweep(d, "09:15:05", "09:30:00");
    assert.equal(events.length, 0);
  });
});

// ---------- listeners ----------

t("onAlarm returns a function that removes the listener", async () => {
  const d = nextMonday();
  await withEngine(stateOf(sub()), ({ events }) => {
    const extra = [];
    const off = onAlarm((e) => extra.push(e));
    try {
      checkAlarms(at(d, "08:55:00"));
      assert.equal(extra.length, 1);
      off();
      checkAlarms(at(d, "09:00:00"));
      assert.equal(extra.length, 1, "removed listener hears nothing more");
      assert.equal(events.length, 2, "the other listener still does");
    } finally {
      off();
    }
  });
});

t("a listener that throws does not stop the other listeners", async () => {
  const d = nextMonday();
  await withEngine(stateOf(sub()), ({ events }) => {
    const off = onAlarm(() => { throw new Error("broken listener"); });
    try {
      assert.doesNotThrow(() => checkAlarms(at(d, "08:55:00")));
      assert.deepEqual(kinds(events), ["early"]);
    } finally {
      off();
    }
  });
});

t("onAlarm ignores a callback that is not a function", () => {
  const off = onAlarm("not a function");
  assert.equal(typeof off, "function");
  off();
});
