// PWA setup (Phase 7): registers the service worker and shows a small, dismissible
// "Install app" hint. Nothing here sends data anywhere.

const DISMISS_KEY = "kronokairos.installHint"; // separate from the schedule data

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
  if (isIPhoneOrIPad()) showHint("ios");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // Offline mode is a bonus. The app still works without it.
    });
  });
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
    return localStorage.getItem(DISMISS_KEY) === "dismissed";
  } catch {
    return false;
  }
}

function rememberDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, "dismissed");
  } catch {
    // Storage is blocked. The hint may show again next visit.
  }
}

function removeHint() {
  document.getElementById("pwa-hint")?.remove();
}

function showHint(kind) {
  if (document.getElementById("pwa-hint")) return;
  ensureStyles();
  const box = document.createElement("section");
  box.id = "pwa-hint";
  box.className = "pwa-hint";
  box.setAttribute("aria-label", "Install app");

  const text = document.createElement("p");
  text.textContent = kind === "ios"
    ? "Install Kronokairos: tap Share, then Add to Home Screen."
    : "Install Kronokairos on this device. It opens like an app and works offline.";
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

  box.append(text, row);
  // Sits above the screen area, so redrawing a screen never removes it.
  document.getElementById("screen")?.before(box);
}

function ensureStyles() {
  if (document.getElementById("pwa-hint-styles")) return;
  const style = document.createElement("style");
  style.id = "pwa-hint-styles";
  style.textContent = `
    .pwa-hint { width: calc(100% - var(--space, 16px) * 2); max-width: 868px; margin: 0 auto var(--space, 16px);
      padding: var(--space, 16px); background: var(--surface, transparent);
      border: 2px solid var(--primary, #2d48d6); border-radius: var(--radius, 12px); }
    .pwa-hint p { margin: 0 0 8px; }
    .pwa-row { display: flex; flex-wrap: wrap; gap: 8px; }
  `;
  document.head.append(style);
}
