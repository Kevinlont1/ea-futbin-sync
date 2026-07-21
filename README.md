EA FC 26 → Futbin Objectives Sync

Syncs your EA FC 26 Ultimate Team objective progress to Futbin. The EA webapp is always leading — Futbin is updated to match exactly what you've completed in-game.

How it works

Before running the script, you open both pages in your browser and make sure you're logged in on both. The script then connects to those open tabs, reads all your objectives from the EA webapp, and updates the matching checkboxes on Futbin accordingly.

EA webapp is the source of truth — whatever is done there gets marked on Futbin
Futbin is only ever updated, never read as a source
Tasks that are done on EA but not yet checked on Futbin → get checked
Tasks that are not done on EA but are checked on Futbin → get unchecked
Requirements
Node.js (v18 or higher)
Google Chrome with the pages open and logged in
Installation
bash
git clone https://github.com/Kevinlont1/ea-futbin-sync.git
cd ea-futbin-sync
npm install
npx playwright install chromium
Configuration

Open config.json and fill in your URLs before running:

json
{
  "ea_url": "https://www.ea.com/ea-sports-fc/ultimate-team/web-app/",
  "futbin_url": "https://www.futbin.com/26/objectives",
  "headless": false
}
Setting	Description
ea_url	URL of the EA FC web app — fill in your own if different
futbin_url	Futbin objectives page — default is futbin.com/26/objectives, change only if needed
headless	false = browser visible (recommended), true = runs in background

Both pages must be open and logged in in your browser before you run the sync.

First-time setup

Run this once to link the script to your open browser tabs and save your session:

bash
npm run open
npm run setup

Steps:

Run npm run open — it starts Chrome (with a dedicated profile, separate from your everyday Chrome) with the EA webapp and Futbin already open
Log in on both pages (first time only — the profile remembers it after that)
Run npm run setup — it detects both tabs and saves the session to cookies.json

After setup you don't need to run this again, unless your session has expired.

Running the sync
bash
npm start

The script will:

Connect to your open EA webapp tab
Go through every objective category (North America, South America, Africa, Europe, Asia+Oceania, Journey of Nations, Milestones, Seasonal, Campaign, Live Events, Foundations)
For each group, check which tasks are done (including clicking into groups with partial progress to see the full task list)
Open each matching Futbin page and set the checkboxes to exactly match EA
Project structure
ea-futbin-sync/
├── setup.js              # First-time setup, detects open tabs and saves session
├── sync.js               # Main entry point — run this to sync
├── config.json           # Your URLs and settings (edit this before first run)
├── src/
│   ├── ea-reader.js      # Reads all objectives + progress from EA webapp
│   └── futbin-sync.js    # Updates Futbin checkboxes to match EA
├── cookies.json          # Saved session (auto-generated — do not commit)
├── .gitignore
└── README.md
.gitignore

cookies.json contains your session and should never be pushed to GitHub. The .gitignore handles this automatically:

node_modules/
cookies.json
Notes
If the sync fails with a login error, run npm run setup again to refresh your session
Fully completed groups ("Claimed" on EA) are automatically marked as all done on Futbin
If Futbin changes their page layout, the toggles may need a small fix — check the futbin-sync.js file
Tech stack
Playwright — browser automation
Node.js — runtime