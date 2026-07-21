// Convenience launcher for "npm run open".
//
// Starts Chrome with remote debugging enabled (required by setup.js) and
// opens the EA webapp + Futbin pages directly, so you don't have to type
// the chrome.exe command yourself.
//
// Uses its own dedicated Chrome profile (.chrome-profile/) instead of your
// everyday one, so this can run side-by-side with your normal Chrome. The
// first time, you'll need to log in on both pages; after that the login
// is remembered in that profile for next time.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const PROFILE_DIR = path.join(__dirname, '.chrome-profile');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`config.json not found at ${CONFIG_PATH}. Copy the example from README.md first.`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function main() {
  const config = loadConfig();
  const port = config.chrome_debug_port || 9222;
  const chromePath = findChrome();

  if (!chromePath) {
    throw new Error(
      'Could not find chrome.exe automatically.\n' +
      'Set a CHROME_PATH environment variable pointing to it, or open Chrome yourself with:\n' +
      `  chrome.exe --remote-debugging-port=${port} --user-data-dir="${PROFILE_DIR}" "${config.ea_url}" "${config.futbin_url}"`
    );
  }

  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  console.log(`Starting Chrome (debug port ${port}) with a dedicated profile...`);
  const child = spawn(
    chromePath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${PROFILE_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
      config.ea_url,
      config.futbin_url,
    ],
    { detached: true, stdio: 'ignore' }
  );
  child.unref();

  console.log('\nChrome is opening with two tabs: the EA webapp and Futbin.');
  console.log('Log in on both (first time only), then run: npm run setup');
}

try {
  main();
} catch (err) {
  console.error('\nCould not start Chrome:', err.message);
  process.exitCode = 1;
}
