# Klasboek

A lesson-planning app for South African teachers. Upload your ATPs and timetable, drag topics into your week, and generate lesson plans, worksheets with memos, and slide decks. Includes a moderation tool for marksheets and teacher files. Works offline once it has been opened once.

## What it does

- **Subjects & ATPs**: upload a DBE ATP (PDF, Word or Excel). It is read on the device and shown for checking before saving. Complicated tables can be re-read with AI.
- **Timetable**: import from Excel/Word, read a photo with AI, or fill the grid by hand. Supports one-week timetables and two-week cycles (Week A / Week B), including Day 1–10 layouts. The cycle can restart every term or carry on across terms, and a tap on the planner's Week badge swaps A and B if the school is out of step.
- **Planner**: week view of your periods. Drag ATP topics onto periods (mouse, touch or pen), or tap a topic then tap a period. *Auto-plan week* fills your timetable from that week's ATP topics, per class.
- **Lessons**: one click builds a lesson plan, slides and worksheet + memo, either written by Claude (online) or as a structured template from the ATP (offline). Everything is editable, then exports to Word (.docx), PowerPoint (.pptx) or print/PDF, with your school name, logo and colour.
- **Moderation**: upload a marksheet, pick the name and mark columns, and it selects a sample spread across the 7 CAPS levels, always including the highest, lowest and pass/fail borderline learners. Enter moderator marks to see variance against your tolerance, complete the script and teacher-file checklists, and export a moderation report.
- **Materials**: a library of your own files, attachable to lessons.
- **Backup**: everything lives in the browser on that device. Download a backup from Settings regularly.

## Put it online (GitHub Pages)

1. Create a new GitHub repository (e.g. `klasboek`) and upload everything in this folder (keep the folder structure, including `.nojekyll`).
2. In the repo: **Settings → Pages → Source: Deploy from a branch → main / root**.
3. Open `https://<your-username>.github.io/klasboek/`. In Chrome/Edge use **Install app**; on iPhone/iPad use Share → Add to Home Screen.

It must be served over https (or `localhost`) for offline mode to work. Opening `index.html` straight from disk won't work.

To test on your own computer: `python3 -m http.server` in this folder, then open http://localhost:8000.

## Updating

After changing any file, edit `VERSION` at the top of `sw.js` (e.g. `klasboek-v2`). Otherwise installed copies keep using the cached old version. If you add new files, add them to the `FILES` list in `sw.js`.

## AI (Claude)

Settings → paste a Claude API key from console.anthropic.com. Usage is billed to that key. The key is stored only in the browser and is never put in backups. AI is used for: writing lessons, re-reading ATPs, and reading timetable photos. Everything else works without it.

## Before selling it to other teachers

The app is built so these can be added without a rewrite:

- **AI through your own server.** Right now each teacher would need their own API key, and a key in the browser is fine for personal use but not for a paid product. All AI calls are in `js/ai.js`; point them at a small backend (e.g. a Cloudflare Worker or Supabase function) that holds your key, checks the user's subscription and limits usage.
- **Accounts and sync.** Storage is in `js/db.js` (IndexedDB). Add a sync layer there (e.g. Supabase) so teachers can use phone and laptop and don't lose work if a browser is cleared.
- **POPIA.** Marksheets contain learner names. Today they never leave the device. If you add cloud sync, you will need a privacy notice, consent and secure storage.
- **Real ATPs.** The reader was tested on ATP-style PDFs, Word and Excel files. Test it with the actual DBE ATPs for each subject you plan to support; layouts differ between subjects and years.

## Known limits

- Day cycles that skip public holidays (where Day 4 moves to the next school day) aren't supported; the cycle follows calendar weeks.
- Scanned (image-only) PDFs can't be read offline; use "Read with AI" or a Word/Excel version.
- Template lessons are a structured starting point; AI-written lessons should still be checked before class.

## Project layout

```
index.html, styles.css, sw.js, manifest.webmanifest
js/app.js              navigation and start-up
js/state.js, db.js     data and local storage
js/importers.js        reading ATPs, timetables, marksheets
js/generate.js         lesson content (template + AI)
js/ai.js               all Claude API calls
js/exporters.js        Word, PowerPoint, print
js/moderation-*.js     sampling, stats, report
js/views/              one file per screen
vendor/                pdf.js, mammoth, SheetJS, docx, PptxGenJS (open-source, bundled for offline use)
fonts/                 Atkinson Hyperlegible, Bricolage Grotesque (SIL Open Font License)
```
