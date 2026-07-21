// Updates Futbin's objectives checkboxes to match a snapshot read from the
// EA webapp. Futbin is only ever written to here — it is never treated as a
// source of truth.
//
// Like ea-reader.js, this leans on visible text rather than CSS class names
// since that's the part of Futbin's markup least likely to change. If Futbin
// reworks their page, this is the file to fix — start with the SELECTORS
// block below.

const SELECTORS = {
  categoryHeading: { role: 'heading' },
  groupHeading: { role: 'heading' },
  taskRow: '[class*="task"], [class*="objective-item"], li, tr',
  checkbox: 'input[type="checkbox"], [role="checkbox"]',
};

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function textsMatch(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// Finds the section of the page belonging to a heading whose text matches `name`.
// Falls back to the heading's parent element if no closer "section-like" ancestor exists.
async function findSectionByHeading(page, name) {
  const headings = page.getByRole(SELECTORS.categoryHeading.role);
  const count = await headings.count();

  for (let i = 0; i < count; i++) {
    const heading = headings.nth(i);
    const text = await heading.innerText().catch(() => '');
    if (textsMatch(text, name)) {
      const section = heading.locator(
        'xpath=ancestor::*[self::section or contains(@class,"category") or contains(@class,"objective") or contains(@class,"panel")][1]'
      );
      if ((await section.count()) > 0) return section.first();
      return heading.locator('xpath=..');
    }
  }
  return null;
}

async function isChecked(checkbox) {
  const tag = await checkbox.evaluate((el) => el.tagName.toLowerCase());
  if (tag === 'input') return checkbox.isChecked();
  const ariaChecked = await checkbox.getAttribute('aria-checked');
  return ariaChecked === 'true';
}

async function setChecked(checkbox, desired, stats) {
  const current = await isChecked(checkbox);
  if (current === desired) {
    stats.alreadyOk++;
    return;
  }
  await checkbox.click();
  if (desired) stats.checked++;
  else stats.unchecked++;
}

async function findTaskCheckbox(section, taskName) {
  const rows = section.locator(SELECTORS.taskRow);
  const count = await rows.count();

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const text = await row.innerText().catch(() => '');
    if (!textsMatch(text, taskName)) continue;

    const checkbox = row.locator(SELECTORS.checkbox).first();
    if ((await checkbox.count()) > 0) return checkbox;
  }
  return null;
}

async function syncGroup(page, categorySection, group, stats) {
  const groupSection = await findSectionByHeading(page, group.name).catch(() => null);
  const scope = groupSection || categorySection;

  if (group.claimed) {
    // Fully claimed on EA -> every checkbox under this group should be checked.
    const checkboxes = scope.locator(SELECTORS.checkbox);
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await setChecked(checkboxes.nth(i), true, stats);
    }
    return;
  }

  for (const task of group.tasks) {
    const checkbox = await findTaskCheckbox(scope, task.name);
    if (!checkbox) {
      console.warn(`    [unmatched] "${task.name}" (group: ${group.name}) not found on Futbin.`);
      stats.unmatched++;
      continue;
    }
    await setChecked(checkbox, task.done, stats);
  }
}

/**
 * Applies an EA objectives snapshot (as produced by ea-reader.js) to the
 * currently open Futbin objectives page.
 * @param {import('playwright').Page} page - page already navigated to futbin_url and logged in.
 * @param {Array} eaSnapshot - result of ea-reader's readObjectives().
 */
async function syncToFutbin(page, eaSnapshot) {
  const stats = { checked: 0, unchecked: 0, alreadyOk: 0, unmatched: 0 };

  for (const category of eaSnapshot) {
    console.log(`Syncing category: ${category.category}`);
    const categorySection = await findSectionByHeading(page, category.category);
    if (!categorySection) {
      console.warn(`  [skip] Category "${category.category}" not found on Futbin.`);
      continue;
    }

    for (const group of category.groups) {
      console.log(`  ${group.name}${group.claimed ? ' (claimed)' : ''}`);
      try {
        await syncGroup(page, categorySection, group, stats);
      } catch (err) {
        console.warn(`    [warn] Failed to sync group "${group.name}": ${err.message}`);
      }
    }
  }

  return stats;
}

module.exports = { syncToFutbin, SELECTORS };
