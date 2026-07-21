// Reads objective progress from the EA FC Ultimate Team web app.
//
// The web app is a heavy client-rendered SPA, so this file leans on
// accessible-name/text locators (role + name) rather than CSS class names,
// since EA's build hashes classes on every release but rarely changes the
// visible copy. If EA changes the layout, this is the file to fix — the
// SELECTORS block below is the place to start.

const CATEGORIES = [
  'North America',
  'South America',
  'Africa',
  'Europe',
  'Asia+Oceania',
  'Journey of Nations',
  'Milestones',
  'Seasonal',
  'Campaign',
  'Live Events',
  'Foundations',
];

const SELECTORS = {
  // Left-hand nav entry that opens the Objectives hub.
  objectivesNavItem: { role: 'link', name: /objectives/i },
  // Tab/button for a single category inside the Objectives hub.
  categoryTab: (name) => ({ role: 'tab', name, exact: false }),
  // A single objective group card within a category panel.
  groupCard: '[class*="objective"][class*="group"], [class*="objective-group"], [class*="objectiveCard"]',
  // Badge/label shown on a fully-claimed group.
  claimedBadge: { role: 'button', name: /claimed/i },
  // Individual task row once a group is expanded.
  taskRow: '[class*="task"], [class*="requirement"], li',
  // Checkmark / completed indicator within a task row.
  doneIndicator: '[class*="complete"], [class*="checkmark"], [class*="done"], svg[class*="check"]',
};

async function safeText(locator) {
  try {
    return (await locator.innerText()).trim();
  } catch {
    return '';
  }
}

async function isGroupClaimed(groupCard) {
  const badge = groupCard.getByRole(SELECTORS.claimedBadge.role, { name: SELECTORS.claimedBadge.name });
  return (await badge.count()) > 0;
}

async function readTasksFromExpandedGroup(page, groupCard) {
  await groupCard.click();
  // Expanding a group triggers an animation/fetch in the EA webapp — give it
  // a moment rather than racing the DOM.
  await page.waitForTimeout(500);

  const rows = page.locator(SELECTORS.taskRow);
  const count = await rows.count();
  const tasks = [];

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const name = await safeText(row);
    if (!name) continue;

    const doneCount = await row.locator(SELECTORS.doneIndicator).count();
    tasks.push({ name, done: doneCount > 0 });
  }

  return tasks;
}

async function readCategory(page, categoryName) {
  const tab = page.getByRole(
    SELECTORS.categoryTab(categoryName).role,
    { name: SELECTORS.categoryTab(categoryName).name }
  );

  if ((await tab.count()) === 0) {
    console.warn(`  [skip] Category "${categoryName}" not found on the page.`);
    return null;
  }

  await tab.first().click();
  await page.waitForTimeout(500);

  const groupCards = page.locator(SELECTORS.groupCard);
  const groupCount = await groupCards.count();
  const groups = [];

  for (let i = 0; i < groupCount; i++) {
    const card = groupCards.nth(i);
    const name = await safeText(card);
    if (!name) continue;

    const claimed = await isGroupClaimed(card);

    let tasks = [];
    if (!claimed) {
      try {
        tasks = await readTasksFromExpandedGroup(page, card);
      } catch (err) {
        console.warn(`  [warn] Could not read tasks for group "${name}": ${err.message}`);
      }
    }

    groups.push({ name, claimed, tasks });
  }

  return { category: categoryName, groups };
}

/**
 * Reads every objective category and returns a structured snapshot of
 * EA's current progress.
 * @param {import('playwright').Page} page - page already navigated to ea_url and logged in.
 */
async function readObjectives(page) {
  console.log('Opening Objectives hub...');
  const objectivesLink = page.getByRole(SELECTORS.objectivesNavItem.role, { name: SELECTORS.objectivesNavItem.name });
  if ((await objectivesLink.count()) > 0) {
    await objectivesLink.first().click();
    await page.waitForTimeout(1000);
  }

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
