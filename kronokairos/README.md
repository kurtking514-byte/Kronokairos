# Kronokairos

A free, private website that helps students join online classes on time.
Everything runs in the browser. Nothing is sent anywhere.

## Run it

1. Install Node.js (LTS) from nodejs.org (only needed for tests).
2. In this folder run `python -m http.server 8000`.
3. Open http://localhost:8000.

## Run the tests

```
node tests/run.js
```

Every test prints PASS or FAIL. Any `tests/*.test.js` file is picked up automatically.

## Folder layout

```
index.html            page shell (four tabs and an Add button)
css/styles.css        design tokens, layout, dark mode
js/app.js             tab routing, calls each screen's render()
js/model.js           data rules (done in Phase 0)
js/storage.js         localStorage, key kronokairos.v1 (done in Phase 0)
js/invite.js          paste-invite parser        (stub, Phase 2)
js/aiImport.js        AI prompt and reply parser (stub, Phase 3A)
js/calendar.js        .ics export                (stub, Phase 5)
js/share.js           share link                 (stub, Phase 6)
js/alarms.js          page alarms                (stub, Phase 4)
js/ui/*.js            screens (stubs until Phase 1)
js/ui/welcome.js      first-run welcome dialog (Phase 8)
js/ui/howItWorks.js   "How it works and limits" page (Phase 8)
tests/run.js          test runner (plain Node)
tests/model.test.js   tests for model.js and the module contract
```

`package.json` only contains `"type": "module"` so Node can run the tests. It is not a build step.

## First run and help

- **Welcome:** the first time the app opens with no classes saved, a short dialog shows three steps (Fill in with AI, check your classes, Add to calendar). It does not open on top of a share-link import. Once it is closed it is not shown again. That is remembered on the device under its own storage key, `kronokairos.welcome`, separate from the schedule data.
- **How it works and limits:** the link at the bottom of every screen opens a short page that explains the basics and lists what the site cannot do (Plan section 12). The same footer carries the line "Your schedule is saved only on this device."
