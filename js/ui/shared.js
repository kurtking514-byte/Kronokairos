// Small helpers shared by the Phase 1 screens (today, schedule, links, subjectForm).
// Styles are added from JavaScript so css/styles.css does not need to change; move them there in Phase 8 if you like.

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DAY_LONG = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---- moving between screens without touching app.js: click the real buttons ----
let lastTab = "today";

export function currentScreen() {
  return lastTab;
}
export function goTo(name) {
  document.querySelector(`.tab[data-screen="${name}"]`)?.click();
}
export function openAddScreen() {
  document.getElementById("add-btn")?.click();
}

// ---- clipboard ----
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const box = document.createElement("textarea");
      box.value = text;
      box.style.position = "fixed";
      box.style.opacity = "0";
      document.body.append(box);
      box.select();
      const ok = document.execCommand("copy");
      box.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

// Black or white text, whichever reads better on a background colour.
export function textOn(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#000" : "#fff";
}

export function ensureStyles() {
  if (!ensureStyles.listening) {
    ensureStyles.listening = true;
    document.addEventListener("click", (e) => {
      const tab = e.target?.closest?.(".tab");
      if (tab?.dataset.screen) lastTab = tab.dataset.screen;
    });
  }
  if (document.getElementById("p1-styles")) return;
  const style = document.createElement("style");
  style.id = "p1-styles";
  style.textContent = `
    .p1 h2 { margin: 0 0 4px; }
    .p1-muted { color: var(--muted, #555); }
    .p1-card { background: var(--surface, transparent); border: 2px solid rgba(128,128,128,.35);
      border-radius: var(--radius, 12px); padding: var(--space, 16px); margin: 0 0 12px; }
    .p1-card.is-now { border-color: var(--primary, #2563eb); }
    .p1-card.is-ended { opacity: .7; }
    .p1-card p { margin: 6px 0; }
    .p1-title { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 1.15rem; font-weight: 700; }
    .p1-dot { width: 14px; height: 14px; border-radius: 50%; flex: none; border: 1px solid rgba(0,0,0,.4); }
    .p1-tag { font-size: .8rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
    .p1-countdown { font-size: 1.3rem; font-weight: 700; font-variant-numeric: tabular-nums; }
    .p1-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0; }
    .p1-btn { min-height: 44px; min-width: 44px; padding: 0 16px; font: inherit; cursor: pointer; box-sizing: border-box;
      display: inline-flex; align-items: center; justify-content: center; text-decoration: none;
      color: var(--text, inherit); background: transparent;
      border: 2px solid var(--primary, #2563eb); border-radius: var(--radius, 12px); }
    .p1-btn[aria-pressed="true"] { background: var(--primary, #2563eb); color: var(--bg, #fff); font-weight: 600; }
    .p1-btn.primary { background: var(--primary, #2563eb); color: var(--bg, #fff); font-weight: 700; }
    .p1-btn.big { width: 100%; min-height: 56px; font-size: 1.2rem; }
    .p1-btn.danger { border-color: var(--danger, #dc2626); color: var(--danger, #dc2626); }
    .p1-btn.danger.solid { background: var(--danger, #dc2626); color: var(--bg, #fff); font-weight: 600; }
    .p1-btn:disabled { opacity: .5; cursor: not-allowed; }
    .p1 button:focus-visible, .p1 a:focus-visible, .p1 input:focus-visible { outline: 3px solid var(--text, #000); outline-offset: 2px; }
    .p1-field { display: flex; flex-direction: column; gap: 4px; margin: 14px 0; }
    .p1-field > label, .p1-label { font-weight: 600; }
    .p1-input { box-sizing: border-box; width: 100%; min-height: 44px; padding: 0 10px; font: inherit;
      color: var(--text, inherit); background: var(--bg, #fff); border: 2px solid var(--muted, #888); border-radius: 8px; }
    .p1-mono { font-family: ui-monospace, Menlo, Consolas, monospace; letter-spacing: .05em; }
    .p1-swatch { width: 44px; height: 44px; border-radius: 50%; border: 3px solid rgba(0,0,0,.35); cursor: pointer;
      font: inherit; font-size: 1.3rem; font-weight: 700; padding: 0; }
    .p1-swatch[aria-pressed="true"] { border-color: var(--text, #000); box-shadow: 0 0 0 2px var(--bg, #fff) inset; }
    .p1-msg { margin: 8px 0; padding: 8px 10px; border-left: 4px solid currentColor; }
    .p1-msg.error { color: var(--danger, #b91c1c); }
    .p1-sched { overflow-x: auto; border: 2px solid rgba(128,128,128,.35); border-radius: var(--radius, 12px); }
    .p1-grid { display: grid; grid-template-columns: 52px repeat(6, minmax(78px, 1fr)); min-width: 560px; }
    .p1-colhead { text-align: center; font-weight: 700; padding: 6px 0; border-bottom: 2px solid rgba(128,128,128,.35); }
    .p1-axis, .p1-col { position: relative; }
    .p1-col { border-left: 1px solid rgba(128,128,128,.3); }
    .p1-hour { position: absolute; left: 0; right: 0; border-top: 1px solid rgba(128,128,128,.25); }
    .p1-axis span { position: absolute; right: 6px; font-size: .75rem; transform: translateY(-50%); background: var(--bg, transparent); }
    .p1-block { position: absolute; box-sizing: border-box; min-height: 44px; padding: 2px 4px; overflow: hidden; cursor: pointer;
      font: inherit; font-size: .8rem; text-align: left; line-height: 1.2;
      border: 2px solid rgba(0,0,0,.45); border-radius: 6px; }
    .p1-block.overlap { outline: 3px dashed #000; outline-offset: -4px; }
    .p1-block[aria-pressed="true"] { box-shadow: 0 0 0 3px var(--text, #000); }
    .p1-block strong { display: block; }
    .p1-pass { font-size: 1.15rem; }
  `;
  document.head.append(style);
}
