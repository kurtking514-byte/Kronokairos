# Kronokairos

**Never miss an online class.** Kronokairos is a free class-schedule app for students with online classes. It keeps each class's Zoom link and passcode in one place, rings before class starts, and gets you into the meeting with one tap.

**Open it:** https://kurtking514-byte.github.io/Kronokairos/

It runs in any modern browser on a phone or computer. There's no sign-up and no account, and your schedule stays on your device.

---

## What it does

| Page | What you get |
|---|---|
| **Today** | Today's classes in order, with a live countdown to the next one and a big **Join** button. After your last class it shows what's next ("Next: Math · tomorrow at 7:30 AM"). |
| **Schedule** | The whole week at a glance. Add a class by hand, or **Fill in with AI** from screenshots of your schedule. Overlapping classes are flagged. |
| **Links** | Every join link and passcode, ready to tap or copy. |
| **Settings** | Alarm timing, snooze, keep-screen-on, animations, term length, **Add to my calendar**, **Backup**, sharing, and reset. |

### Alarms
- Tap **Start alarms** on Today. A popup rings before class (at class time, or 5 or 10 minutes early) with **Join now**, **Snooze** and **Copy passcode**.
- Alarms stay on after a reload or a later visit. Browsers block sound until you touch the page, so the first tap anywhere turns the sound back on.
- **Alarms only ring while the page is open.** For reminders when it's closed, use **Add to my calendar**.

### Add to my calendar
- Downloads a calendar file (`.ics`) with your classes as weekly events, two reminders each, and the join link. Times are pinned to your time zone.
- Open the file and add it **once**. It's a one-time copy: your phone calendar won't change when you edit a class. Kronokairos tells you when the calendar is out of date and which deleted classes to remove from it.
- **iPhone:** tap *Add All*. **Samsung:** Samsung Calendar opens it. **Other Android:** if nothing opens it, import it at calendar.google.com on a computer, and set a default notification in Google Calendar, which may drop the file's reminders.

### Getting your classes in
- **Fill in with AI:** copy the ready-made prompt, send it with screenshots of your schedule to *your own* AI app (ChatGPT, Gemini, etc.), then paste the reply back. You review every class before it's saved.
- **Paste invite:** paste a Zoom invite and the link, meeting ID and passcode are filled in for you.
- **Share link:** send your schedule to a classmate as a link. They can replace their schedule with it or add it to their own.

### Joining Zoom
Nothing can join a meeting for you; phones only open Zoom when you tap. Kronokairos makes it one tap: **Join** on Today, **Join now** in the alarm popup, or the link in your calendar event.

---

## Install it (recommended)

It works in the browser, but installing it is better: it opens like an app, works offline, and the browser is less likely to clear your schedule.

- **iPhone / iPad (Safari):** Share → *Add to Home Screen*.
- **Android (Chrome):** tap **Install app** when Kronokairos offers it, or ⋮ menu → *Install app*.
- **Computer (Chrome / Edge):** the install icon in the address bar.

Installing is safe. The app can't see, change or take anything else on your device.

---

## Privacy

- Your schedule is saved **only in this browser on this device**. There is no server, no account and no tracking. The app makes no requests to outside sites; even the fonts are bundled.
- Data leaves your device only when *you* send it: a **share link** (it includes meeting links and passcodes, so send it only in private chats) or screenshots you give **your own AI app**.
- **Back up your schedule.** Browsers can clear saved sites (Safari does it after about 7 days of not using a site). Go to **Settings → Backup → Save a backup** to download a file you can restore later, even on a new phone. Kronokairos reminds you if you haven't saved one in 30 days.

---

## For developers

Plain HTML, CSS and JavaScript (ES modules). There's no build step, no framework and no dependencies.

```
index.html            app shell
css/styles.css        all styles (game-menu theme, layouts, page transitions)
js/app.js             screen switching and transitions
js/model.js           pure schedule logic (times, next class, term end)
js/storage.js         saving and validating data (localStorage)
js/alarms.js          when to ring; js/ui/alarmPopup.js shows and sounds it
js/calendar.js        .ics export with time zone, and the "out of date" check
js/backup.js          persistent storage, backup and restore
js/share.js           share-link encoding
js/aiImport.js        AI prompt and reply parsing; js/invite.js reads Zoom invites
js/ui/*.js            one file per screen, plus the menu, clock and dialogs
sw.js                 service worker (offline, notifications, updates)
tools/make_logo.py    redraws the logo and app icons (needs Pillow)
tests/                plain Node tests
```

**Run it locally.** In this folder, run:

```bash
python -m http.server 8000
```

Then open http://localhost:8000.

**Run the tests** (Node.js LTS):

```bash
node tests/run.js
```

**Ship an update:**
1. Change the files.
2. Bump `CACHE_VERSION` in `sw.js`. If you add a file, also add it to `APP_FILES` there.
3. Push to `main`. GitHub Pages redeploys in a minute or two.

Open copies of the app then show a "Kronokairos was updated. Refresh" bar.

**Publish your own copy:** fork the repository. In **Settings → Pages**, choose **Deploy from a branch**, then `main` and `/(root)`. The site will be at `https://<username>.github.io/<repository>/`.

### Credits
- The look is an original theme inspired by game menus; it uses no game art, logos or fonts.
- Font: [Barlow Condensed](https://fonts.google.com/specimen/Barlow+Condensed), SIL Open Font License (`fonts/OFL.txt`).
