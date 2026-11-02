// Small helpers shared by the Phase 1 screens (today, schedule, links, subjectForm).
// All styles live in css/styles.css.

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DAY_LONG = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---- moving between screens without touching app.js: click the real buttons ----
let lastTab = "menu";

export function currentScreen() {
  return lastTab;
}
export function goTo(name) {
  if (name === "menu") return document.getElementById("menu-btn")?.click();
  document.querySelector(`.tab[data-screen="${name}"]`)?.click();
}
// Screens ask app.js to switch with an event, so they never import app.js. `from` is the
// pressed button (or its click event): the page-change circles grow out of it.
export function openScreen(name, from) {
  const origin = from instanceof Element ? from : from?.currentTarget ?? null;
  document.dispatchEvent(new CustomEvent("kk:go", { detail: { name, from: origin } }));
}
export function openAddScreen(from) {
  openScreen("add", from);
}
export function openAiScreen(from) {
  openScreen("ai", from);
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

// Styles now live in css/styles.css. Screens still call this once: it remembers the last tab tapped.
export function ensureStyles() {
  if (!ensureStyles.listening) {
    ensureStyles.listening = true;
    document.addEventListener("click", (e) => {
      const tab = e.target?.closest?.(".tab");
      if (tab?.dataset.screen) lastTab = tab.dataset.screen;
      if (e.target?.closest?.("#menu-btn")) lastTab = "menu";
    });
  }
}
