// First-time setup.
//
// Captures the logged-in session from your already-open Chrome tabs (EA webapp
// + Futbin) and saves it to cookies.json, so sync.js can reuse it later
// without needing you to log in again inside an automated browser.
//
// Requirement: Chrome must be started with remote debugging enabled, e.g.
//   chrome.exe --remote-debugging-port=9222
// with the EA webapp and Futbin objectives page open and logged in.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const COOKIES_PATH = path.join(__dirname, 'cookies.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`config.json not found at ${CONFIG_PATH}. Copy the example from README.md first.`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function originOf(url) {
  return new URL(url).origin;
}

// Finds an already-open page whose URL starts with the given target URL's origin.
function findPage(browser, targetUrl) {
  const targetOrigin = originOf(targetUrl);
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      try {
        if (originOf(page.url()) === targetOrigin) {
          return page;
        }
      } catch {
        // page.url() can throw for pages that are still loading/closed — skip.
      }
    }
  }
  return null;
}

// Heavy SPAs like the EA webapp keep navigating/redirecting client-side even
// after the page looks loaded, which tears down the JS execution context
// mid-evaluate. Wait for things to settle and retry a few times rather than
// failing on the first navigation we race against.
async function readLocalStorage(page, retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
      return await page.evaluate(() => {
        const entries = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const name = window.localStorage.key(i);
          entries.push({ name, value: window.localStorage.getItem(name) });
        }
        return entries;
      });
    } catch (err) {
      const isNavigationRace = /Execution context was destroyed|context or browser has been closed/i.test(err.message);
      if (!isNavigationRace || attempt === retries) throw err;
      console.warn(`  [retry] Page was still navigating, retrying localStorage read (${attempt}/${retries})...`);
      await page.waitForTimeout(1000);
    }
  }
}

async function main() {
  const config = loadConfig();
  const cdpEndpoint = `http://localhost:${config.chrome_debug_port || 9222}`;

  console.log(`Connecting to Chrome at ${cdpEndpoint} ...`);
  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpEndpoint);
  } catch (err) {
    console.error(
      `\nCould not connect to Chrome on port ${config.chrome_debug_port || 9222}.\n` +
      `Make sure Chrome is running with remote debugging enabled, e.g.:\n\n` +
      `  chrome.exe --remote-debugging-port=${config.chrome_debug_port || 9222}\n\n` +
      `and that the EA webapp and Futbin pages are open in it.\n`
    );
    throw err;
  }

  try {
    console.log('Looking for the EA webapp tab...');
    const eaPage = findPage(browser, config.ea_url);
    if (!eaPage) {
      throw new Error(
        `Could not find an open tab for ${config.ea_url}\n` +
        `Open it in the Chrome instance you started with --remote-debugging-port and log in first.`
      );
    }
    console.log(`Found EA tab: ${eaPage.url()}`);

    console.log('Looking for the Futbin tab...');
    const futbinPage = findPage(browser, config.futbin_url);
    if (!futbinPage) {
      throw new Error(
        `Could not find an open tab for ${config.futbin_url}\n` +
        `Open it in the Chrome instance you started with --remote-debugging-port and log in first.`
      );
    }
    console.log(`Found Futbin tab: ${futbinPage.url()}`);

    // Collect cookies from every context Chrome exposes (covers cases where
    // Chrome splits tabs across profiles/contexts).
    let cookies = [];
    for (const context of browser.contexts()) {
      cookies = cookies.concat(await context.cookies());
    }
    // De-duplicate by name+domain+path (last one wins).
    const cookieMap = new Map();
    for (const cookie of cookies) {
      cookieMap.set(`${cookie.name}|${cookie.domain}|${cookie.path}`, cookie);
    }
    cookies = Array.from(cookieMap.values());

    console.log('Reading localStorage for both sites...');
    const origins = [
      { origin: originOf(config.ea_url), localStorage: await readLocalStorage(eaPage) },
      { origin: originOf(config.futbin_url), localStorage: await readLocalStorage(futbinPage) },
    ];

    const storageState = { cookies, origins };
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(storageState, null, 2));
    console.log(`\nSession saved to ${COOKIES_PATH}`);
    console.log('You can now run "npm start" to sync — even after closing this Chrome window.');
  } finally {
    // Disconnects Playwright from Chrome. Does NOT close your actual browser.
    await browser.close();
  }
}

main().catch((err) => {
  console.error('\nSetup failed:', err.message);
  process.exitCode = 1;
});
