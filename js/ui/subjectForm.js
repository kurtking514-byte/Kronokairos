// Add / edit a subject, by tapping. Other screens open it with openEditor(id).

import { DAYS, newSubject, validateSubject, findOverlaps } from "../model.js";
import { saveState } from "../storage.js";
import { parseInvite } from "../invite.js";
import { el, ensureStyles, goTo, currentScreen, openAddScreen } from "./shared.js";
import { timeButton } from "./clockPicker.js";

const NAME_CHIPS = ["Math", "English", "History", "PathFit", "Science", "Filipino", "PE"];
const COLORS = [
  { hex: "#3b82f6", name: "Blue" }, { hex: "#ef4444", name: "Red" }, { hex: "#22c55e", name: "Green" },
  { hex: "#f59e0b", name: "Amber" }, { hex: "#a855f7", name: "Purple" }, { hex: "#ec4899", name: "Pink" },
  { hex: "#14b8a6", name: "Teal" }, { hex: "#64748b", name: "Slate" },
];
const TIME_OK = /^([01]\d|2[0-3]):[0-5]\d$/;

// Screen readers announce a row of buttons as a named group.
function group(node, label) {
  node.setAttribute("role", "group");
  node.setAttribute("aria-label", label);
  return node;
}

// Phone keyboards must not "fix" links, IDs or passcodes (a capital letter would break a passcode).
function noAutoFix(input) {
  input.autocapitalize = "off";
  input.setAttribute("autocorrect", "off");
  input.spellcheck = false;
  input.autocomplete = "off";
  return input;
}

let editingId = null;
let returnTo = null;

// Used by Schedule and Links. No id = a new subject.
export function openEditor(id = null) {
  editingId = id;
  returnTo = currentScreen();
  openAddScreen();
}

export function render(container, state) {
  ensureStyles();
  const id = editingId;
  const back = returnTo ?? currentScreen();
  editingId = null; // so a later plain "+" tap starts a blank form
  returnTo = null;

  const existing = id ? state.subjects.find((s) => s.id === id) : null;
  const draft = existing ? { ...existing, days: [...existing.days] } : newSubject({ days: [] });
  let tried = false;
  let confirmDelete = false;
  let colorOpen = false; // is the colour picker showing?
  let pasteOpen = false; // is the Paste invite box showing?
  let pasteText = "";    // what the student has pasted so far
  let pasteNote = null;  // { kind: "ok" | "error", text } shown under the Paste invite button
  let saveError = null;  // text shown when the last Save could not be written to this device

  const root = el("div", "p1");
  container.append(root);

  function redraw(focusKey) {
    root.replaceChildren(...build());
    if (focusKey) root.querySelector(`[data-k="${focusKey}"]`)?.focus();
  }

  function btn(label, key, onClick, extra = "", pressed) {
    const b = el("button", `p1-btn ${extra}`.trim(), label);
    b.type = "button";
    b.dataset.k = key;
    if (pressed !== undefined) b.setAttribute("aria-pressed", String(pressed));
    b.addEventListener("click", onClick);
    return b;
  }

  function field(labelText, inputId, input, hint) {
    const wrap = el("div", "p1-field");
    const label = el("label", "", labelText);
    label.htmlFor = inputId;
    input.id = inputId;
    wrap.append(label, input);
    if (hint) wrap.append(el("span", "p1-muted", hint));
    return wrap;
  }

  function textInput(prop, extra = "", type = "text") {
    const input = el("input", `p1-input ${extra}`.trim());
    input.type = type;
    input.value = draft[prop] ?? "";
    input.addEventListener("input", () => { draft[prop] = input.value; });
    return input;
  }

  // Subject name (with suggestions) and a small colour button on the same row.
  function nameSection() {
    const wrap = el("div", "p1-field");
    const label = el("label", "", "Subject");
    label.htmlFor = "f-name";
    const input = textInput("name");
    input.id = "f-name";
    input.placeholder = "e.g. Math";
    input.autocapitalize = "words";
    input.setAttribute("list", "f-names");
    const names = el("datalist");
    names.id = "f-names";
    for (const n of NAME_CHIPS) {
      const o = el("option");
      o.value = n;
      names.append(o);
    }
    const current = COLORS.find((c) => c.hex === draft.color)?.name ?? "Custom";
    const colorBtn = btn("", "color-toggle", () => { colorOpen = !colorOpen; redraw("color-toggle"); });
    colorBtn.className = "f-color-btn";
    colorBtn.style.setProperty("--swatch", draft.color);
    colorBtn.setAttribute("aria-label", `Color: ${current}. Change color`);
    colorBtn.setAttribute("aria-expanded", String(colorOpen));
    const row = el("div", "f-name-row");
    row.append(input, colorBtn);
    wrap.append(label, row, names);
    if (colorOpen) wrap.append(colorSection());
    return wrap;
  }

  function daysSection() {
    const wrap = el("div", "p1-field");
    wrap.append(el("span", "p1-label", "Days"));
    const row = group(el("div", "seg"), "Days");
    for (const d of DAYS) { // Mon to Sat only. There is no Sunday.
      const on = draft.days.includes(d);
      row.append(btn(d, `day-${d}`, () => {
        draft.days = on ? draft.days.filter((x) => x !== d) : DAYS.filter((x) => x === d || draft.days.includes(x));
        redraw(`day-${d}`);
      }, "", on));
    }
    wrap.append(row);
    return wrap;
  }

  function timeSection() {
    const wrap = el("div", "p1-field");
    const label = el("label", "", "Start time");
    label.htmlFor = "f-start";
    const { button } = timeButton("f-start", draft.start, (v) => { draft.start = v; redraw("f-start"); });
    button.dataset.k = "f-start";
    wrap.append(label, button);
    return wrap;
  }

  // Length in minutes: type it, or nudge it by 5.
  function lengthSection() {
    const wrap = el("div", "p1-field");
    const label = el("label", "", "Length (min)");
    label.htmlFor = "f-minutes";
    const input = el("input", "");
    input.id = "f-minutes";
    input.type = "number";
    input.inputMode = "numeric";
    input.min = "10";
    input.max = "300";
    input.step = "5";
    input.value = Number.isInteger(draft.minutes) ? String(draft.minutes) : "";
    input.dataset.k = "len-input";
    input.addEventListener("input", () => {
      const n = Math.round(Number(input.value));
      draft.minutes = input.value.trim() && Number.isFinite(n) ? n : "";
    });
    const shown = Number.isInteger(draft.minutes) ? draft.minutes : 0;
    const minus = btn("−", "len-minus", () => { draft.minutes = Math.max(10, shown - 5); redraw("len-minus"); });
    minus.setAttribute("aria-label", "5 minutes shorter");
    const plus = btn("+", "len-plus", () => { draft.minutes = Math.min(300, (shown || 55) + 5); redraw("len-plus"); });
    plus.setAttribute("aria-label", "5 minutes longer");
    const stepper = el("div", "stepper");
    stepper.append(minus, input, plus);
    wrap.append(label, stepper);
    return wrap;
  }

  function colorSection() {
    const row = group(el("div", "f-colors"), "Color");
    const options = COLORS.some((c) => c.hex === draft.color) ? COLORS : [...COLORS, { hex: draft.color, name: "Current" }];
    for (const c of options) {
      const on = draft.color === c.hex;
      const b = el("button", "p1-swatch");
      b.type = "button";
      b.dataset.k = `color-${c.hex}`;
      b.style.background = c.hex;
      b.setAttribute("aria-label", c.name);
      b.setAttribute("aria-pressed", String(on));
      b.addEventListener("click", () => { draft.color = c.hex; colorOpen = false; redraw("color-toggle"); });
      row.append(b);
    }
    return row;
  }

  const FIELD_NAMES = { link: "Zoom link", meetingId: "Meeting ID", passcode: "Passcode" };

  // Copy only what the invite contained. Anything not found keeps its current value.
  function fillFromInvite() {
    const found = parseInvite(pasteText);
    const filled = [];
    if (found.link) { draft.link = found.link.trim(); filled.push("link"); }
    if (found.meetingId) { draft.meetingId = found.meetingId.replace(/\s+/g, ""); filled.push("meetingId"); }
    if (found.passcode) { draft.passcode = found.passcode; filled.push("passcode"); } // exact case, no trimming of letters
    if (!filled.length) {
      pasteNote = {
        kind: "error",
        text: pasteText.trim()
          ? "No Zoom link, meeting ID or passcode found in that text. Check that you copied the whole invite, or type the details in below."
          : "Paste the teacher's Zoom invite first.",
      };
      return redraw("paste-text");
    }
    const missing = Object.keys(FIELD_NAMES).filter((k) => !filled.includes(k));
    pasteNote = {
      kind: "ok",
      text: `Filled in: ${filled.map((k) => FIELD_NAMES[k]).join(", ")}.` +
        (missing.length ? ` Not found, left as it was: ${missing.map((k) => FIELD_NAMES[k]).join(", ")}.` : "") +
        " Please check the details, then tap Save.",
    };
    pasteOpen = false;
    pasteText = "";
    redraw("paste-note");
  }

  function pastePanel() {
    const wrap = el("div", "f-paste");
    if (pasteOpen) {
      const box = noAutoFix(el("textarea", "p1-input p1-mono"));
      box.rows = 5;
      box.value = pasteText;
      box.dataset.k = "paste-text";
      box.placeholder = "Paste the teacher's whole Zoom invite here";
      box.setAttribute("aria-label", "Teacher's Zoom invite");
      box.addEventListener("input", () => { pasteText = box.value; });
      const row = el("div", "p1-row");
      row.append(
        btn("Fill in details", "paste-go", fillFromInvite, "primary"),
        btn("Close", "paste-close", () => { pasteOpen = false; pasteNote = null; redraw("paste"); }),
      );
      wrap.append(box, row);
    }
    if (pasteNote) {
      const p = el("p", `p1-msg${pasteNote.kind === "error" ? " error" : ""}`, pasteNote.text);
      p.setAttribute("role", pasteNote.kind === "error" ? "alert" : "status");
      p.tabIndex = -1; // so focus can move here and screen readers read it
      p.dataset.k = "paste-note";
      wrap.append(p);
    }
    return wrap;
  }

  function zoomSection() {
    const frag = document.createDocumentFragment();
    const head = el("div", "f-section");
    const paste = btn(pasteOpen ? "Hide paste box" : "Paste invite", "paste", () => {
      pasteOpen = !pasteOpen;
      pasteNote = null;
      redraw(pasteOpen ? "paste-text" : "paste");
    }, "ghost");
    paste.setAttribute("aria-expanded", String(pasteOpen));
    head.append(el("h3", "", "Zoom"), paste);

    const link = noAutoFix(textInput("link", "", "url"));
    link.placeholder = "https://zoom.us/j/…";
    const idInput = noAutoFix(textInput("meetingId"));
    idInput.inputMode = "numeric";
    idInput.placeholder = "9–11 digits";
    const pass = noAutoFix(textInput("passcode", "p1-mono"));
    const pair = el("div", "f-pair");
    pair.append(field("Meeting ID", "f-id", idInput), field("Passcode", "f-pass", pass));
    frag.append(
      head,
      pastePanel(),
      field("Zoom link", "f-link", link),
      pair,
      el("p", "f-hint", "Passcodes are case-sensitive. Copy them exactly."),
    );
    return frag;
  }

  function messages() {
    const out = [];
    const { errors, warnings } = validateSubject(draft);
    if (saveError) {
      const p = el("p", "p1-msg error", saveError);
      p.setAttribute("role", "alert");
      p.tabIndex = -1; // so focus can move here and screen readers read it
      p.dataset.k = "save-error";
      out.push(p);
    }
    const shownErrors = tried ? errors : [];
    for (const e of shownErrors) {
      const p = el("p", "p1-msg error", `Fix this: ${e}`);
      p.setAttribute("role", "alert");
      out.push(p);
    }
    if (tried) for (const w of warnings) out.push(el("p", "p1-msg", `Note: ${w}`)); // not on a blank form
    if (TIME_OK.test(draft.start) && Number.isInteger(draft.minutes) && draft.days.length) {
      const others = state.subjects.filter((s) => !existing || s.id !== existing.id);
      for (const o of findOverlaps([...others, draft]).filter((x) => x.a === draft || x.b === draft)) {
        const other = o.a === draft ? o.b : o.a;
        out.push(el("p", "p1-msg", `Note: this overlaps with ${other.name || "another class"} on ${o.day}.`));
      }
    }
    return out;
  }

  function save() {
    tried = true;
    saveError = null;
    Object.assign(draft, {
      name: draft.name.trim(), link: draft.link.trim(),
      meetingId: draft.meetingId.replace(/\s+/g, ""), passcode: draft.passcode.trim(),
    });
    if (validateSubject(draft).errors.length) return redraw("save");
    const subjects = existing
      ? state.subjects.map((s) => (s.id === existing.id ? { ...draft } : s))
      : [...state.subjects, { ...draft }];
    const saved = saveState({ ...state, subjects });
    if (!saved) {
      // saveState tells the app about the change even when the write fails, and the app
      // redraws this screen from scratch (a blank form) before saveState returns.
      // Put this form, with everything the student entered, back on screen.
      saveError =
        "This class was not saved to this device, so it may be lost when the page closes. " +
        "Your browser may be blocking site storage. Your entries are still here. Tap Save to try again.";
      container.replaceChildren(root);
      return redraw("save-error");
    }
    goTo(back);
  }

  function deleteArea() {
    const area = el("div", "p1-row f-delete");
    if (!confirmDelete) {
      area.append(btn("Delete this class", "delete", () => { confirmDelete = true; redraw("delete-yes"); }, "danger"));
      return area;
    }
    const warn = el("p", "p1-msg error", "Delete this class? This cannot be undone.");
    warn.setAttribute("role", "alert");
    area.append(
      warn,
      btn("Yes, delete", "delete-yes", () => {
        saveState({ ...state, subjects: state.subjects.filter((s) => s.id !== existing.id) });
        goTo(back);
      }, "danger solid"),
      btn("Keep it", "delete-no", () => { confirmDelete = false; redraw("delete"); }),
    );
    return area;
  }

  // Full-screen form: Cancel and Save sit in a top bar, so nothing important is below the fold.
  function build() {
    const form = el("form", "");
    form.noValidate = true;
    form.addEventListener("submit", (e) => { e.preventDefault(); save(); });
    const bar = el("div", "form-bar");
    const saveBtn = btn("Save", "save", () => {}, "primary");
    saveBtn.type = "submit";
    bar.append(btn("Cancel", "cancel", () => goTo(back), "ghost"), el("h2", "", existing ? "Edit class" : "Add a class"), saveBtn);
    const body = el("div", "form-body");
    const when = el("div", "f-pair");
    when.append(timeSection(), lengthSection());
    body.append(...messages(), nameSection(), daysSection(), when, zoomSection());
    if (existing) body.append(deleteArea());
    form.append(bar, body);
    return [form];
  }

  redraw();
}
