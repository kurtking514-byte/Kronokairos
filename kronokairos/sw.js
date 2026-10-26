// Service worker (Phase 7). Makes the app work offline after the first visit.
// To ship an update: change a file, then change CACHE_VERSION below. Old caches are deleted.
// Every path is relative, so this works in a GitHub Pages subfolder.

const CACHE_VERSION = "v4";
const CACHE = `kronokairos-${CACHE_VERSION}`;

// Every file the app needs. If you add a file to the project, add it here too.
const APP_FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/styles.css",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png",
  "js/app.js",
  "js/pwa.js",
  "js/model.js",
  "js/storage.js",
  "js/invite.js",
  "js/aiImport.js",
  "js/calendar.js",
  "js/share.js",
  "js/alarms.js",
  "js/ui/today.js",
  "js/ui/schedule.js",
  "js/ui/links.js",
  "js/ui/settings.js",
  "js/ui/subjectForm.js",
  "js/ui/reviewImport.js",
  "js/ui/shareImport.js",
  "js/ui/howItWorks.js",
  "js/ui/welcome.js",
  "js/ui/alarmPopup.js",
  "js/ui/shared.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

// One file at a time, so a single wrong name in the list does not stop the whole install.
async function precache() {
  const cache = await caches.open(CACHE);
  const failed = [];
  await Promise.all(APP_FILES.map(async (path) => {
    try {
      const response = await fetch(new Request(path, { cache: "reload" })); // skip the browser's own cache
      if (!response.ok) throw new Error(String(response.status));
      await cache.put(path, response);
    } catch {
      failed.push(path);
    }
  }));
  if (failed.length > 0) console.warn("Kronokairos: could not cache these files:", failed);
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n.startsWith("kronokairos-") && n !== CACHE).map((n) => caches.delete(n)),
      ))
      .then(() => self.clients.claim()),
  );
});

// Cache first. Only the app's own files (same site, inside this folder) are touched.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !request.url.startsWith(self.registration.scope)) return;
  event.respondWith(answer(request));
});

async function answer(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    return await fetch(request);
  } catch {
    // Offline and not cached. For a page visit, fall back to the app itself.
    if (request.mode === "navigate") {
      const shell = await caches.match("index.html");
      if (shell) return shell;
    }
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}
