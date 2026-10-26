// Phase 3B. "Fill in with AI": show the prompt, read the pasted reply, let the
// student check and fix one card per subject, and save only after "Looks good".
// Everything stays on this device. Nothing here makes a network request.

import { PROMPT, parseReply } from "../aiImport.js";
import { parseInvite } from "../invite.js";
import { DAYS, validateSubject, findOverlaps, to12h, joinUrl, newSubject } from "../model.js";
import { saveState } from "../storage.js";

const PALETTE = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
const COLOR_NAMES = ["Blue", "Red", "Green", "Amber", "Purple", "Pink", "Teal", "Orange"];

// Black or white, whichever is easier to read on this color (for the tick mark).
function readableOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.18 ? "#000" : "#fff";
}
const NAME_SUGGESTIONS = ["Math", "English", "History", "PathFit", "Science"];
const LENGTH_CHOICES = [60, 70, 80, 90, 120];
const FIELD_KEYS = ["name", "days", "start", "minutes", "link", "meetingId", "passcode"];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Screen state lives here so a re-render (for example after saving) keeps its place.
let stage = "paste"; // "paste" | "review" | "done"
let pasteText = "";
let failure = null; // { error, retryMessage } from the last failed import
let notice = "";
let drafts = []; // subjects being reviewed; never saved until "Looks good"
let asking = false; // showing the Replace / Add choice
let savedInfo = null; // { count, mode, saveFailed }
let host = null;
let liveState = null;
let cards = [];
let focusAlertNext = false;

// ---------- small helpers ----------

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k === "value") e.value = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null) e.append(kid);
  return e;
}

const isTime = (v) => typeof v === "string" && TIME_RE.test(v);
const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
const isMissing = (d, key) => d.missing.includes(key) && isEmpty(d[key]);

// A clean contract subject: no `missing`, trimmed text, days in week order.
function toSaved(d) {
  return {
    id: d.id,
    name: d.name.trim(),
    color: d.color,
    days: DAYS.filter((x) => d.days.includes(x)),
    start: d.start,
    minutes: d.minutes,
    link: d.link.trim(),
    meetingId: d.meetingId,
    passcode: d.passcode.trim(),
  };
}

function linkIdMismatch(d) {
  const m = /zoom\.us\/j\/(\d+)/i.exec(d.link || "");
  return m && d.meetingId && m[1] !== d.meetingId ? m[1] : null;
}

async function copyText(text, statusEl, textareaEl) {
  try {
    await navigator.clipboard.writeText(text);
    statusEl.textContent = "Copied.";
    return;
  } catch {
    /* fall through to the older way */
  }
  try {
    textareaEl.focus();
    textareaEl.select();
    statusEl.textContent = document.execCommand("copy")
      ? "Copied."
      : "Couldn't copy. Select the text and copy it yourself.";
  } catch {
    statusEl.textContent = "Couldn't copy. Select the text and copy it yourself.";
  }
}

function rerender() {
  if (host) render(host, liveState);
}

function goToTab(name) {
  document.querySelector(`.tab[data-screen="${name}"]`)?.click();
}

// ---------- entry point ----------

export function render(container, state) {
  host = container;
  liveState = state;
  let view;
  if (stage === "review" && drafts.length > 0) view = reviewView();
  else if (stage === "done") view = doneView();
  else view = pasteView();
  container.replaceChildren(view);
  if (focusAlertNext) {
    focusAlertNext = false;
    container.querySelector(".ai-alert")?.focus();
  }
}

// ---------- step 1: prompt and paste ----------

function pasteView() {
  const promptBox = h("textarea", {
    id: "ai-prompt", class: "ai-box ai-mono", readonly: true, rows: 10, value: PROMPT,
  });
  const promptStatus = h("span", { role: "status", class: "muted" });
  const copyPrompt = h("button", {
    type: "button", text: "Copy prompt", onclick: () => copyText(PROMPT, promptStatus, promptBox),
  });

  const pasteBox = h("textarea", {
    id: "ai-paste", class: "ai-box ai-mono", rows: 8, autocomplete: "off", spellcheck: "false",
    placeholder: "Paste the AI's reply here", value: pasteText,
    oninput: (e) => { pasteText = e.target.value; },
  });
  const importBtn = h("button", { type: "button", text: "Import", onclick: onImport });

  return h("section", { class: "ai-screen" },
    h("h2", { text: "Fill in with AI" }),
    h("ol", { class: "ai-steps" },
      h("li", { text: "Tap Copy prompt below." }),
      h("li", { text: "Open Gemini, ChatGPT or Claude." }),
      h("li", { text: "Attach screenshots of your schedule and your teachers' Zoom posts." }),
      h("li", { text: "Paste the prompt and send it." }),
      h("li", { text: "Copy the AI's reply and paste it into the big box below." }),
    ),
    h("p", { class: "ai-note", text: "Your screenshots go to the AI app you choose, not to this site. This site never sees them." }),
    h("label", { for: "ai-prompt", text: "Prompt to copy" }),
    promptBox,
    h("div", { class: "ai-actions" }, copyPrompt, promptStatus),
    h("label", { for: "ai-paste", class: "ai-spaced", text: "The AI's reply" }),
    pasteBox,
    h("div", { class: "ai-actions" }, importBtn),
    notice ? h("p", { role: "status", class: "ai-note", text: notice }) : null,
    failure ? failureBox() : null,
  );
}

function failureBox() {
  const retryBox = h("textarea", {
    id: "ai-retry", class: "ai-box", readonly: true, rows: 2, value: failure.retryMessage,
  });
  const status = h("span", { role: "status", class: "muted" });
  return h("div", { class: "ai-alert", role: "alert", tabindex: "-1" },
    h("p", { text: failure.error }),
    h("label", { for: "ai-retry", text: "Send this message back to the AI:" }),
    retryBox,
    h("div", { class: "ai-actions" },
      h("button", { type: "button", text: "Copy message", onclick: () => copyText(failure.retryMessage, status, retryBox) }),
      status),
  );
}

function onImport() {
  notice = "";
  let result;
  try {
    result = parseReply(pasteText);
  } catch {
    result = { ok: false, error: "I couldn't read that reply.", retryMessage: "Please reply again using exactly the ZOOMCLASS-V1 format, nothing else." };
  }
  if (!result.ok || !Array.isArray(result.subjects) || result.subjects.length === 0) {
    failure = { error: result.error || "I couldn't read that reply.", retryMessage: result.retryMessage || "" };
    focusAlertNext = true;
    rerender();
    return;
  }
  failure = null;
  drafts = result.subjects.map((s) => ({ ...s, missing: [...(s.missing ?? [])] }));
  asking = false;
  stage = "review";
  rerender();
  window.scrollTo?.(0, 0);
}

// ---------- step 2: review cards ----------

function reviewView() {
  cards = [];
  const summary = h("p", { id: "ai-summary", role: "status", class: "ai-note" });
  const names = h("datalist", { id: "ai-names" }, NAME_SUGGESTIONS.map((n) => h("option", { value: n })));
  const count = drafts.length;

  const list = h("div", { class: "ai-list" }, drafts.map(buildCard));
  const view = h("section", { class: "ai-screen" },
    h("h2", { text: "Check your classes" }),
    h("p", {
      text: `${count} ${count === 1 ? "subject" : "subjects"} found. Check every card, especially meeting IDs and passcodes. Nothing is saved until you tap Looks good.`,
    }),
    names,
    list,
    summary,
    asking ? choicePanel() : footer(summary),
  );
  refreshAll();
  return view;
}

function footer(summary) {
  return h("div", { class: "ai-actions" },
    h("button", { type: "button", text: "Looks good", onclick: () => onLooksGood(summary) }),
    h("button", { type: "button", class: "secondary", text: "Start over", onclick: startOver }),
  );
}

function startOver() {
  drafts = [];
  asking = false;
  stage = "paste";
  rerender();
}

function choicePanel() {
  const n = liveState.subjects.length;
  const word = n === 1 ? "subject" : "subjects";
  return h("div", { class: "card ai-choice", role: "group", "aria-label": "Save choice" },
    h("p", { text: `You already have ${n} ${word} saved. What should happen to them?` }),
    h("div", { class: "ai-actions" },
      h("button", { type: "button", text: `Replace my ${n} ${word}`, onclick: () => save("replace") }),
      h("button", { type: "button", text: "Add to my subjects", onclick: () => save("add") }),
      h("button", { type: "button", class: "secondary", text: "Cancel", onclick: () => { asking = false; rerender(); } }),
    ),
  );
}

function onLooksGood(summary) {
  refreshAll();
  const bad = cards.filter((c) => c.errorCount > 0);
  if (bad.length > 0) {
    const total = bad.reduce((sum, c) => sum + c.errorCount, 0);
    summary.textContent = `Fix ${total} ${total === 1 ? "problem" : "problems"} in ${bad.length} ${bad.length === 1 ? "card" : "cards"} before saving. Nothing has been saved.`;
    bad[0].root.scrollIntoView?.({ block: "start" });
    bad[0].root.focus();
    return;
  }
  if (liveState.subjects.length === 0) save("replace");
  else {
    asking = true;
    rerender();
  }
}

function save(mode) {
  const incoming = drafts.map(toSaved);
  // Safety net: refuse to save anything the model calls an error.
  if (incoming.some((s) => validateSubject(s).errors.length > 0)) {
    asking = false;
    rerender();
    return;
  }
  const keep = mode === "add" ? liveState.subjects : [];
  const taken = new Set(keep.map((s) => s.id));
  for (const s of incoming) {
    while (taken.has(s.id)) s.id = newSubject().id;
    taken.add(s.id);
  }
  const next = { ...liveState, subjects: [...keep, ...incoming] };

  savedInfo = { count: incoming.length, mode, saveFailed: false };
  stage = "done";
  drafts = [];
  asking = false;
  pasteText = "";
  // saveState tells the app, which re-renders this screen in the "done" state.
  const ok = saveState(next);
  if (!ok) {
    savedInfo.saveFailed = true;
    rerender();
  }
}

function doneView() {
  const { count, mode, saveFailed } = savedInfo;
  const word = count === 1 ? "subject" : "subjects";
  return h("section", { class: "ai-screen" },
    h("h2", { text: "Saved" }),
    h("p", { text: mode === "add" ? `${count} ${word} added to your schedule.` : `Your schedule now has ${count} ${word}.` }),
    saveFailed
      ? h("p", { class: "ai-alert", role: "alert", text: "This browser blocked saving, so your classes will be lost when you close the page." })
      : null,
    h("div", { class: "ai-actions" },
      h("button", { type: "button", text: "See my schedule", onclick: () => goToTab("schedule") }),
      h("button", { type: "button", class: "secondary", text: "Import another", onclick: () => { stage = "paste"; rerender(); } }),
    ),
  );
}

// ---------- one card ----------

function buildCard(d) {
  const c = { d, root: null, fields: {}, inputs: {}, errorCount: 0 };
  cards.push(c);

  c.title = h("h3", { text: d.name || "Unnamed subject" });
  c.status = h("p", { role: "status", class: "ai-note" });
  c.msgs = h("ul", { class: "ai-msgs", "aria-live": "polite" });
  c.time12 = h("span", { class: "ai-note" });

  const removeBtn = h("button", {
    type: "button", class: "secondary danger-text", text: "Remove",
    "aria-label": "Remove this subject",
    onclick: () => removeCard(d),
  });
  c.removeBtn = removeBtn;
  c.testBtn = h("button", { type: "button", class: "secondary", text: "Test join", onclick: () => testJoin(c) });

  c.root = h("article", { class: "card ai-card", tabindex: "-1" },
    h("div", { class: "ai-card-head" }, c.title, h("div", { class: "ai-actions" },
      c.testBtn,
      removeBtn)),
    c.status,
    textField(c, "name", "Subject name", { attrs: { autocapitalize: "words", list: "ai-names" } }),
    daysField(c),
    timeField(c),
    minutesField(c),
    colorField(c),
    inviteBlock(c),
    textField(c, "link", "Zoom link", { attrs: { inputmode: "url", autocapitalize: "off", spellcheck: "false" } }),
    textField(c, "meetingId", "Meeting ID (9 to 11 digits)", { attrs: { inputmode: "numeric", autocapitalize: "off" } }),
    textField(c, "passcode", "Passcode", { mono: true, attrs: { autocapitalize: "off", autocorrect: "off", spellcheck: "false" } }),
    h("p", { class: "ai-note", text: "Compare with the original post. Letters like l, I, 0, and O are easy to mix up." }),
    c.msgs,
  );
  return c.root;
}

function removeCard(d) {
  drafts = drafts.filter((x) => x !== d);
  if (drafts.length === 0) {
    notice = "All cards were removed. Nothing was saved.";
    stage = "paste";
  }
  rerender();
  // The button that had focus is gone, so keyboard users start again at the top of the screen.
  const top = host?.querySelector("h2");
  if (top) { top.tabIndex = -1; top.focus(); }
}

function testJoin(c) {
  const url = joinUrl(toSaved(c.d));
  if (!url) {
    c.status.textContent = "Add a link or meeting ID first.";
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    c.status.textContent = "The link must start with https://";
    return;
  }
  // A real anchor click keeps this a user-initiated tap, so browsers allow it.
  const a = h("a", { href: url, target: "_blank", rel: "noopener noreferrer" });
  a.click();
  c.status.textContent = "Opening the join link. Check that it is the right class.";
}

function makeField(c, key, label, control, { group = false, forId = null } = {}) {
  const badge = h("span", { class: "ai-badge", text: "Needs checking", hidden: true });
  const head = group ? h("legend", { text: label }) : h("label", { for: forId, text: label });
  const wrap = h(group ? "fieldset" : "div", { class: "ai-field" }, head, badge, control);
  c.fields[key] = { wrap, badge };
  return wrap;
}

function clearMissing(d, key) {
  if (!isEmpty(d[key])) d.missing = d.missing.filter((k) => k !== key);
}

function textField(c, key, label, { mono = false, attrs = {} } = {}) {
  const id = `ai-${c.d.id}-${key}`;
  const input = h("input", {
    id, type: "text", class: mono ? "ai-mono" : "", autocomplete: "off", ...attrs, value: c.d[key] ?? "",
  });
  input.addEventListener("input", () => {
    let v = input.value;
    if (key === "meetingId") {
      v = v.replace(/\D/g, "");
      if (v !== input.value) input.value = v;
    }
    c.d[key] = v;
    clearMissing(c.d, key);
    refreshAll();
  });
  c.inputs[key] = input;
  return makeField(c, key, label, input, { forId: id });
}

function daysField(c) {
  const row = h("div", { class: "ai-chips" });
  for (const day of DAYS) {
    const on = () => c.d.days.includes(day);
    const btn = h("button", { type: "button", class: "secondary ai-chip", "aria-pressed": String(on()), "aria-label": day });
    const paint = () => {
      btn.setAttribute("aria-pressed", String(on()));
      btn.textContent = on() ? `✓ ${day}` : day;
    };
    paint();
    btn.addEventListener("click", () => {
      c.d.days = on() ? c.d.days.filter((x) => x !== day) : [...c.d.days, day];
      clearMissing(c.d, "days");
      paint();
      refreshAll();
    });
    row.append(btn);
  }
  return makeField(c, "days", "Days", row, { group: true });
}

function timeField(c) {
  const id = `ai-${c.d.id}-start`;
  const input = h("input", { id, type: "time", step: "60", value: isTime(c.d.start) ? c.d.start : "" });
  input.addEventListener("input", () => {
    c.d.start = input.value; // always "HH:MM" 24-hour, or "" when cleared
    clearMissing(c.d, "start");
    refreshAll();
  });
  c.inputs.start = input;
  return makeField(c, "start", "Start time", h("div", { class: "ai-actions" }, input, c.time12), { forId: id });
}

function minutesField(c) {
  const id = `ai-${c.d.id}-minutes`;
  const input = h("input", {
    id, type: "number", inputmode: "numeric", min: "10", max: "300", step: "5",
    value: Number.isInteger(c.d.minutes) ? String(c.d.minutes) : "",
  });
  const set = (n) => {
    c.d.minutes = n;
    input.value = Number.isInteger(n) ? String(n) : "";
    clearMissing(c.d, "minutes");
    refreshAll();
  };
  const step = (delta) => {
    const base = Number.isInteger(c.d.minutes) ? c.d.minutes : 60 - delta;
    set(Math.min(300, Math.max(10, base + delta)));
  };
  input.addEventListener("input", () => {
    const n = input.value.trim() === "" ? NaN : Math.round(Number(input.value));
    c.d.minutes = Number.isFinite(n) ? n : "";
    clearMissing(c.d, "minutes");
    refreshAll();
  });
  c.inputs.minutes = input;

  const chips = LENGTH_CHOICES.map((n) =>
    h("button", { type: "button", class: "secondary ai-chip", text: String(n), "aria-label": `${n} minutes`, onclick: () => set(n) }));
  const control = h("div", { class: "ai-minutes-wrap" },
    h("div", { class: "ai-minutes" },
      h("button", { type: "button", class: "secondary", text: "−", "aria-label": "5 minutes shorter", onclick: () => step(-5) }),
      input,
      h("button", { type: "button", class: "secondary", text: "+", "aria-label": "5 minutes longer", onclick: () => step(5) }),
    ),
    h("div", { class: "ai-chips" }, chips),
  );
  return makeField(c, "minutes", "Length in minutes", control, { forId: id });
}

function colorField(c) {
  const row = h("div", { class: "ai-chips" });
  PALETTE.forEach((color, i) => {
    const btn = h("button", {
      type: "button", class: "ai-swatch", style: `background:${color}`,
      "aria-label": COLOR_NAMES[i],
    });
    const paint = () => {
      const on = c.d.color === color;
      btn.setAttribute("aria-pressed", String(on));
      btn.textContent = on ? "✓" : "";
      btn.style.color = readableOn(color);
      btn.style.textShadow = "none";
    };
    paint();
    btn.addEventListener("click", () => {
      c.d.color = color;
      for (const b of row.children) b.dispatchEvent(new CustomEvent("paint"));
    });
    btn.addEventListener("paint", paint);
    row.append(btn);
  });
  return h("fieldset", { class: "ai-field" }, h("legend", { text: "Color" }), row);
}

// Reuses the Paste invite parser to fill link, meeting ID and passcode.
function inviteBlock(c) {
  const box = h("textarea", {
    id: `ai-${c.d.id}-invite`, class: "ai-box", rows: 5, spellcheck: "false",
    placeholder: "Paste the teacher's Zoom post here",
  });
  const status = h("p", { role: "status", class: "ai-note" });
  const panel = h("div", { class: "ai-invite", hidden: true },
    h("label", { for: box.id, text: "Teacher's Zoom post" }),
    box,
    h("div", { class: "ai-actions" },
      h("button", { type: "button", text: "Fill from invite", onclick: () => fillFromInvite(c, box, status) })),
    status,
  );
  const toggle = h("button", {
    type: "button", class: "secondary", text: "Paste invite", "aria-expanded": "false",
    onclick: () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute("aria-expanded", String(!panel.hidden));
      if (!panel.hidden) box.focus();
    },
  });
  return h("div", { class: "ai-field" }, toggle, panel);
}

function fillFromInvite(c, box, status) {
  const found = parseInvite(box.value);
  const labels = { link: "link", meetingId: "meeting ID", passcode: "passcode" };
  const filled = [];
  for (const key of Object.keys(labels)) {
    if (found[key] == null) continue;
    c.d[key] = found[key];
    c.inputs[key].value = found[key];
    clearMissing(c.d, key);
    filled.push(labels[key]);
  }
  status.textContent = filled.length
    ? `Filled: ${filled.join(", ")}. Compare with the original post.`
    : "Couldn't find a Zoom link, meeting ID or passcode in that text.";
  refreshAll();
}

// ---------- highlights and messages ----------

function refreshAll() {
  const usable = drafts.filter((d) =>
    isTime(d.start) && Number.isInteger(d.minutes) && d.minutes > 0 && d.days.length > 0);
  const overlaps = findOverlaps(usable);
  for (const c of cards) updateCard(c, overlaps);
}

function updateCard(c, overlaps) {
  const d = c.d;
  for (const key of FIELD_KEYS) {
    const missing = isMissing(d, key);
    c.fields[key].wrap.classList.toggle("missing", missing);
    c.fields[key].badge.hidden = !missing;
  }
  c.time12.textContent = isTime(d.start) ? to12h(d.start) : "";
  c.title.textContent = d.name.trim() || "Unnamed subject";
  // Several cards share these buttons, so each one names its subject.
  c.testBtn.setAttribute("aria-label", `Test join for ${c.title.textContent}`);
  c.removeBtn.setAttribute("aria-label", `Remove ${c.title.textContent}`);

  const { errors, warnings } = validateSubject(toSaved(d));
  const extra = [];
  const linkId = linkIdMismatch(d);
  if (linkId) extra.push(`The meeting ID in the link (${linkId}) doesn't match the Meeting ID field.`);

  const byOther = new Map();
  for (const o of overlaps) {
    if (o.a !== d && o.b !== d) continue;
    const other = o.a === d ? o.b : o.a;
    byOther.set(other, [...(byOther.get(other) ?? []), o.day]);
  }
  for (const [other, days] of byOther) {
    extra.push(`Overlaps with ${other.name.trim() || "another class"} on ${days.join(", ")}.`);
  }

  c.errorCount = errors.length;
  const item = (cls, text) => h("li", { class: `ai-msg ${cls}`, text });
  c.msgs.replaceChildren(
    ...errors.map((e) => item("error", `Fix: ${e}`)),
    ...[...warnings, ...extra].map((w) => item("warn", `Check: ${w}`)),
  );
}
