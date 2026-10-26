// Today: classes in time order, with a live countdown on the current or next one.

import { classesOn, dayName, endTime, to12h, joinUrl } from "../model.js";
import { render as renderAlarmControls } from "./alarmPopup.js"; // Phase 4
import { el, ensureStyles, copyText, openAddScreen, DAY_LONG, MONTHS } from "./shared.js";
import { openEditor } from "./subjectForm.js";

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
    return box;
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
      if (classes.length && highlight < 0) cards.push(el("p", "p1-muted", "That's all your classes for today. Good job!"));
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
