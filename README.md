# Klasboek

A lesson-planning app for South African teachers. Upload your ATPs and timetable, drag topics into your week, and generate lesson plans, worksheets with memos, and slide decks. Includes a moderation tool for marksheets and teacher files. Works offline once it has been opened once.

## What it does

- **Subjects & ATPs**: upload a DBE ATP (PDF, Word or Excel). It is read on the device and shown for checking before saving. Complicated tables can be re-read with AI.
- **Timetable**: import from Excel/Word, read a photo with AI, or fill the grid by hand. Supports one-week timetables and two-week cycles (Week A / Week B), including Day 1–10 layouts. The cycle can restart every term or carry on across terms, and a tap on the planner's Week badge swaps A and B if the school is out of step.
- **School calendar** (its own page): the school year by month or as a list, with tests, holidays, events and how many lessons each day. Upload the year planner and test or exam timetables there (PDF, Word, Excel, or a photo read by AI); dates are shown for checking first. *Change this day* (half day, lost periods, no school, a different timetable day) moves lessons on the planner automatically. Old `#planner/month` links open the calendar.
- **Microsoft account and sync** (Settings): sign in with a personal or work/school Microsoft account and every device stays the same. A copy of your data lives in your own OneDrive (Apps › Klasboek, a folder only Klasboek can see); changes upload a few seconds after you make them and other devices pick them up when they open or come back into view. If two devices changed things at the same time you choose which to keep. The Claude API key and sign-in tokens never leave the device. Needs a one-time app registration in Microsoft Entra (Settings shows the steps); put the Application (client) ID in `js/config.js` so devices don't need to type it.
- **Google Calendar and Outlook** (School calendar → *Google / Outlook*): download *Klasboek.ics* (tests, exams, holidays, meetings, deadlines, diary entries, and optionally your lessons at their period times) and import it into Google Calendar or Outlook; or upload a .ics (or Google's export .zip) to bring their events in, checked first, with repeating events expanded and duplicates skipped on re-import. File-based, so no sign-in is needed; a live two-way link would need Klasboek registered with Google and Microsoft.
- **Diary**: a page per day with that day's lessons (write how each one went), what's on the calendar, and your own entries: notes, to-dos, meetings, duties, parent contact, learner notes, deadlines, reflections. Tick *Also put it on the calendar* (on by default for meetings, duties and deadlines) and the entry shows on the calendar and the planner; editing or deleting it updates the calendar too. Unfinished to-dos carry over to later days. Search all entries, and download a week of the diary as a Word file.
- **Planner**: week view with days down the side and periods across the top (switch with the corner button or in Settings), with a picker for any week of any term. **Tap a day's name** to say what's different: no school, half day, lose some periods, a test or deadline, a note, or a different timetable day. *Tell the planner* takes plain sentences (“Monday Spring School, Wednesday and Thursday prize giving, Friday periods 5–7 assembly”), shows what it understood, adds the events and adjusts the plan. Under *More*: timetable changes and period swaps (a week that starts on a different day, a day that follows another day's timetable), upload a term plan, upload the year planner, download the week plan (.docx).
- **Keeping the plan in order**: every calendar event has an effect on teaching: normal lessons, no lessons all day, or some periods lost. When teaching time is lost, lessons planned in it move to the same class's next free period and the following lessons shift along; when it comes back, they move back. This happens automatically with an Undo button (Settings can ask first instead). Lessons that no longer fit before the end of term wait under *Needs a period*. Drag ATP topics onto periods (mouse, touch or pen), or tap a topic then tap a period. *Auto-plan week* fills your timetable from that week's ATP topics, per class.
- **Topic and today's part**: open a lesson to choose its ATP topic from a dropdown and the part of the topic it covers (from the ATP's weekly content, the Siyavula chapter's sections, or your own words). The part shows on the lesson on the planner; auto-plan and dragging fill the parts in order across the week's lessons.
- **Siyavula textbooks**: lessons in Mathematics (Gr 7–12), Mathematical Literacy (Gr 10), Physical Sciences (Gr 10–12), Life Sciences (Gr 10) and Natural Sciences (Gr 7–9) are matched to the Siyavula open textbook chapter, with a link. The chapter and its sections guide the AI (sequence, terminology, notation) and are listed as a resource in template lesson plans. Change the chapter per lesson if the match is off.
- **Grades and colours**: classes are matched to subjects by grade, so Maths 10B and Maths 11A become separate subjects with their own colours, and lessons always show the grade. *More → Check grades and colours* (and a banner when needed) finds classes filed under the wrong grade, subjects sharing a colour, and lessons in another class's period, and fixes the first two.
- **Already done**: mark an ATP topic *Done already* (e.g. Grade 11 control test revision covered earlier) and its planned lessons come off the plan while that class's next lessons move up; auto-plan skips done topics and carries on with the next ones. A single lesson can be marked *Already done* from the lesson, and the round tick on a lesson marks it as taught. Everything can be undone.
- **Create**: make tests or exams (sections, QUESTION 1 / 1.1 numbering, section totals, memo, cognitive-level analysis grid against targets you set, optional cover page), worksheets, notes, slides, rubrics, and flashcards (cut-out cards, glossary or a word search with answer key). Start from an ATP topic, your own notes or an uploaded file, or just a title; Claude writes it, or start from an offline template. Design it next to a live A4 preview: themes (Classic, Modern, Bright, Ink saver), large text, pictures, tables, highlight boxes, writing lines and page breaks; move, copy and delete blocks; "Ask AI to change it" with undo. Export to Word, PowerPoint or print/PDF. A lesson's worksheet or slides can be opened in the designer too.
- **Lesson view**: tap a lesson to open it with tabs for the *Lesson plan*, learner *Notes* (summarised notes to download, print or share), *Activity & memo* and *Slides*. Each shows the finished document, with an Edit switch. Activities and notes share straight to WhatsApp, email or Drive through the device's share sheet (Word files), or go out as a plain-text message; the memo shares separately.
- **Hidden AI check**: learner copies of activities (and Create worksheets/tests) can carry an invisible instruction (white 1pt text, hidden from screen readers in HTML) asking AI tools to use a chosen word, e.g. "banana", six times. The memo reminds you of the word; *Check a learner's answers* counts it in pasted or uploaded answers. It is a clue, not proof: learners may retype questions, some AI tools ignore hidden text, and plain-text messages carry no check. Defaults are in Settings.
- **Lessons**: one click builds a lesson plan, slides and worksheet + memo, either written by Claude (online) or as a structured template from the ATP (offline). Everything is editable, then exports to Word (.docx), PowerPoint (.pptx) or print/PDF, with your school name, logo and colour.
- **Moderation notices**: upload the notice or circular (PDF, Word or photo) and the due date, level, subject and list of what to hand in are filled in. Tick items off, add notes, link the marksheet moderation, and get reminders on the planner (2 weeks / 1 week / 3 days / 1 day before) plus a warning banner in the last week. *Add to my phone calendar* downloads an .ics file with real alarms for the tablet's calendar.
- **Marksheet moderation**: upload a marksheet, pick the name and mark columns, and it selects a sample spread across the 7 CAPS levels, always including the highest, lowest and pass/fail borderline learners. Enter moderator marks to see variance against your tolerance, complete the script and teacher-file checklists, and export a moderation report.
- **Materials**: a library of your own files, attachable to lessons.
- **Backup**: everything lives in the browser on that device. Download a backup from Settings regularly.

## Put it online (GitHub Pages)

1. Create a new GitHub repository (e.g. `klasboek`) and upload everything in this folder (keep the folder structure, including `.nojekyll`).
2. In the repo: **Settings → Pages → Source: Deploy from a branch → main / root**.
3. Open `https://<your-username>.github.io/Klasboek/ (the address matches the repository name, capitals included)` and install it (the **Get the app** button and Settings → *Install on your devices* show these steps):
   - **PC (Windows/Mac)**: Chrome or Edge → install icon in the address bar, or menu → *Install Klasboek*. It gets its own window and Start menu shortcut.
   - **Android**: Chrome → ⋮ → *Install app* (or *Add to Home screen*).
   - **Amazon Fire tablet**: Silk browser → menu → *Add to Home screen*. Open it once online so it downloads for offline use.
   - **iPad/iPhone**: Safari → Share → *Add to Home Screen*.
   Each device keeps its own data; move work between devices with Settings → Backup.

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

- Scanned (image-only) PDFs can't be read offline; use "Read with AI" or a Word/Excel version.
- Template lessons are a structured starting point; AI-written lessons should still be checked before class.

## Project layout

```
index.html, styles.css, sw.js, manifest.webmanifest
js/app.js              navigation and start-up
js/state.js, db.js     data and local storage
js/importers.js        reading ATPs, timetables, marksheets, year planners, exam timetables
js/events.js           school calendar helpers
js/ttday.js            which timetable day a date follows, period swaps
js/adjust.js           moving lessons when teaching time is lost or regained
js/tell.js             reading “Tell the planner” sentences
js/generate.js         lesson content (template + AI)
js/ai.js               all Claude API calls
js/create/             Create: model.js (materials, numbering, templates), render.js (themes, preview, print), export.js (Word, PowerPoint)
js/exporters.js        Word, PowerPoint, print
js/moderation-*.js     sampling, stats, report
js/views/              one file per screen
vendor/                pdf.js, mammoth, SheetJS, docx, PptxGenJS (open-source, bundled for offline use)
fonts/                 Atkinson Hyperlegible, Bricolage Grotesque (SIL Open Font License)
```
