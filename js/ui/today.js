// Today: classes in time order, with a live countdown on the current or next one.

import { classesOn, dayName, endTime, to12h, joinUrl, nextClass } from "../model.js";
import { render as renderAlarmControls } from "./alarmPopup.js"; // Phase 4
import { el, ensureStyles, copyText, openAddScreen, openScreen, DAY_LONG, MONTHS } from "./shared.js";
import { openEditor } from "./subjectForm.js";
import { backupDue, storageKept, downloadBackup } from "../backup.js";
import { calendarStatus, savedCalendar } from "../calendar.js";
import { showCalendarNext } from "./settings.js";

const CAL_NUDGE_KEY = "kronokairos.calendarNudge"; // when "Not now" was tapped on the calendar card (ms)
const CAL_NUDGE_DAYS = 14;

function calendarNudgeHidden() {
  try {
    const at = Number(localStorage.getItem(CAL_NUDGE_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < CAL_NUDGE_DAYS * 86400000;
  } catch {
    return false;
  }
}

// The page alarms only ring while the app is open; the phone calendar rings when it's closed.
// Ask once the student has classes, and speak up when the calendar no longer matches.
function calendarCard(state) {
  const { kind, removed } = calendarStatus(state, savedCalendar());
  const stale = kind === "stale" || (kind === "current" && removed.length > 0);
  if (!stale && !(kind === "never" && !calendarNudgeHidden())) return null;
  const card = el("div", "p1-card cal-nudge" + (stale ? " is-stale" : ""));
  card.append(el("p", "", stale
    ? "Your phone calendar is out of date. Your classes changed after you added them, so it may remind you at the wrong times."
    : "Get reminders even when this app is closed: add your classes to your phone calendar. It takes one tap."));
  const row = el("div", "p1-row");
  const open = el("button", "p1-btn primary", stale ? "Update my calendar" : "Add to my calendar");
  open.type = "button";
  open.addEventListener("click", () => {
    showCalendarNext();
    openScreen("settings", open);
  });
  row.append(open);
  if (!stale) {
    const later = el("button", "p1-btn", "Not now");
    later.type = "button";
    later.addEventListener("click", () => {
      try {
        localStorage.setItem(CAL_NUDGE_KEY, String(Date.now()));
      } catch {
        // Storage blocked: the card shows again next visit.
      }
      card.remove();
    });
    row.append(later);
  }
  card.append(row);
  return card;
}

let timer = null;

function at(now, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
}

function statusOf(subject, now) {
  const start = at(now, subject.start);
  const end = new Date(start.getTime() + subject.minutes * 60000);
  const kind = now >= end ? "ended" : now >= start ? "now" : "later";
  return { kind, start, end };
}

function clock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}h ${pad(m)}m ${pad(s)}s` : `${m}m ${pad(s)}s`;
}

export function render(container, state) {
  ensureStyles();
  clearInterval(timer);

  const root = el("div", "p1");
  container.append(root);
  const first = new Date();
  root.append(el("h2", "", "Today"),
    el("p", "p1-muted", `${DAY_LONG[dayName(first)]}, ${MONTHS[first.getMonth()]} ${first.getDate()}`));

  const alarmBox = el("div", ""); // Phase 4
  root.append(alarmBox); // Phase 4
  renderAlarmControls(alarmBox, state); // Phase 4

  const calCard = calendarCard(state);
  if (calCard) root.append(calCard);

  // A month without a backup, and the browser may clear the data: say so (js/backup.js).
  const backupBox = el("div", "");
  root.append(backupBox);
  storageKept().then((kept) => {
    if (!backupDue(state, kept) || !backupBox.isConnected) return;
    const card = el("div", "p1-card backup-nudge");
    card.append(el("p", "", "Your schedule is saved only in this browser, which can clear it. Save a backup file to be safe."));
    const save = el("button", "p1-btn", "Save a backup");
    save.type = "button";
    save.addEventListener("click", () => {
      downloadBackup(state);
      card.remove();
    });
    card.append(save);
    backupBox.append(card);
  });

  const list = el("div", "");
  root.append(list);

  let signature = "";
  let countdown = null;
  let shown = null; // { kind, start, end } of the highlighted class

  function emptyState(day) {
    const box = el("div", "p1-card");
    if (state.subjects.length === 0) {
      box.append(el("p", "", "You haven't added any classes yet."));
      const add = el("button", "p1-btn primary", "Add your first class");
      add.type = "button";
      add.addEventListener("click", openAddScreen);
      box.append(add);
    } else if (day === "Sun") {
      box.append(el("p", "", "No classes on Sunday. Enjoy your rest."));
    } else {
      box.append(el("p", "", "No classes today. Enjoy the break."));
    }
    const next = nextUp();
    if (next) box.append(next);
    return box;
  }

  // "Next: Math, tomorrow at 7:30 AM", for when nothing is left today.
  function nextUp() {
    const now = new Date();
    const found = nextClass(state, now);
    if (!found) return null;
    const { subject, startsAt } = found;
    const days = Math.round((new Date(startsAt).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400000);
    const when = days === 0 ? "later today" : days === 1 ? "tomorrow"
      : `${DAY_LONG[dayName(startsAt)]}, ${MONTHS[startsAt.getMonth()]} ${startsAt.getDate()}`;
    const p = el("p", "p1-next");
    p.append("Next: ", el("strong", "", subject.name), ` · ${when} at ${to12h(subject.start)}`);
    return p;
  }

  function classCard(subject, status, index, highlight) {
    const card = el("div", "p1-card" + (index === highlight ? " is-now" : "") + (status.kind === "ended" ? " is-ended" : ""));
    const tag = status.kind === "ended" ? "Ended"
      : status.kind === "now" ? "Happening now"
        : index === highlight ? "Up next" : "Later";
    card.append(el("span", "p1-tag", tag));
    const title = el("h3", "p1-title");
    const dot = el("span", "p1-dot");
    dot.style.background = subject.color;
    title.append(dot, subject.name);
    card.append(title, el("p", "p1-muted",
      `${to12h(subject.start)} to ${to12h(endTime(subject))} · ${subject.minutes} min`));

    if (index !== highlight) return card;

    countdown = el("p", "p1-countdown");
    countdown.setAttribute("aria-live", "off");
    card.append(countdown);
    const url = joinUrl(subject);
    if (url) {
      const join = el("a", "p1-btn primary big", "Join");
      join.href = url;
      join.target = "_blank";
      join.rel = "noopener noreferrer";
      join.setAttribute("aria-label", `Join ${subject.name}`);
      card.append(join);
    } else {
      card.append(el("p", "", "No link yet."));
      const fix = el("button", "p1-btn", "Add the link");
      fix.type = "button";
      fix.addEventListener("click", () => openEditor(subject.id));
      card.append(fix);
    }
    if (subject.passcode) {
      const row = el("div", "p1-row");
      const copy = el("button", "p1-btn", "Copy passcode");
      copy.type = "button";
      const note = el("span", "p1-muted");
      note.setAttribute("role", "status");
      copy.addEventListener("click", async () => {
        note.textContent = (await copyText(subject.passcode)) ? "Passcode copied." : "Could not copy. Select it from Links.";
      });
      row.append(copy, note);
      card.append(row);
    }
    return card;
  }

  function tick() {
    if (!root.isConnected) return clearInterval(timer); // the screen was replaced
    const now = new Date();
    const day = dayName(now);
    const classes = classesOn(state, day);
    const statuses = classes.map((c) => statusOf(c, now));
    const nowIdx = statuses.findIndex((s) => s.kind === "now");
    const highlight = nowIdx >= 0 ? nowIdx : statuses.findIndex((s) => s.kind === "later");

    // Rebuild only when something changed, so buttons keep keyboard focus between ticks.
    const next = `${now.toDateString()}|${statuses.map((s) => s.kind).join(",")}|${highlight}`;
    if (next !== signature) {
      signature = next;
      countdown = null;
      shown = highlight >= 0 ? statuses[highlight] : null;
      const cards = classes.length
        ? classes.map((c, i) => classCard(c, statuses[i], i, highlight))
        : [emptyState(day)];
      if (classes.length && highlight < 0) {
        const done = el("div", "p1-card");
        done.append(el("p", "", "That's all your classes for today. Good job!"));
        const next = nextUp();
        if (next) done.append(next);
        cards.push(done);
      }
      list.replaceChildren(...cards);
    }
    if (countdown && shown) {
      countdown.textContent = shown.kind === "now"
        ? `In progress. Ends in ${clock(shown.end - now)}`
        : `Starts in ${clock(shown.start - now)}`;
    }
  }

  tick();
  timer = setInterval(tick, 1000);
}
