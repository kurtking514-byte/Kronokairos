// Clock-face time picker. Tap or drag on the dial: hours first, then minutes.
// Tapping a number picks 5-minute steps; dragging (or the arrow keys) gives exact minutes.
// Values in and out are 24-hour "HH:MM", the same as the data contract.

import { to12h } from "../model.js";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const pad = (n) => String(n).padStart(2, "0");
const RADIUS = 100; // px from the dial centre to the numbers (dial is 256px wide)

function make(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// A button that looks like a field and opens the clock. onChange gets "HH:MM".
export function timeButton(id, value, onChange) {
  const btn = make("button", "time-btn");
  btn.type = "button";
  btn.id = id;
  const text = make("span", "time-btn-text");
  const icon = make("span", "time-btn-icon");
  icon.setAttribute("aria-hidden", "true");
  btn.append(text, icon);
  let current = value;
  const paint = () => {
    const ok = TIME_RE.test(current ?? "");
    text.textContent = ok ? to12h(current) : "Set time";
    btn.classList.toggle("is-empty", !ok);
  };
  paint();
  btn.addEventListener("click", () => openClock(current, (picked) => {
    current = picked;
    paint();
    onChange(picked);
  }, btn));
  return { button: btn, text, set(v) { current = v; paint(); } };
}

// Opens the picker as a modal dialog. Focus returns to `opener` when it closes.
export function openClock(value, onPick, opener) {
  const start = TIME_RE.test(value ?? "") ? value : "08:00";
  let h = Number(start.slice(0, 2));
  let m = Number(start.slice(3, 5));
  let mode = "hour";

  const dlg = make("dialog", "clock");
  dlg.setAttribute("aria-labelledby", "clock-title");
  const title = make("h2", "clock-title", "Start time");
  title.id = "clock-title";

  // Read-out: tap the hour or minute to switch what the dial sets.
  const hourBtn = make("button", "clock-part");
  const minBtn = make("button", "clock-part");
  for (const b of [hourBtn, minBtn]) b.type = "button";
  hourBtn.addEventListener("click", () => setMode("hour"));
  minBtn.addEventListener("click", () => setMode("minute"));
  const amBtn = make("button", "clock-ampm", "AM");
  const pmBtn = make("button", "clock-ampm", "PM");
  for (const b of [amBtn, pmBtn]) b.type = "button";
  amBtn.addEventListener("click", () => { if (h >= 12) h -= 12; paint(); });
  pmBtn.addEventListener("click", () => { if (h < 12) h += 12; paint(); });
  const ampm = make("div", "clock-ampm-group");
  ampm.setAttribute("role", "group");
  ampm.setAttribute("aria-label", "AM or PM");
  ampm.append(amBtn, pmBtn);
  const readout = make("div", "clock-readout");
  readout.append(hourBtn, make("span", "clock-colon", ":"), minBtn);

  const dial = make("div", "clock-dial");
  dial.setAttribute("role", "group");
  const hand = make("div", "clock-hand");
  hand.setAttribute("aria-hidden", "true");
  const hint = make("p", "clock-hint");
  const live = make("p", "clock-live");
  live.setAttribute("aria-live", "polite");

  const cancel = make("button", "secondary", "Cancel");
  const ok = make("button", "", "OK");
  for (const b of [cancel, ok]) b.type = "button";
  cancel.addEventListener("click", () => finish());
  ok.addEventListener("click", () => finish(`${pad(h)}:${pad(m)}`));
  const actions = make("div", "clock-actions");
  actions.append(cancel, ok);

  dlg.append(title, readout, ampm, dial, hint, live, actions);

  function numbers() {
    dial.replaceChildren(hand, make("span", "clock-center"));
    for (let i = 0; i < 12; i++) {
      const angle = i * 30;
      const value = mode === "hour" ? (i === 0 ? 12 : i) : i * 5;
      const b = make("button", "clock-num", mode === "hour" ? String(value) : pad(value));
      b.type = "button";
      b.dataset.value = String(value);
      b.style.left = `calc(50% + ${Math.sin((angle * Math.PI) / 180) * RADIUS}px)`;
      b.style.top = `calc(50% - ${Math.cos((angle * Math.PI) / 180) * RADIUS}px)`;
      b.setAttribute("aria-label", mode === "hour" ? `${value} o'clock` : `${value} minutes`);
      // Keyboard and screen readers click with detail 0. Pointer taps are handled by the dial below.
      b.addEventListener("click", (e) => { if (e.detail === 0) pick(value, true); });
      dial.append(b);
    }
  }

  function pick(value, fromKey) {
    if (mode === "hour") {
      h = (value % 12) + (h >= 12 ? 12 : 0);
      paint();
      if (fromKey) setMode("minute", true);
    } else {
      m = value;
      paint();
    }
  }

  function setMode(next, focusDial) {
    mode = next;
    numbers();
    paint();
    if (!focusDial) return;
    const near = mode === "hour" ? (h % 12 || 12) : (Math.round(m / 5) * 5) % 60;
    dial.querySelector(`.clock-num[data-value="${near}"]`)?.focus();
  }

  function paint() {
    const h12 = h % 12 === 0 ? 12 : h % 12;
    hourBtn.textContent = String(h12);
    minBtn.textContent = pad(m);
    hourBtn.setAttribute("aria-label", `Hour ${h12}. Change hour`);
    minBtn.setAttribute("aria-label", `Minute ${pad(m)}. Change minute`);
    hourBtn.setAttribute("aria-pressed", String(mode === "hour"));
    minBtn.setAttribute("aria-pressed", String(mode === "minute"));
    amBtn.setAttribute("aria-pressed", String(h < 12));
    pmBtn.setAttribute("aria-pressed", String(h >= 12));
    dial.setAttribute("aria-label", mode === "hour" ? "Choose the hour" : "Choose the minute");
    hint.textContent = mode === "hour" ? "Tap or drag to the hour" : "Tap a number, or drag for exact minutes";
    const angle = mode === "hour" ? (h % 12) * 30 : m * 6;
    hand.style.transform = `rotate(${angle}deg)`;
    const selected = mode === "hour" ? h12 : m;
    for (const b of dial.querySelectorAll(".clock-num")) {
      b.setAttribute("aria-pressed", String(Number(b.dataset.value) === selected));
    }
    live.textContent = to12h(`${pad(h)}:${pad(m)}`);
  }

  // Pointer: the angle from the dial centre picks the value.
  let dragging = false;
  function fromPointer(e) {
    const r = dial.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI + 360;
    if (mode === "hour") pick(Math.round(deg / 30) % 12 || 12);
    else pick(Math.round(deg / 6) % 60);
  }
  dial.addEventListener("pointerdown", (e) => {
    dragging = true;
    dial.setPointerCapture?.(e.pointerId);
    fromPointer(e);
    e.preventDefault();
  });
  dial.addEventListener("pointermove", (e) => { if (dragging) fromPointer(e); });
  dial.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    if (mode === "hour") setMode("minute");
  });
  dial.addEventListener("pointercancel", () => { dragging = false; });

  // Arrow keys (anywhere in the picker): one hour or one minute at a time.
  dlg.addEventListener("keydown", (e) => {
    const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    if (mode === "hour") h = (h + step + 24) % 24;
    else m = (m + step + 60) % 60;
    paint();
  });

  // Close and clean up first, so the caller can redraw and move focus without the dialog taking it back.
  // Done directly rather than in a "close" listener, which some browsers fire late or not at all.
  function finish(picked) {
    if (!dlg.isConnected) return;
    if (dlg.open) dlg.close();
    dlg.remove();
    if (opener?.isConnected) opener.focus();
    if (picked) onPick(picked);
  }
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(); }); // Escape key
  dlg.addEventListener("close", () => finish());

  numbers();
  paint();
  document.body.append(dlg);
  dlg.showModal();
  hourBtn.focus();
}
