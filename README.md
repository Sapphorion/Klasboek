# Teacher’s Desk

A lesson-planning app for South African teachers. Upload your ATPs and timetable, drag topics into your week, and generate lesson plans, worksheets with memos, and slide decks. Includes a moderation tool for marksheets and teacher files. Works offline once it has been opened once.

## What it does

- **Exam and invigilation timetables** (School calendar › Upload a test or exam timetable, or dropped on the Timetable page): read by AI from the PDF or photo, including start times, durations, venues, invigilators' initials and daily relief duty. Exams for your subjects are ticked; type your initials once and your invigilation and relief duties are added as *Duty* events (with times), optionally moving your lessons out of the periods you're invigilating.
- **Lecturer edition**: on first open choose *School teacher* or *University lecturer* (or share the link `…/Klasboek/?for=lecturer`). The lecturer edition shows Planner, Academic calendar, Diary, Create, Modules, Timetable, **Attendance** and Settings, uses university words on screen (modules, lectures, students, year of study, course outline) and asks the AI for university-level material. Switch any time in Settings › You and your school.
- **Attendance** (lecturer edition): Roll Call inside Teacher’s Desk, in `attendance/`: student card barcode scanning, a rotating lecture QR for students without cards, registers from Excel/Word/PDF and records with check-in times. Its registers are included in backups and in your account.
- **Sign in with Google** (Settings › Your account, or the welcome screen): your Teacher’s Desk is saved to your Google account (Firebase Firestore) and is the same on every device you sign in on. Signing in on a device that holds someone else's Teacher’s Desk asks before replacing it; signing out can also remove it from a shared computer. The Claude API key is never uploaded.

### Switching on Google sign-in (once)

1. [console.firebase.google.com](https://console.firebase.google.com) › Create a project (e.g. Teacher’s Desk).
2. Build › Authentication › Get started › Google › Enable.
3. Authentication › Settings › Authorised domains › add `sapphorion.github.io`.
4. Build › Firestore Database › Create database (production mode, a nearby location).
5. Firestore › Rules:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
6. Project settings › Your apps › Web app › register, and copy the `firebaseConfig` into `FIREBASE_CONFIG` in `js/config.js` (or paste it in Settings › Your account on a device to try it first).

- **School formats** (Settings, Planner → More, or *School format* in a lesson): upload the school's own Word (.docx) or Excel (.xlsx) planning form once. Weekly planners laid out as a grid of days and periods (either way round, breaks skipped; days can be weekdays or Day 1–10 cycle numbers, and with a WK1 form for Days 1–5 and a WK2 form for Days 6–10 the right one is picked for the week on screen; blanks like “TERM: ____ DATE: ____ TO ____” are filled with the term and the week's dates, signature lines left empty) get each lesson in its day-and-period box, with a choice of what goes in the box (class, topic, today's part, activities, homework…); the planner's **Weekly planner** button shows the school's form filled in live from the week on screen (it updates as you plan; change week, class or form there) with Download and Share. Teacher’s Desk finds the blanks next to labels (Topic, Date, Objectives, Resources, Introduction, Assessment, HOD signature…, English and Afrikaans), lines like “Topic: ______”, `{{tags}}`, and planning tables with a row per lesson or per weekday, and guesses what goes in each (change any). Download a lesson, a week or any dates for one class or all classes, filled in on the school's form: lesson-plan forms get one page per lesson, planning tables one row per lesson or day. Filling happens on the device (no AI needed).
- **Layout and colours** (Settings, per device): colours Chalkboard (dark green menu), Light (white menu, soft colours) or Night (dark, low glare; documents stay on white paper), and the menu Automatic (names on big screens, icons on tablets, bottom bar on small screens), down the side with names, icons only, or across the top. A chosen menu applies on any screen 600 points wide or more; phones keep the bottom bar. Night-mode overrides for fixed colours in `styles.css` are generated between the `night:auto` markers by `python3 tools/nightgen.py` (run it after changing colours).
- **Today** (opens first; change it in Settings → Planner): today's lessons with a tick to mark them taught and which still need preparing, this week's tests and events, your diary to-dos, moderation deadlines, lab stock warnings, and a bar per class showing how far it is through this term's ATP.
- **Term progress** (Today, or Planner → More): for each class, every ATP topic of the term marked taught, busy, planned, not planned, done already or **behind** (its ATP week has passed and it isn't taught). Print the report, or **print a whole term's lessons** for one class or all of them (lesson plans, worksheets with memos and/or notes, with a contents page) or save them as one PDF.
- **Lab stock**: tabs for Physics, Chemistry (and Biology or General when used); each item is filed under one, guessed from its category and name and changeable when editing. Excel gets a sheet per section plus All stock, and the stock-take sheet prints the open section (or each section on its own pages). Chemicals, glassware, equipment and consumables with quantity on hand and unit, where it's kept, date bought, expiry, opened date, supplier, cost, hazard, formula and a reorder level. − and + buttons record use and new stock (with a history), *New batch* copies an item with a new expiry. Filters for expired or expiring within 60 days, low or out, and hazardous; warnings also show on Today. Import an Excel/CSV list (columns are recognised by name), download to Excel (with a *Needs attention* sheet) or print a stock-take sheet with a blank *Counted* column. A starter list of common Science items is offered on an empty list.
- **Next school year** (Settings → School years, or the year picker on the planner): start the new year with its term dates, choose which subjects carry on (and their new grade), bring their ATPs and keep the timetable. Past years stay intact and can be opened again from the picker; lessons, diary and calendar keep their dates.
- **Subjects & ATPs**: upload a DBE ATP (PDF, Word or Excel). It is read on the device and shown for checking before saving. Complicated tables can be re-read with AI.
- **Timetable**: import from Excel/Word, read a photo with AI, or fill the grid by hand. Supports one-week timetables and two-week cycles (Week A / Week B), including Day 1–10 layouts. The cycle can restart every term or carry on across terms, and a tap on the planner's Week badge swaps A and B if the school is out of step.
- **School calendar** (its own page): the school year by month or as a list, with tests, holidays, events and how many lessons each day. Upload the year planner and test or exam timetables there (PDF, Word, Excel, or a photo read by AI); dates are shown for checking first. *Change this day* (half day, lost periods, no school, a different timetable day) moves lessons on the planner automatically. Old `#planner/month` links open the calendar.
- **Sync between devices** (Settings): connect a private GitHub repository with a fine-grained access token (Contents: read and write on that one repository; no app registration needed). Changes upload a few seconds after you make them and other devices pick them up when they open or come back into view; if two devices changed things at the same time you choose which to keep. Attached files are uploaded once each, and every sync is a commit, so earlier versions can be recovered. The token and the Claude API key never leave the device. A school/work Microsoft account can sync through OneDrive instead, once Teacher’s Desk is registered in its Microsoft Entra (put the Application (client) ID in `js/config.js`).
- **Google Calendar and Outlook** (School calendar → *Google / Outlook*): download *Teacher’s Desk.ics* (tests, exams, holidays, meetings, deadlines, diary entries, and optionally your lessons at their period times) and import it into Google Calendar or Outlook; or upload a .ics (or Google's export .zip) to bring their events in, checked first, with repeating events expanded and duplicates skipped on re-import. File-based, so no sign-in is needed; a live two-way link would need Teacher’s Desk registered with Google and Microsoft.
- **Diary**: a page per day with that day's lessons (write how each one went), what's on the calendar, and your own entries: notes, to-dos, meetings, duties, parent contact, learner notes, deadlines, reflections. Tick *Also put it on the calendar* (on by default for meetings, duties and deadlines) and the entry shows on the calendar and the planner; editing or deleting it updates the calendar too. Unfinished to-dos carry over to later days. Search all entries, and download a week of the diary as a Word file.
- **Planner**: week view with days down the side and periods across the top (switch with the corner button or in Settings), with a picker for any week of any term. **Tap a day's name** to say what's different: no school, half day, lose some periods, a test or deadline, a note, or a different timetable day. *Tell the planner* takes plain sentences (“Monday Spring School, Wednesday and Thursday prize giving, Friday periods 5–7 assembly”), shows what it understood, adds the events and adjusts the plan. Under *More*: timetable changes and period swaps (a week that starts on a different day, a day that follows another day's timetable), upload a term plan, upload the year planner, download the week plan (.docx).
- **Keeping the plan in order**: every calendar event has an effect on teaching: normal lessons, no lessons all day, or some periods lost. When teaching time is lost, lessons planned in it move to the same class's next free period and the following lessons shift along; when it comes back, they move back. This happens automatically with an Undo button (Settings can ask first instead). Lessons that no longer fit before the end of term wait under *Needs a period*. Drag ATP topics onto periods (mouse, touch or pen), or tap a topic then tap a period. *Auto-plan week* fills your timetable from that week's ATP topics, per class.
- **Topic and today's part**: open a lesson to choose its ATP topic from a dropdown and the part of the topic it covers (from the ATP's weekly content, the Siyavula chapter's sections, or your own words). The part shows on the lesson on the planner; auto-plan and dragging fill the parts in order across the week's lessons.
- **Siyavula textbooks**: lessons in Mathematics (Gr 7–12), Mathematical Literacy (Gr 10), Physical Sciences (Gr 10–12), Life Sciences (Gr 10) and Natural Sciences (Gr 7–9) are matched to the Siyavula open textbook chapter, with a link. The chapter and its sections guide the AI (sequence, terminology, notation) and are listed as a resource in template lesson plans. Change the chapter per lesson if the match is off.
- **Grades and colours**: classes are matched to subjects by grade, so Maths 10B and Maths 11A become separate subjects with their own colours, and lessons always show the grade. *More → Check grades and colours* (and a banner when needed) finds classes filed under the wrong grade, subjects sharing a colour, and lessons in another class's period, and fixes the first two.
- **Already done**: mark an ATP topic *Done already* (e.g. Grade 11 control test revision covered earlier) and its planned lessons come off the plan while that class's next lessons move up; auto-plan skips done topics and carries on with the next ones. A single lesson can be marked *Already done* from the lesson, and the round tick on a lesson marks it as taught. Everything can be undone.
- **Programme of Assessment** (Subjects): upload the PoA for each subject and grade (PDF, Word or Excel; a whole-grade PoA is fine). Teacher’s Desk reads every formal task (term, name, type, marks, time, weighting, when, content, cognitive levels, format) — tidy tables offline, anything with AI — for you to check and save. In Create, a test, exam or worksheet can start from a PoA task: marks, time, title and topics are filled in, the cognitive level targets follow the PoA, and the AI is told the task's format and requirements.
- **Taxonomy levels sheet** (tests and exams): every subject and grade uses the school's standard levels: Knowledge 25%, Routine procedures 45%, Complex procedures 20%, Problem solving 10% (a PoA task can set its own desired %). The memo's analysis (print, PDF and Word) is laid out exactly like the school's sheet, and *Taxonomy sheet* downloads it as Excel, filled into the school's own template (vendor/bloom-template.xlsx) with live formulas: one row per question with its marks under its level, totals, actual % and desired %.
- **Create**: describe what you need in a sentence (“Grade 10 Physical Sciences test on electric circuits, 40 marks, 45 minutes, with a circuit diagram”) and it's built, or tap Worksheet / Test / Notes / Slides next to any lesson from your planner. Before writing, Claude asks **a few questions first** about that request (the mix of question types, difficulty, contexts, diagrams, how detailed the memo is…), each with answers to tick, the recommended ones already ticked, an *Other* box and *Anything else?*; the ticked answers go to the AI with the request. *Skip the questions* makes it straight away, and Settings › AI writing switches the questions off. For tests and worksheets, tick as many ATP topics (or a whole term) and Siyavula textbook chapters as it should cover; the AI spreads the marks across them. Tests and exams are written one question at a time (each one checked and retried), so a long paper no longer fails as a whole; if one question can't be written you get a marked gap with *Write this question again*, and any question can be rewritten that way. Questions, sections and paragraphs are always open to type in; tapping something on the A4 preview jumps to it. Paper style, cover and test details sit under *Page setup*, next to *Make a version* and *Check learners' answers*, to keep the screen calm. Other blocks: tap to open, drag ⋮⋮ to reorder, + to add in between, a toolbar on the page to move, copy or delete, and per-question AI (easier, harder, rewrite, add a diagram, real-life context). School layout with details table, name/class lines, instructions, marks in brackets, section totals and page numbers. Memo with ✓ mark split and a cognitive-level grid; a live check flags marks that don't add up, missing memos, ✓ counts that don't match and levels off target. Graph blocks draw functions and points (y = 2x + 1, f(x) = x² − 4, y = 3sin x in degrees…); diagram blocks are drawn by AI as clean line drawings (or paste your own SVG); pictures from files or the camera. *Make a version*: easier, harder, Version B (same skills, different numbers), Afrikaans/English, large print. Export to Word (graphs and diagrams included), PowerPoint or PDF.
- **Cover sheets** (Create): upload the school's own cover page (PDF, photo or picture; save Word as PDF first), drag the details (title, subject, grade, marks, time, date, teacher, term…) onto its blank lines, and tests start with it, filled in, in print/PDF and Word. Choose per test: none, the Teacher’s Desk cover, or any uploaded sheet. An *Instructions* box can go on the cover too (choose its size, width and whether it has a heading): it shows the test's own instructions, or the cover's standard ones when the test has none, and they then aren't repeated on page 2.
- **Lesson view**: tap a lesson to open it with tabs for the *Lesson plan*, learner *Notes* (summarised notes to download, print or share), *Activity & memo* and *Slides*. Each shows the finished document, with an Edit switch. Activities and notes share straight to WhatsApp, email or Drive through the device's share sheet (Word files), or go out as a plain-text message; the memo shares separately.
- **Moderation mark sheets** (Moderation › Moderation mark sheets): upload a mark sheet or class register (Excel, CSV, Word or PDF), or paste names, and get a form with a **red** column for your marks (filled in from the file if it has them), then **green** (school/HOD), **orange** (cluster/district) and optional **purple** (provincial) moderation. Type straight in (Enter moves down, AB for absent); the *Final* column shows the last moderated mark, rows turn pink when a moderation differs from red by more than the set %, and a moderation sample can be picked and shown on its own. Moderator names, dates and comments per colour. Print/PDF and Word in colour, or Excel.
- **Hidden AI check**: learner copies of activities (and Create worksheets/tests) can carry an invisible instruction (white 1pt text, hidden from screen readers in HTML) asking AI tools to use a chosen word, e.g. "banana", six times. The memo reminds you of the word; *Check a learner's answers* counts it in pasted or uploaded answers. It is a clue, not proof: learners may retype questions, some AI tools ignore hidden text, and plain-text messages carry no check. Defaults are in Settings.
- **Lessons**: one click builds a lesson plan, slides and worksheet + memo, either written by Claude (online) or as a structured template from the ATP (offline). Everything is editable, then exports to Word (.docx), PowerPoint (.pptx) or print/PDF, with your school name, logo and colour.
- **Moderation notices**: upload the notice or circular (PDF, Word or photo) and the due date, level, subject and list of what to hand in are filled in. Tick items off, add notes, link the marksheet moderation, and get reminders on the planner (2 weeks / 1 week / 3 days / 1 day before) plus a warning banner in the last week. *Add to my phone calendar* downloads an .ics file with real alarms for the tablet's calendar.
- **Marksheet moderation**: upload a marksheet, pick the name and mark columns, and it selects a sample spread across the 7 CAPS levels, always including the highest, lowest and pass/fail borderline learners. Enter moderator marks to see variance against your tolerance, complete the script and teacher-file checklists, and export a moderation report.
- **Materials**: a library of your own files, attachable to lessons.
- **Backup**: everything lives in the browser on that device. Download a backup from Settings regularly.

## Put it online (GitHub Pages)

1. Create a new GitHub repository (e.g. `klasboek`) and upload everything in this folder (keep the folder structure, including `.nojekyll`).
2. In the repo: **Settings → Pages → Source: Deploy from a branch → main / root**.
3. Open `https://<your-username>.github.io/Klasboek/` (the address matches the repository name, capitals included) and install it (the **Get the app** button and Settings → *Install on your devices* show these steps):
   - **PC (Windows/Mac)**: Chrome or Edge → install icon in the address bar, or menu → *Install Teacher’s Desk*. It gets its own window and Start menu shortcut.
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
js/years.js            school years: start a new year, switch between years
js/fbauth.js, signin.js Google sign-in and saving to your account
js/edition.js          school or lecturer edition: menu and wording
attendance/            Roll Call (attendance), its own small app inside Teacher’s Desk
js/views/              one file per screen (today, planner, calendar, diary, create, progress, stock, …)
vendor/                pdf.js, mammoth, SheetJS, docx, PptxGenJS (open-source, bundled for offline use)
fonts/                 Atkinson Hyperlegible, Bricolage Grotesque (SIL Open Font License)
```
