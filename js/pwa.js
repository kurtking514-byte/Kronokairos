// PWA setup (Phase 7): registers the service worker and shows a small, dismissible
// "Install app" hint. Nothing here sends data anywhere.
// The hint says why installing helps and promises the app leaves the student's data alone.
// "Not now" hides it for two weeks, then it reminds again.

const DISMISS_KEY = "kronokairos.installHint"; // when "Not now" was tapped (ms); separate from the schedule data
const REMIND_AFTER_MS = 14 * 86400000;
const PROMPT_WAIT_MS = 4000; // how long to wait for the browser's own install offer

let installPrompt = null; // the browser's Android/Chrome install prompt, once it offers one

export function initPwa() {
  registerServiceWorker();
  if (isInstalled() || wasDismissed()) return;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // keep it for our own button
    installPrompt = event;
    showHint("android");
  });
  window.addEventListener("appinstalled", removeHint);
  if (isIPhoneOrIPad()) return showHint("ios");
  // Browsers without an install offer (Firefox, some Android browsers) get menu directions.
  setTimeout(() => { if (!installPrompt) showHint("menu"); }, PROMPT_WAIT_MS);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // A page that already had a service worker and gets a new one: an update has arrived.
  // (The very first install also changes the controller, but there is nothing to refresh then.)
  const hadOne = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadOne) showUpdated();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      // Phones keep the app open for days: look for an update whenever it comes back to the front.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
    }).catch(() => {
      // Offline mode is a bonus. The app still works without it.
    });
  });
}

// The page is still running the old version. Refreshing swaps in the new one; the schedule is kept.
function showUpdated() {
  if (document.getElementById("update-bar")) return;
  const bar = document.createElement("div");
  bar.id = "update-bar";
  bar.className = "update-bar";
  bar.setAttribute("role", "status");
  const text = document.createElement("p");
  text.textContent = "Kronokairos was updated. Refresh to get the new version. Your classes stay.";
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.textContent = "Refresh";
  refresh.addEventListener("click", () => location.reload());
  bar.append(text, refresh);
  document.body.append(bar);
}

function isInstalled() {
  return window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
}

function isIPhoneOrIPad() {
  const ua = navigator.userAgent || "";
  const iPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/.test(ua) || iPadOS;
}

function wasDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY)); // the old "dismissed" reads as NaN: remind again
    return Number.isFinite(at) && Date.now() - at < REMIND_AFTER_MS;
  } catch {
    return false;
  }
}

function rememberDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Storage is blocked. The hint may show again next visit.
  }
}

function removeHint() {
  document.getElementById("pwa-hint")?.remove();
}

const HOW = {
  ios: "Tap Share, then Add to Home Screen.",
  android: "",
  menu: "Open your browser's menu and pick Install app or Add to Home screen, if it has one.",
};

function showHint(kind) {
  const old = document.getElementById("pwa-hint");
  if (old && !(kind === "android" && old.dataset.kind !== "android")) return; // the real Install button wins
  old?.remove();
  const box = document.createElement("section");
  box.id = "pwa-hint";
  box.className = "pwa-hint";
  box.dataset.kind = kind;
  box.setAttribute("aria-label", "Install app");

  const title = document.createElement("p");
  title.className = "pwa-title";
  title.textContent = "Works better installed";
  const text = document.createElement("p");
  text.textContent = "Kronokairos opens like an app, works offline, and your schedule is less likely " +
    "to be cleared by the browser. " + HOW[kind];
  const promise = document.createElement("p");
  promise.className = "pwa-promise";
  promise.textContent = "Installing is safe. The app can't see, change or take anything else on your device, " +
    "and your schedule stays on it unless you share it yourself.";
  const row = document.createElement("div");
  row.className = "pwa-row";

  if (kind === "android") {
    const install = document.createElement("button");
    install.type = "button";
    install.textContent = "Install app";
    install.addEventListener("click", async () => {
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice.catch(() => {});
      installPrompt = null;
      removeHint();
    });
    row.append(install);
  }

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "secondary";
  dismiss.textContent = "Not now";
  dismiss.addEventListener("click", () => {
    rememberDismissed();
    removeHint();
  });
  row.append(dismiss);

  box.append(title, text, promise, row);
  // Sits above the screen area, so redrawing a screen never removes it.
  document.getElementById("screen")?.before(box);
}

