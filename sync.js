// Main entry point. Reads objective progress from the EA webapp and updates
// Futbin's checkboxes to match exactly. EA is always the source of truth;
// Futbin is only ever written to.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { readObjectives } = require('./src/ea-reader');
const { syncToFutbin } = require('./src/futbin-sync');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const COOKIES_PATH = path.join(__dirname, 'cookies.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`config.json not found at ${CONFIG_PATH}. Copy the example from README.md first.`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

async function main() {
  const config = loadConfig();

  if (!fs.existsSync(COOKIES_PATH)) {
    throw new Error('cookies.json not found. Run "npm run setup" first to save your session.');
  }

  console.log(`Launching Chrome (headless: ${!!config.headless}) ...`);
  // Futbin sits behind bot-detection that fingerprints Playwright's bundled
  // Chromium (and its automation traits) and answers with a custom 403 page
  // even when a valid, logged-in session cookie is presented. Launching the
  // user's real installed Chrome (channel: 'chrome') instead of the bundled
  // Chromium, plus hiding the obvious automation flag, is enough to pass —
  // EA's webapp doesn't do this kind of check, which is why only Futbin 403s.
  const browser = await chromium.launch({
    headless: !!config.headless,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  });

  try {
    const context = await browser.newContext({ storageState: COOKIES_PATH });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const eaPage = await context.newPage();
    console.log(`Opening EA webapp: ${config.ea_url}`);
    await eaPage.goto(config.ea_url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const futbinPage = await context.newPage();
    console.log(`Opening Futbin: ${config.futbin_url}`);
    await futbinPage.goto(config.futbin_url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const snapshot = await readObjectives(eaPage);

    const totalGroups = snapshot.reduce((sum, c) => sum + c.groups.length, 0);
    console.log(`\nRead ${snapshot.length} categories, ${totalGroups} groups from EA. Syncing to Futbin...\n`);

    const stats = await syncToFutbin(futbinPage, snapshot);

    console.log('\nSync complete:');
    console.log(`  Checked:      ${stats.checked}`);
    console.log(`  Unchecked:    ${stats.unchecked}`);
    console.log(`  Already OK:   ${stats.alreadyOk}`);
    console.log(`  Unmatched:    ${stats.unmatched}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('\nSync failed:', err.message);
  if (/login|not found/i.test(err.message)) {
    console.error('If this looks like a login/session issue, run "npm run setup" again to refresh cookies.json.');
  }
  process.exitCode = 1;
});
