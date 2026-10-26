// Phase 4. The alarm popup, its sound, and the "Start alarms" control + status chip.
// Browsers block sound until the student taps the page, so the Start alarms tap
// (and the Test alarm tap) call unlockAudio() first.

import { onAlarm, snooze, startAlarms, stopAlarms, alarmsRunning } from "../alarms.js";
import { joinUrl, to12h, endTime } from "../model.js";
import { loadState, onChange } from "../storage.js";

let latestState = null;
let wired = false;
let styleAdded = false;
let audioCtx = null;
let soundTimer = null;
let soundStartedAt = 0;
let overlay = null; // the popup that is open right now
const queue = []; // alarms waiting behind it

// ---------- tiny helpers ----------

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null) e.append(kid);
  return e;
}

const STYLE = `
.alarm-controls { display: grid; gap: 8px; margin-block: var(--space); }
.alarm-chip { display: inline-block; width: fit-content; padding: 4px 12px; border-radius: 999px; font-weight: 700; border: 2px solid var(--muted); }
.alarm-chip.on { border-color: var(--primary); color: var(--primary); }
.alarm-row { display: flex; flex-wrap: wrap; gap: 8px; }
.alarm-note { color: var(--muted); font-size: 0.9rem; margin: 0; }
.alarm-overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: var(--space); background: var(--bg); overflow: auto; }
.alarm-panel { width: 100%; max-width: 520px; display: grid; gap: var(--space); text-align: center; background: var(--surface); border-radius: var(--radius); padding: calc(var(--space) * 1.5); border-top: 10px solid var(--primary); }
.alarm-panel p { margin: 0; max-width: none; }
.alarm-kind { color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
.alarm-name { font-size: 2rem; margin: 0; overflow-wrap: anywhere; }
.alarm-count { font-size: 1.5rem; font-weight: 700; font-variant-numeric: tabular-nums; }
a.alarm-join { display: flex; align-items: center; justify-content: center; min-height: 72px; font-size: 1.5rem; font-weight: 700; border-radius: var(--radius); background: var(--primary); color: var(--bg); text-decoration: none; }
.alarm-pass { font-family: ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace; font-size: 1.25rem; letter-spacing: 0.05em; }
.alarm-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
`;

function injectStyles() {
  if (styleAdded) return;
  styleAdded = true;
  document.head.append(h("style", { text: STYLE }));
}

// ---------- sound (Web Audio, no audio files) ----------

// Must run inside a tap. Creates the audio engine and wakes it up.
export function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    audioCtx ??= new AC();
    audioCtx.resume?.();
    const silent = audioCtx.createBufferSource();
    silent.buffer = audioCtx.createBuffer(1, 1, 22050);
    silent.connect(audioCtx.destination);
    silent.start(0);
    return true;
  } catch {
    return false;
  }
}

// Three short beeps. Starts quiet and rises slowly to a safe maximum, so the
// first sound never blasts a sleeping student or their headphones.
function beepBurst() {
  try {
    audioCtx.resume?.();
    const elapsed = (Date.now() - soundStartedAt) / 1000;
    const level = Math.min(0.25, 0.08 + elapsed * 0.01);
    const t0 = audioCtx.currentTime;
    for (let i = 0; i < 3; i++) {
      const t = t0 + i * 0.3;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(level, t + 0.03); // soft edges: no clicks
      gain.gain.linearRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.22);
    }
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    /* no sound is better than a crash */
  }
}

function startSound() {
  stopSound();
  if (!audioCtx) return;
  soundStartedAt = Date.now();
  beepBurst();
  soundTimer = setInterval(beepBurst, 1800);
}

function stopSound() {
  if (soundTimer) clearInterval(soundTimer);
  soundTimer = null;
}

// ---------- the popup ----------

function snoozeMinutes() {
  const n = Number(latestState?.settings?.snoozeMinutes);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

// Only ever open web links.
function safeJoinUrl(subject) {
  const url = joinUrl(subject);
  return url && /^https?:\/\//i.test(url) ? url : null;
}

function countdownText(startsAt) {
  const secs = Math.round((startsAt.getTime() - Date.now()) / 1000);
  const abs = Math.abs(secs);
  const clock = `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
  return secs >= 0 ? `Starts in ${clock}` : `Started ${clock} ago`;
}

function handleAlarm(alarm) {
  notifyIfHidden(alarm);
  if (!overlay) return openOverlay(alarm);
  if (overlay.alarm.subject.id === alarm.subject.id) {
    closeOverlay({ next: false, restoreFocus: false });
    return openOverlay(alarm); // early alarm still open: update it to the start alarm
  }
  const waiting = queue.findIndex((a) => a.subject.id === alarm.subject.id);
  if (waiting >= 0) queue[waiting] = alarm;
  else queue.push(alarm);
}

function openOverlay(alarm) {
  injectStyles();
  // An open dialog (import preview, welcome) sits above everything and would hide the alarm.
  for (const dlg of document.querySelectorAll("dialog[open]")) dlg.close();
  const { subject, startsAt, kind } = alarm;
  const url = safeJoinUrl(subject);
  const minutes = snoozeMinutes();
  const kindText = kind === "early" ? "Starting soon" : "Class is starting";

  const count = h("p", { class: "alarm-count", text: countdownText(startsAt) });
  const timeText = /^\d\d:\d\d$/.test(subject.start ?? "")
    ? `${to12h(subject.start)} to ${to12h(endTime(subject))}`
    : "";

  let joinArea;
  if (url) {
    joinArea = h("a", {
      class: "alarm-join", href: url, target: "_blank", rel: "noopener noreferrer", text: "Join now",
      // A real link tap: the browser allows it to open Zoom. We only stop the noise.
      onclick: () => { stopSound(); setTimeout(() => closeOverlay(), 0); },
    });
  } else {
    joinArea = h("p", { class: "alarm-note", text: "No link or meeting ID is saved for this class." });
  }

  const passStatus = h("span", { role: "status", class: "alarm-note" });
  const passArea = subject.passcode && !subject.link
    ? h("div", {},
        h("p", { class: "alarm-note", text: "Passcode" }),
        h("p", { class: "alarm-pass", text: subject.passcode }),
        h("button", { type: "button", class: "secondary", text: "Copy passcode", onclick: () => copyPasscode(subject.passcode, passStatus) }),
        passStatus)
    : null;

  const panel = h("div", { class: "alarm-panel", style: `border-top-color:${/^#[0-9a-f]{3,8}$/i.test(subject.color ?? "") ? subject.color : "var(--primary)"}` },
    h("p", { class: "alarm-kind", text: alarm.isTest ? `Test alarm: ${kindText}` : kindText }),
    h("h2", { class: "alarm-name", id: "alarm-title", text: subject.name || "Class" }),
    timeText ? h("p", { text: timeText }) : null,
    count,
    joinArea,
    passArea,
    h("div", { class: "alarm-actions" },
      h("button", { type: "button", class: "secondary", text: `Snooze ${minutes} min`, onclick: () => onSnooze(alarm, minutes) }),
      h("button", { type: "button", class: "secondary", text: "Dismiss", onclick: () => closeOverlay() })),
  );
  const root = h("div", { class: "alarm-overlay", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "alarm-title" }, panel);

  const onKey = (e) => {
    if (e.key === "Escape") closeOverlay();
    else if (e.key === "Tab") trapFocus(e, root);
  };
  document.addEventListener("keydown", onKey);

  overlay = {
    alarm, root, onKey,
    previousFocus: document.activeElement,
    tick: setInterval(() => { count.textContent = countdownText(startsAt); }, 1000),
  };
  document.body.append(root);
  (root.querySelector("a.alarm-join") ?? root.querySelector("button"))?.focus();
  startSound();
}

function closeOverlay({ next = true, restoreFocus = true } = {}) {
  if (!overlay) return;
  const { root, onKey, previousFocus, tick } = overlay;
  overlay = null;
  stopSound();
  clearInterval(tick);
  document.removeEventListener("keydown", onKey);
  root.remove();
  if (restoreFocus) previousFocus?.focus?.();
  if (next && queue.length > 0) openOverlay(queue.shift());
}

function onSnooze(alarm, minutes) {
  if (!alarm.isTest) snooze(alarm.subject.id, minutes);
  closeOverlay();
}

// Keep Tab inside the popup while it is open.
function trapFocus(e, root) {
  const items = [...root.querySelectorAll("a[href], button")];
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

async function copyPasscode(text, status) {
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = "Copied.";
  } catch {
    status.textContent = "Couldn't copy. Select the passcode and copy it yourself.";
  }
}

// Optional extra: a system notification if the page is in the background.
function notifyIfHidden(alarm) {
  try {
    if (!document.hidden || !("Notification" in window) || Notification.permission !== "granted") return;
    const what = alarm.kind === "early" ? "starts soon" : "is starting";
    const n = new Notification(`${alarm.subject.name || "Class"} ${what}`, {
      tag: `kronokairos-${alarm.subject.id}`,
      body: "Open Kronokairos to join.",
    });
    n.onclick = () => { window.focus(); n.close(); };
  } catch {
    /* some phones do not allow this from a page: the popup still works */
  }
}

function askForNotifications() {
  try {
    if (!("Notification" in window) || Notification.permission !== "default") return;
    Notification.requestPermission()?.catch?.(() => {});
  } catch {
    /* optional */
  }
}

// ---------- the Start alarms control (used by the Today screen) ----------

function wireOnce() {
  if (wired) return;
  wired = true;
  onAlarm(handleAlarm);
  onChange((next) => { latestState = next; });
}

function onStart(box) {
  unlockAudio(); // must happen inside this tap
  askForNotifications();
  wireOnce();
  startAlarms(() => latestState ?? loadState());
  paint(box);
}

function onStop(box) {
  stopAlarms();
  paint(box);
}

function onTest(box) {
  unlockAudio();
  wireOnce();
  const subject = latestState?.subjects?.[0]
    ?? { id: "test", name: "Test class", color: "#3b82f6", start: "", minutes: 60, link: "", meetingId: "", passcode: "" };
  handleAlarm({ subject, startsAt: new Date(), kind: "start", isTest: true });
  paint(box);
}

function paint(box) {
  const on = alarmsRunning();
  const hasSound = !!(window.AudioContext || window.webkitAudioContext);
  box.replaceChildren(
    h("span", { class: `alarm-chip ${on ? "on" : "off"}`, role: "status", text: on ? "● Alarms on" : "○ Alarms off, tap to start" }),
    h("div", { class: "alarm-row" },
      on
        ? h("button", { type: "button", class: "secondary", text: "Stop alarms", onclick: () => onStop(box) })
        : h("button", { type: "button", text: "Start alarms", onclick: () => onStart(box) }),
      h("button", { type: "button", class: "secondary", text: "Test alarm", onclick: () => onTest(box) })),
    h("p", { class: "alarm-note", text: "The page must stay open. For alarms when the page is closed, use Add to my calendar." }),
    hasSound ? null : h("p", { class: "alarm-note", text: "This browser can't play the alarm sound. The popup will still appear." }),
  );
}

// The Today screen calls this with a small empty container.
export function render(container, state) {
  injectStyles();
  latestState = state;
  wireOnce();
  container.classList.add("alarm-controls");
  paint(container);
}
