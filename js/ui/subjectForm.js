// Add / edit a subject, by tapping. Other screens open it with openEditor(id).

import { DAYS, newSubject, validateSubject, findOverlaps, to12h } from "../model.js";
import { saveState } from "../storage.js";
import { parseInvite } from "../invite.js";
import { el, ensureStyles, goTo, currentScreen, openAddScreen, textOn } from "./shared.js";

const NAME_CHIPS = ["Math", "English", "History", "PathFit", "Science", "Filipino", "PE"];
const LENGTH_CHIPS = [60, 70, 80, 90, 120];
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
    const b = el("button", `p1-btn ${extra}`.trim(), (pressed ? "✓ " : "") + label);
    b.type = "button";
    b.dataset.k = key;
    if (pressed !== undefined) b.setAttribute("aria-pressed", String(pressed));
    if (pressed) b.setAttribute("aria-label", label); // so the tick mark is not read aloud
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

  function nameSection() {
    const wrap = el("div", "p1-field");
    wrap.append(el("span", "p1-label", "Subject"));
    const chips = group(el("div", "p1-row"), "Common subject names");
    for (const n of NAME_CHIPS) {
      chips.append(btn(n, `name-${n}`, () => { draft.name = n; redraw(`name-${n}`); }, "", draft.name === n));
    }
    wrap.append(chips);
    const input = textInput("name");
    wrap.append(field("Or type a name", "f-name", input));
    return wrap;
  }

  function daysSection() {
    const wrap = el("div", "p1-field");
    wrap.append(el("span", "p1-label", "Days"));
    const row = group(el("div", "p1-row"), "Days");
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
    const input = textInput("start", "", "time");
    const hint = TIME_OK.test(draft.start) ? `Starts at ${to12h(draft.start)}` : "";
    return field("Start time", "f-start", input, hint);
  }

  function lengthSection() {
    const wrap = el("div", "p1-field");
    wrap.append(el("span", "p1-label", "Length"));
    const chips = group(el("div", "p1-row"), "Common lengths in minutes");
    for (const m of LENGTH_CHIPS) {
      const chip = btn(String(m), `len-${m}`, () => { draft.minutes = m; redraw(`len-${m}`); }, "", draft.minutes === m);
      chip.setAttribute("aria-label", `${m} minutes`);
      chips.append(chip);
    }
    wrap.append(chips);
    const step = el("div", "p1-row");
    const shown = Number.isInteger(draft.minutes) ? draft.minutes : 0;
    const minus = btn("− 5", "len-minus", () => { draft.minutes = Math.max(10, shown - 5); redraw("len-minus"); });
    minus.setAttribute("aria-label", "5 minutes shorter");
    const plus = btn("+ 5", "len-plus", () => { draft.minutes = Math.min(300, (shown || 55) + 5); redraw("len-plus"); });
    plus.setAttribute("aria-label", "5 minutes longer");
    step.append(minus, el("strong", "", `${shown} minutes`), plus);
    wrap.append(step);
    return wrap;
  }

  function colorSection() {
    const wrap = el("div", "p1-field");
    wrap.append(el("span", "p1-label", "Color"));
    const row = group(el("div", "p1-row"), "Color");
    const options = COLORS.some((c) => c.hex === draft.color) ? COLORS : [...COLORS, { hex: draft.color, name: "Current" }];
    for (const c of options) {
      const on = draft.color === c.hex;
      const b = el("button", "p1-swatch", on ? "✓" : "");
      b.type = "button";
      b.dataset.k = `color-${c.hex}`;
      b.style.background = c.hex;
      b.style.color = textOn(c.hex);
      b.setAttribute("aria-label", c.name);
      b.setAttribute("aria-pressed", String(on));
      b.addEventListener("click", () => { draft.color = c.hex; redraw(`color-${c.hex}`); });
      row.append(b);
    }
    wrap.append(row);
    return wrap;
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

  function pasteSection() {
    const wrap = el("div", "p1-field");
    const open = btn("Paste invite", "paste", () => {
      pasteOpen = !pasteOpen;
      pasteNote = null;
      redraw(pasteOpen ? "paste-text" : "paste");
    });
    open.setAttribute("aria-expanded", String(pasteOpen));
    wrap.append(open);

    if (pasteOpen) {
      const box = noAutoFix(el("textarea", "p1-input p1-mono"));
      box.rows = 6;
      box.style.padding = "8px 10px";
      box.value = pasteText;
      box.dataset.k = "paste-text";
      box.addEventListener("input", () => { pasteText = box.value; });
      wrap.append(field("Paste the teacher's Zoom invite here", "f-paste", box));
      const row = el("div", "p1-row");
      row.append(
        btn("Fill in details", "paste-go", fillFromInvite, "primary"),
        btn("Close", "paste-close", () => { pasteOpen = false; pasteNote = null; redraw("paste"); }),
      );
      wrap.append(row);
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
    const idInput = noAutoFix(textInput("meetingId"));
    idInput.inputMode = "numeric";
    frag.append(
      pasteSection(),
      field("Zoom link", "f-link", noAutoFix(textInput("link", "", "url"))),
      field("Meeting ID", "f-id", idInput, "Digits only, 9 to 11 of them."),
      field("Passcode", "f-pass", noAutoFix(textInput("passcode", "p1-mono")), "Copy it exactly. Capital and small letters matter."),
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
    for (const w of warnings) out.push(el("p", "p1-msg", `Note: ${w}`));
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
    const area = el("div", "p1-row");
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

  function build() {
    const form = el("form", "");
    form.noValidate = true;
    form.addEventListener("submit", (e) => { e.preventDefault(); save(); });
    const actions = el("div", "p1-row");
    const saveBtn = btn("Save", "save", () => {}, "primary");
    saveBtn.type = "submit";
    actions.append(saveBtn, btn("Cancel", "cancel", () => goTo(back)));
    form.append(
      nameSection(), daysSection(), timeSection(), lengthSection(), colorSection(), zoomSection(),
      ...messages(), actions,
    );
    const nodes = [el("h2", "", existing ? "Edit class" : "Add a class"), form];
    if (existing) nodes.push(deleteArea());
    return nodes;
  }

  redraw();
}
