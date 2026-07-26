// Reads objective progress from the EA FC Ultimate Team web app.
//
// Selectors below were captured from the live web app's DOM (its component
// classes, e.g. "ut-objective-group-view", are semantic and not hashed per
// build, unlike a lot of SPAs — so these should stay valid across most
// content updates). If EA reworks the Objectives UI, this is the file to
// fix — start by re-checking the SELECTORS block.

const CATEGORIES = [
  'North America',
  'South America',
  'Africa',
  'Europe',
  'Asia + Oceania',
  'Journey of Nations',
  'Milestones',
  'Seasonal',
  'Campaign',
  'Live Events',
  'Foundations',
];

const SELECTORS = {
  // Card on the Home screen that opens the Objectives/FC Hub area.
  fcHubCard: 'FC Hub',
  // Horizontal tab strip inside FC Hub (FC Season, Seasonal, North America, ...).
  categoryTabs: '.menu-container',
  categoryTab: '.ea-filter-bar-item-view',
  // One objective group card (e.g. "Mexico", "Weekly Objectives").
  groupCard: '.ut-objective-group-view',
  groupTitle: '.ut-objective-group-view--title',
  // A group card gets this class once its rewards have been claimed.
  redeemedClass: 'redeemed',
  // Individual task row within a group card.
  taskRow: '.ut-objective-task-view',
  taskTitle: '.ut-objective-task-view--title',
  taskProgress: '.ut-objective-task-view--progress',
};

async function safeInnerText(locator) {
  try {
    return (await locator.innerText()).trim();
  } catch {
    return '';
  }
}

function parseDone(progressText, fallback) {
  const match = progressText.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return fallback;
  return Number(match[1]) >= Number(match[2]);
}

async function readGroup(groupCard) {
  const name = await safeInnerText(groupCard.locator(SELECTORS.groupTitle));
  if (!name) return null;

  const className = (await groupCard.getAttribute('class')) || '';
  const claimed = className.includes(SELECTORS.redeemedClass);

  const taskRows = groupCard.locator(SELECTORS.taskRow);
  const taskCount = await taskRows.count();
  const tasks = [];

  for (let i = 0; i < taskCount; i++) {
    const row = taskRows.nth(i);
    const taskName = await safeInnerText(row.locator(SELECTORS.taskTitle));
    if (!taskName) continue;
    const progressText = await safeInnerText(row.locator(SELECTORS.taskProgress));
    tasks.push({ name: taskName, done: parseDone(progressText, claimed) });
  }

  return { name, claimed, tasks };
}

async function readCategory(page, categoryName) {
  const tab = page.locator(SELECTORS.categoryTabs).getByText(categoryName, { exact: true });

  try {
    await tab.first().waitFor({ state: 'visible', timeout: 10000 });
  } catch {
    console.warn(`  [skip] Category "${categoryName}" not found on the page.`);
    return null;
  }

  await tab.first().click();
  await page.waitForTimeout(800);

  const groupCards = page.locator(SELECTORS.groupCard);
  const groupCount = await groupCards.count();
  const groups = [];

  for (let i = 0; i < groupCount; i++) {
    try {
      const group = await readGroup(groupCards.nth(i));
      if (group && group.tasks.length > 0) groups.push(group);
    } catch (err) {
      console.warn(`  [warn] Could not read a group in "${categoryName}": ${err.message}`);
    }
  }

  return { category: categoryName, groups };
}

/**
 * Reads every objective category and returns a structured snapshot of
 * EA's current progress.
 * @param {import('playwright').Page} page - page already navigated to ea_url and logged in.
 */
async function readObjectives(page) {
  console.log('Opening FC Hub...');
  // The webapp plays an intro animation before Home renders, so the "FC Hub"
  // card can take a while to show up — wait for it instead of checking once.
  const fcHub = page.getByText(SELECTORS.fcHubCard, { exact: true });
  try {
    await fcHub.first().waitFor({ state: 'visible', timeout: 30000 });
  } catch {
    throw new Error('Could not find the "FC Hub" card on the EA webapp home screen. Is the page logged in and fully loaded?');
  }
  await fcHub.first().click();
  await page.waitForTimeout(1500);

  const results = [];
  for (const categoryName of CATEGORIES) {
    console.log(`Reading category: ${categoryName}`);
    try {
      const categoryResult = await readCategory(page, categoryName);
      if (categoryResult) results.push(categoryResult);
    } catch (err) {
      console.warn(`  [warn] Failed to read category "${categoryName}": ${err.message}`);
    }
  }

  return results;
}

module.exports = { readObjectives, CATEGORIES, SELECTORS };
