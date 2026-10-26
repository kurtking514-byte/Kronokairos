// Settings screen (Phase 1) + the "Add to my calendar" section (Phase 5B, below).

import { buildICS, downloadICS } from "../calendar.js";
import { saveState, resetAll } from "../storage.js";
import { renderShareSection } from "./shareImport.js"; // Phase 6B

const ALARM_CHOICES = [
  { value: 0, label: "At class time" },
  { value: 5, label: "5 min early" },
  { value: 10, label: "10 min early" },
];
const SNOOZE_CHOICES = [3, 5, 10, 15].map((n) => ({ value: n, label: `${n} min` }));
const TERM_CHOICES = [
  { value: "trimester", label: "Trimester (13 weeks)" },
  { value: "semester", label: "Semester (18 weeks)" },
  { value: "custom", label: "Custom date" },
];

export function render(container, state) {
  ensureStyles();
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
    termCard(state, change),
    resetCard(),
  );

  renderCalendarSection(container, state); // Phase 5B
  renderShareSection(container, state); // Phase 6B
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
    const btn = el("button", "cal-choice", (on ? "\u2713 " : "") + choice.label);
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

function ensureStyles() {
  if (document.getElementById("cal-section-styles")) return;
  const style = document.createElement("style");
  style.id = "cal-section-styles";
  style.textContent = `
    .cal-section { margin-top: calc(var(--space, 16px) * 1.5); padding: var(--space, 16px);
      background: var(--surface, transparent); border-radius: var(--radius, 12px); }
    .cal-section h3, .cal-section h4 { margin: 0 0 8px; }
    .cal-section p { margin: 0 0 8px; }
    .cal-muted { color: var(--muted, #555); }
    .cal-choices { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
    .cal-choice, .cal-primary { min-height: 44px; padding: 0 16px; font: inherit; cursor: pointer;
      color: var(--text, inherit); background: transparent;
      border: 2px solid var(--primary, #2563eb); border-radius: var(--radius, 12px); }
    .cal-choice[aria-pressed="true"] { background: var(--primary, #2563eb); color: var(--bg, #fff); font-weight: 600; }
    .cal-primary { width: 100%; margin-top: 8px; background: var(--primary, #2563eb); color: var(--bg, #fff); font-weight: 600; }
    .cal-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .cal-section button:focus-visible { outline: 3px solid var(--text, #000); outline-offset: 2px; }
    .cal-devices { margin: 8px 0 0; }
    .cal-devices dt { font-weight: 600; margin-top: 12px; }
    .cal-devices dd { margin: 4px 0 0; overflow-wrap: anywhere; }
    .set-row { display: flex; align-items: center; gap: 12px; min-height: 44px; }
    .set-col { flex-direction: column; align-items: flex-start; gap: 4px; margin-top: 8px; }
    .set-row input[type="checkbox"] { width: 24px; height: 24px; flex: none; }
    .set-date { min-height: 44px; font: inherit; padding: 0 8px; }
    .set-danger { min-height: 44px; padding: 0 16px; font: inherit; cursor: pointer; background: transparent;
      color: var(--danger, #dc2626); border: 2px solid var(--danger, #dc2626); border-radius: var(--radius, 12px); }
    .set-danger-solid { background: var(--danger, #dc2626); color: var(--bg, #fff); font-weight: 600; }
    .cal-tips { margin: 8px 0 0; padding-left: 20px; }
    .cal-tips li { margin-bottom: 6px; }
  `;
  document.head.append(style);
}

function earlyWarningControls(state) {
  const group = el("div", "cal-choices");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Early warning");
  const selected = currentLead(state.settings);
  for (const choice of LEAD_CHOICES) {
    const on = selected === choice.minutes;
    const btn = el("button", "cal-choice", (on ? "✓ " : "") + choice.label);
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
    ["Android", "Opens in Google Calendar or Samsung Calendar. Google Calendar may ignore alarms in imported files. " +
      "One-time fix: open Google Calendar, go to Settings, and set a default notification at the start of the event."],
    ["Windows", "Opens in Outlook or Windows Calendar. Confirm to add the events."],
  ];
  const list = el("dl", "cal-devices");
  for (const [device, text] of notes) list.append(el("dt", "", device), el("dd", "", text));
  return list;
}

function renderCalendarSection(container, state) {
  ensureStyles();
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
    notes.hidden = false;
    notes.scrollIntoView?.({ block: "nearest" });
  });
  section.append(button, status, notes);

  const tips = el("ul", "cal-tips");
  tips.append(
    el("li", "", "Calendar notifications can be quiet. Set a loud alarm in your phone's clock app too."),
    el("li", "", "If your schedule changes, tap Add to my calendar again and delete the old events."),
  );
  section.append(el("h4", "", "Tips"), tips);

  container.append(section);
}
