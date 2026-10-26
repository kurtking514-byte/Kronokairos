// First-run welcome (Phase 8): a small dialog with three quick steps.
// Shown once, only when there are no classes, and never over a share-link import.

const SEEN_KEY = "kronokairos.welcome"; // separate from the schedule data
let shownThisVisit = false;

const STEPS = [
  ["Fill in with AI", "Send screenshots of your schedule to your own AI app, then paste its reply here. " +
    "The screenshots never come to this site."],
  ["Check your classes", "Look over each class card. Fix anything the AI misread, especially passcodes " +
    "and meeting IDs, then tap Looks good."],
  ["Add to calendar", "In Settings, tap Add to my calendar so your phone reminds you " +
    "even when this page is closed."],
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function wasSeen() {
  try {
    return localStorage.getItem(SEEN_KEY) === "seen";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "seen");
  } catch {
    // Storage is blocked. The welcome may show again next visit.
  }
}

function buildDialog() {
  const dialog = el("dialog", "welcome");
  dialog.setAttribute("aria-labelledby", "welcome-title");

  const title = el("h2", "", "Welcome to Kronokairos");
  title.id = "welcome-title";

  const steps = el("ol", "welcome-steps");
  for (const [name, text] of STEPS) {
    const item = el("li", "");
    item.append(el("strong", "", name + ". "), text);
    steps.append(item);
  }

  const start = el("button", "", "Fill in with AI");
  start.type = "button";
  start.addEventListener("click", () => {
    dialog.close();
    document.getElementById("ai-btn")?.click(); // same button as the header
  });
  const later = el("button", "secondary", "Not now");
  later.type = "button";
  later.addEventListener("click", () => dialog.close());
  const actions = el("div", "welcome-actions");
  actions.append(start, later);

  dialog.append(
    title,
    el("p", "", "Get to your online classes on time in three quick steps."),
    steps,
    el("p", "muted", "Your schedule is saved only on this device."),
    actions,
  );
  // Closing by any route (buttons or the Escape key) counts as "seen".
  dialog.addEventListener("close", () => {
    markSeen();
    dialog.remove();
  });
  return dialog;
}

export function maybeShowWelcome(state) {
  if (shownThisVisit || state.subjects.length > 0) return;
  if (location.hash.startsWith("#s=")) return; // a share link has its own import dialog
  if (document.querySelector("dialog[open]")) return;
  if (wasSeen()) return;

  const dialog = buildDialog();
  if (typeof dialog.showModal !== "function") return; // very old browser: skip the welcome
  document.body.append(dialog);
  dialog.showModal();
  shownThisVisit = true;
}
