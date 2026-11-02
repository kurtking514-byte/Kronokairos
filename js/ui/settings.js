// Settings screen (Phase 1) + the "Add to my calendar" section (Phase 5B, below).

import { buildICS, downloadICS, calendarStatus, savedCalendar } from "../calendar.js";
import { saveState, resetAll } from "../storage.js";
import { renderShareSection } from "./shareImport.js"; // Phase 6B
import { getMotion, setMotion, getPageChange, setPageChange } from "../motion.js";
import { downloadBackup, readBackup, lastBackupAt } from "../backup.js";

const ALARM_CHOICES = [
  { value: 0, label: "At class time" },
  { value: 5, label: "5 min early" },
  { value: 10, label: "10 min early" },
];
const SNOOZE_CHOICES = [3, 5, 10, 15].map((n) => ({ value: n, label: `${n} min` }));
const MOTION_CHOICES = [
  { value: "device", label: "Follow device" },
  { value: "full", label: "Always on" },
];
const PAGE_CHOICES = [
  { value: "circles", label: "Blob reveal" },
  { value: "slide", label: "Simple slide" },
];
const TERM_CHOICES = [
  { value: "trimester", label: "Trimester (13 weeks)" },
  { value: "semester", label: "Semester (18 weeks)" },
  { value: "custom", label: "Custom date" },
];

export function render(container, state) {
  const h = el("h2", "", "Settings");
  const note = el("p", "cal-muted", "Your schedule is saved only on this device. We don't store your links or passcodes.");
  container.append(h, note);

  const change = (patch) => saveState({ ...state, settings: { ...state.settings, ...patch } });

  container.append(
    card("Alarm", "Page alarm", ALARM_CHOICES, state.settings.alarmLeadMinutes,
      (v) => change({ alarmLeadMinutes: v }),
      "Rings only while this page is open. The calendar alarm below works when it is closed."),
    card("Snooze", "Snooze length", SNOOZE_CHOICES, state.settings.snoozeMinutes,
      (v) => change({ snoozeMinutes: v })),
    keepScreenCard(state, change),
    motionCard(),
    pageChangeCard(),
    termCard(state, change),
    backupCard(state),
    resetCard(),
  );

  renderCalendarSection(container, state); // Phase 5B
  renderShareSection(container, state); // Phase 6B
  placeThumbs(container);
  if (jumpToCalendar) {
    jumpToCalendar = false;
    requestAnimationFrame(() => container.querySelector("#cal-heading")?.closest("section")?.scrollIntoView({ block: "start" }));
  }
}

// Today's "add to your phone calendar" card opens Settings at the calendar part.
let jumpToCalendar = false;
export function showCalendarNext() {
  jumpToCalendar = true;
}

// The white highlight behind the picked choice slides to a new pick. It is a white layer holding
// dark copies of the words, cut to the highlight's shape, so whatever it covers reads dark on white
// and everything else light on dark, even halfway through the slide. A save redraws the whole
// screen, so remember where each group's highlight was and glide it from there.
const litAt = new Map(); // group label -> clip inset
// All the changes first, then all the measuring in one go, then the moves: measuring between
// changes made the browser redo the page layout once per row, which made page changes lag.
function placeThumbs(root) {
  const rows = [];
  for (const group of root.querySelectorAll(".cal-choices[aria-label]")) {
    const key = group.getAttribute("aria-label");
    const on = group.querySelector(':scope > .cal-choice[aria-pressed="true"]');
    group.querySelector(".cal-lit")?.remove();
    if (!on) continue;
    group.classList.add("has-lit"); // measure inside the group
    const lit = el("div", "cal-lit");
    lit.setAttribute("aria-hidden", "true");
    lit.inert = true;
    for (const btn of group.querySelectorAll(".cal-choice")) {
      const copy = btn.cloneNode(true);
      copy.removeAttribute("id");
      copy.tabIndex = -1;
      lit.append(copy);
    }
    const from = litAt.get(key);
    lit.style.clipPath = from ?? "inset(50%)";
    group.append(lit);
    rows.push({ key, group, on, lit, from });
  }
  for (const row of rows) {
    const { group, on } = row;
    const t = on.offsetTop, l = on.offsetLeft;
    row.to = `inset(${t}px ${group.clientWidth - l - on.offsetWidth}px ${group.clientHeight - t - on.offsetHeight}px ${l}px round 999px)`;
  }
  for (const { key, lit, from, to } of rows) {
    litAt.set(key, to);
    if (from && from !== to) lit.classList.add("is-moving"); // the measuring above already drew it at the old place
    lit.style.clipPath = to;
  }
}

// A titled box holding one row of tap choices.
function card(title, groupLabel, choices, selected, onPick, hint) {
  const section = el("section", "cal-section");
  section.append(el("h3", "", title), choiceGroup(groupLabel, choices, selected, onPick));
  if (hint) section.append(el("p", "cal-muted", hint));
  return section;
}

function choiceGroup(label, choices, selected, onPick) {
  const group = el("div", "cal-choices");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", label);
  for (const choice of choices) {
    const on = selected === choice.value;
    const btn = el("button", "cal-choice", choice.label);
    btn.type = "button";
    btn.setAttribute("aria-pressed", String(on));
    btn.addEventListener("click", () => onPick(choice.value));
    group.append(btn);
  }
  return group;
}

function keepScreenCard(state, change) {
  const section = el("section", "cal-section");
  const label = el("label", "set-row");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = !!state.settings.keepScreenOn;
  box.addEventListener("change", () => change({ keepScreenOn: box.checked }));
  label.append(box, el("span", "", "Keep screen on while alarms are running"));
  section.append(label, el("p", "cal-muted", "Uses more battery. Best while charging."));
  return section;
}

// Saved on this device only, outside the schedule, so it applies at once without a redraw.
function motionCard() {
  const section = card("Animations", "Animations", MOTION_CHOICES, getMotion(), (v) => {
    setMotion(v);
    for (const b of section.querySelectorAll(".cal-choice")) b.setAttribute("aria-pressed", String(b.dataset.value === v));
    placeThumbs(section);
  }, "Menu effects, the spinning clock and page changes. Follow device turns most of them off when your device asks for less motion.");
  section.querySelectorAll(".cal-choice").forEach((b, i) => (b.dataset.value = MOTION_CHOICES[i].value));
  return section;
}

// Also saved on this device only. "Simple slide" skips the circles for anyone they make dizzy.
function pageChangeCard() {
  const section = card("Page changes", "Page changes", PAGE_CHOICES, getPageChange(), (v) => {
    setPageChange(v);
    for (const b of section.querySelectorAll(".cal-choice")) b.setAttribute("aria-pressed", String(b.dataset.value === v));
    placeThumbs(section);
  }, "Blob reveal grows the next page out of what you tapped. Simple slide just slides the page in.");
  section.querySelectorAll(".cal-choice").forEach((b, i) => (b.dataset.value = PAGE_CHOICES[i].value));
  return section;
}

function termCard(state, change) {
  const { termType, termEndDate } = state.settings;
  const section = card("Term length", "Term length", TERM_CHOICES, termType,
    (v) => change({ termType: v }),
    "Calendar events stop repeating at the end of the term. If you skip this, Semester is used.");
  if (termType === "custom") {
    const label = el("label", "set-row set-col", "Last day of the term");
    const input = document.createElement("input");
    input.type = "date";
    input.className = "set-date";
    input.value = termEndDate ?? "";
    input.addEventListener("change", () => change({ termEndDate: input.value || null }));
    label.append(input);
    section.append(label);
    if (!termEndDate) section.append(el("p", "cal-muted", "Pick a date. Until you do, Semester is used."));
  }
  return section;
}

// The schedule lives only in this browser, which can clear it. A backup file can bring it back,
// here or on a new phone. Restoring asks first, because it replaces what is here now.
function backupCard(state) {
  const section = el("section", "cal-section");
  section.append(el("h3", "", "Backup"));
  const last = lastBackupAt();
  const when = last ? new Date(last) : null;
  section.append(el("p", "cal-muted", when
    ? `Last backup saved ${MONTHS[when.getMonth()]} ${when.getDate()}, ${when.getFullYear()}.`
    : "No backup yet. Browsers can clear saved sites, so keep a copy of your schedule."));
  const area = el("div", "");
  const status = el("p", "cal-muted");
  status.setAttribute("role", "status");

  const save = el("button", "cal-choice", "Save a backup");
  save.type = "button";
  save.disabled = state.subjects.length === 0;
  save.addEventListener("click", () => {
    downloadBackup(state);
    status.textContent = "Saved. Keep the file somewhere safe, like your Files or Drive.";
  });

  const picker = el("input", "");
  picker.type = "file";
  picker.accept = ".json,application/json";
  picker.hidden = true;
  const restore = el("button", "cal-choice", "Restore a backup");
  restore.type = "button";
  restore.addEventListener("click", () => picker.click());
  picker.addEventListener("change", async () => {
    const next = await readBackup(picker.files?.[0]);
    picker.value = "";
    if (!next) {
      status.textContent = "That file isn't a Kronokairos backup.";
      return;
    }
    const count = (n) => `${n} ${n === 1 ? "class" : "classes"}`;
    const warn = el("p", "", `Replace the ${count(state.subjects.length)} here with the ${count(next.subjects.length)} in the backup?`);
    warn.setAttribute("role", "alert");
    const yes = el("button", "cal-choice", "Yes, restore");
    yes.type = "button";
    yes.addEventListener("click", () => saveState(next));
    const no = el("button", "cal-choice", "Cancel");
    no.type = "button";
    no.addEventListener("click", () => area.replaceChildren(row));
    const confirm = el("div", "cal-choices");
    confirm.append(yes, no);
    area.replaceChildren(warn, confirm);
    yes.focus?.();
  });

  const row = el("div", "cal-choices");
  row.append(save, restore, picker);
  area.append(row);
  section.append(area, status);
  return section;
}

// Two taps on purpose: the first only asks, the second deletes.
function resetCard() {
  const section = el("section", "cal-section");
  section.append(el("h3", "", "Reset"));
  const area = el("div", "");
  const ask = el("button", "set-danger", "Reset all data");
  ask.type = "button";
  ask.addEventListener("click", () => {
    const warn = el("p", "", "This deletes every class and setting from this device. It cannot be undone.");
    warn.setAttribute("role", "alert");
    const yes = el("button", "set-danger set-danger-solid", "Yes, delete everything");
    yes.type = "button";
    yes.addEventListener("click", () => resetAll());
    const no = el("button", "cal-choice", "Cancel");
    no.type = "button";
    no.addEventListener("click", () => area.replaceChildren(ask));
    const row = el("div", "cal-choices");
    row.append(yes, no);
    area.replaceChildren(warn, row);
    yes.focus?.();
  });
  area.append(ask);
  section.append(area);
  return section;
}

// ===================== Phase 5B: Add to my calendar =====================

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TERM_LABELS = { trimester: "Trimester, 13 weeks", semester: "Semester, 18 weeks", custom: "Custom date" };
const LEAD_CHOICES = [
  { minutes: 0, label: "At class time" },
  { minutes: 5, label: "5 min before" },
  { minutes: 10, label: "10 min before" },
];

// Does the phone calendar still match? (calendar.js remembers what the last download held.)
function calendarCheck(state) {
  const box = el("div", "cal-check");
  const { kind, removed } = calendarStatus(state, savedCalendar());
  if (kind === "current") {
    box.append(el("p", "cal-ok", "Your phone calendar matches your classes."));
  } else if (kind === "stale") {
    const warn = el("p", "cal-stale", "Your phone calendar is out of date. You changed your classes after you last added them. " +
      "Tap Add to my calendar again, then delete the old Kronokairos events.");
    warn.setAttribute("role", "alert");
    box.append(warn);
  }
  if (kind !== "empty" && kind !== "never" && removed.length) {
    box.append(el("p", "cal-stale", `You removed ${removed.join(", ")}. Delete ${removed.length === 1 ? "it" : "them"} ` +
      "from your phone calendar too, or the reminders keep coming."));
  }
  return box;
}

// Kept outside render() so the device notes stay open after the screen redraws.
let downloaded = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Which early-warning button is selected. null = a value set elsewhere that no button matches.
function currentLead(settings) {
  const list = settings.calendarLeadMinutes;
  if (!Array.isArray(list) || list.length === 0) return 0;
  if (list.length === 1 && (list[0] === 5 || list[0] === 10)) return list[0];
  return null;
}

// Reads the numbers from the real file, so the screen cannot disagree with it.
function previewCalendar(state) {
  const lines = buildICS(state, new Date()).replace(/\r\n[ \t]/g, "").split("\r\n");
  const events = lines.filter((l) => l === "BEGIN:VEVENT").length;
  let latest = null;
  for (const line of lines) {
    const m = /UNTIL=(\d{4})(\d{2})(\d{2})T/.exec(line);
    if (!m) continue;
    const key = m[1] + m[2] + m[3];
    if (!latest || key > latest.key) latest = { key, year: +m[1], month: +m[2], day: +m[3] };
  }
  const until = latest ? `${MONTHS[latest.month - 1]} ${latest.day}, ${latest.year}` : null;
  return { events, until };
}


function earlyWarningControls(state) {
  const group = el("div", "cal-choices");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Early warning");
  const selected = currentLead(state.settings);
  for (const choice of LEAD_CHOICES) {
    const on = selected === choice.minutes;
    const btn = el("button", "cal-choice", choice.label);
    btn.type = "button";
    btn.setAttribute("aria-pressed", String(on));
    btn.addEventListener("click", () => {
      const calendarLeadMinutes = choice.minutes === 0 ? [] : [choice.minutes];
      saveState({ ...state, settings: { ...state.settings, calendarLeadMinutes } });
    });
    group.append(btn);
  }
  return group;
}

function deviceNotes() {
  const notes = [
    ["iPhone / Mac", "Calendar opens. Tap Add All. The alarms come with the events."],
    ["Android", "Samsung Calendar opens the file. If your phone has only Google Calendar and nothing opens it, " +
      "import the file at calendar.google.com on a computer (Settings, Import). Google Calendar may ignore the alarms in the file. " +
      "One-time fix: open Google Calendar, go to Settings, and set a default notification at the start of the event."],
    ["Windows", "Opens in Outlook or Windows Calendar. Confirm to add the events."],
  ];
  const list = el("dl", "cal-devices");
  for (const [device, text] of notes) list.append(el("dt", "", device), el("dd", "", text));
  return list;
}

function renderCalendarSection(container, state) {
  const { events, until } = previewCalendar(state);
  const hasSubjects = state.subjects.length > 0;
  const canExport = events > 0;

  const section = el("section", "cal-section");
  section.setAttribute("aria-labelledby", "cal-heading");
  const heading = el("h3", "", "Add to my calendar");
  heading.id = "cal-heading";
  section.append(
    heading,
    el("p", "cal-muted", "Puts your classes in your phone or laptop calendar as weekly events with alarms. " +
      "The file is made on this device and is not sent anywhere."),
  );

  const summary = el("div", "");
  summary.id = "cal-summary";
  if (!hasSubjects) {
    summary.append(el("p", "", "You have no classes yet. Add a class first, then come back here."));
  } else if (!canExport) {
    summary.append(el("p", "", "None of your classes fit before the term end date. " +
      "Check your term length in Settings."));
  } else {
    summary.append(el("p", "", `${events} ${events === 1 ? "class" : "classes"} will be added.`));
    const term = TERM_LABELS[state.settings.termType] ?? TERM_LABELS.semester;
    summary.append(el("p", "", `Events repeat weekly until ${until}. (${term})`));
    if (events < state.subjects.length) {
      summary.append(el("p", "cal-muted", `${state.subjects.length - events} class(es) were left out because ` +
        "they are missing a day or a start time."));
    }
  }
  section.append(summary);
  let check = calendarCheck(state);
  section.append(check);

  if (hasSubjects) {
    section.append(el("p", "", "Early warning"), earlyWarningControls(state),
      el("p", "cal-muted", "A reminder at class time is always included."));
  }

  const button = el("button", "cal-primary", "Add to my calendar");
  button.type = "button";
  button.disabled = !canExport;
  button.setAttribute("aria-describedby", "cal-summary");
  const status = el("p", "", downloaded ? "kronokairos.ics was downloaded. Open it to add your classes." : "");
  status.setAttribute("role", "status");
  const notes = el("div", "");
  notes.hidden = !downloaded;
  notes.append(el("h4", "", "What happens next"), deviceNotes());

  button.addEventListener("click", () => {
    downloadICS(state);
    downloaded = true;
    status.textContent = "kronokairos.ics was downloaded. Open it to add your classes.";
    const fresh = calendarCheck(state);
    check.replaceWith(fresh);
    check = fresh;
    notes.hidden = false;
    notes.scrollIntoView?.({ block: "nearest" });
  });
  section.append(button, status, notes);

  const tips = el("ul", "cal-tips");
  tips.append(
    el("li", "", "Calendar notifications can be quiet. Set a loud alarm in your phone's clock app too."),
    el("li", "", "Adding is a one-time copy: your phone calendar doesn't update by itself. " +
      "If your classes change, this page tells you to add them again."),
  );
  section.append(el("h4", "", "Tips"), tips);

  container.append(section);
}
