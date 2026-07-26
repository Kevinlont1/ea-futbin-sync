// Updates Futbin's objectives checkboxes to match a snapshot read from the
// EA webapp. Futbin is only ever written to here — it is never treated as a
// source of truth.
//
// Futbin's objectives are spread across three page levels, so syncing means
// navigating through all of them for every group:
//   /26/objectives                          - category pills (.category-pill)
//   /26/objectives/{y}/{catId}/{slug}        - group cards (.og-card-wrapper)
//   /26/objectives/{y}/{catId}/{id}/{slug}   - task list (.obj-info-box) with
//                                              the actual completion toggle
// Selectors were captured from Futbin's live DOM. If Futbin reworks the
// Objectives pages, this is the file to fix — start with the SELECTORS block.

// Delay after every Futbin page navigation. Going through pages too fast
// back-to-back reads as bot-like traffic and made task toggles lag behind
// the page (see waitForTaskState warnings), so we deliberately pace it.
const PAGE_DELAY_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SELECTORS = {
  categoryPill: '.category-pill',
  groupCard: '.og-card-wrapper',
  groupCardLink: 'a',
  groupTitle: '.obj-title',
  taskBox: '.obj-info-box',
  taskName: '.bold',
  taskButton: 'button.mac-button[aria-label="Mark As Completed Button"]',
  completedClass: 'completed',
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

async function safeInnerText(locator) {
  try {
    return (await locator.innerText()).trim();
  } catch {
    return '';
  }
}

async function findCategoryHref(page, categoryName) {
  const pills = page.locator(SELECTORS.categoryPill);
  await pills.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

  const count = await pills.count();
  const normalizedTarget = normalize(categoryName);
  let fallbackHref = null;

  // Prefer an exact match over the first startsWith hit: names like "North
  // America" and "North America Completionist" both start with the same
  // text, and a greedy first-match would send us to the wrong page.
  for (let i = 0; i < count; i++) {
    const pill = pills.nth(i);
    const text = await safeInnerText(pill);
    const normalizedText = normalize(text);
    if (!normalizedText) continue;

    if (normalizedText === normalizedTarget) {
      return pill.getAttribute('href');
    }
    if (!fallbackHref && normalizedText.startsWith(normalizedTarget)) {
      fallbackHref = await pill.getAttribute('href');
    }
  }
  return fallbackHref;
}

async function findGroupHref(page, groupName) {
  const cards = page.locator(SELECTORS.groupCard);
  await cards.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

  const count = await cards.count();
  console.log(`    [debug] found ${count} group cards, looking for "${groupName}"`);
  const normalizedTarget = normalize(groupName);
  let fallbackHref = null;

  // Same exact-match-first reasoning as findCategoryHref: "North America"
  // must not resolve to the "North America Completionist" card just because
  // it appears earlier in the list and textsMatch() allows substrings.
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const title = await safeInnerText(card.locator(SELECTORS.groupTitle));
    console.log(`    [debug] card ${i}: "${title}"`);
    const normalizedTitle = normalize(title);
    if (!normalizedTitle) continue;

    if (normalizedTitle === normalizedTarget) {
      return card.locator(SELECTORS.groupCardLink).first().getAttribute('href');
    }
    if (!fallbackHref && textsMatch(title, groupName)) {
      fallbackHref = await card.locator(SELECTORS.groupCardLink).first().getAttribute('href');
    }
  }
  return fallbackHref;
}

async function isTaskDone(box) {
  const className = (await box.getAttribute('class')) || '';
  return className.split(/\s+/).includes(SELECTORS.completedClass);
}

// Clicking the toggle fires an AJAX request (no page reload). Wait for the
// box's class to flip before moving on, so a follow-up navigation can't
// cancel the request mid-flight and silently drop the change.
async function waitForTaskState(box, desired, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await isTaskDone(box)) === desired) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function syncGroupTasks(page, tasks, stats) {
  const boxes = page.locator(SELECTORS.taskBox);
  await boxes.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

  const boxCount = await boxes.count();

  for (const task of tasks) {
    let matched = false;

    for (let i = 0; i < boxCount; i++) {
      const box = boxes.nth(i);
      const name = await safeInnerText(box.locator(SELECTORS.taskName).first());
      if (!textsMatch(name, task.name)) continue;

      matched = true;
      const current = await isTaskDone(box);
      if (current === task.done) {
        stats.alreadyOk++;
        break;
      }

      await box.locator(SELECTORS.taskButton).click();
      const applied = await waitForTaskState(box, task.done);
      if (!applied) {
        console.warn(`    [warn] "${task.name}" did not update on Futbin in time.`);
        break;
      }
      if (task.done) stats.checked++;
      else stats.unchecked++;
      break;
    }

    if (!matched) {
      console.warn(`    [unmatched] "${task.name}" not found on Futbin.`);
      stats.unmatched++;
    }
  }
}

/**
 * Applies an EA objectives snapshot (as produced by ea-reader.js) to Futbin,
 * navigating through the category and group pages as needed.
 * @param {import('playwright').Page} page - page already navigated to futbin_url and logged in.
 * @param {Array} eaSnapshot - result of ea-reader's readObjectives().
 */
async function syncToFutbin(page, eaSnapshot) {
  const stats = { checked: 0, unchecked: 0, alreadyOk: 0, unmatched: 0 };
  const origin = new URL(page.url()).origin;

  for (const category of eaSnapshot) {
    console.log(`Syncing category: ${category.category}`);

    const categoryHref = await findCategoryHref(page, category.category);
    if (!categoryHref) {
      console.warn(`  [skip] Category "${category.category}" not found on Futbin.`);
      continue;
    }
    await page.goto(origin + categoryHref, { waitUntil: 'domcontentloaded' });
    await sleep(PAGE_DELAY_MS);

    for (const group of category.groups) {
      console.log(`  ${group.name}${group.claimed ? ' (claimed)' : ''}`);
      try {
        const groupHref = await findGroupHref(page, group.name);
        if (!groupHref) {
          console.warn(`    [skip] Group "${group.name}" not found on Futbin.`);
          continue;
        }

        await page.goto(origin + groupHref, { waitUntil: 'domcontentloaded' });
        await sleep(PAGE_DELAY_MS);
        await syncGroupTasks(page, group.tasks, stats);
        await page.goto(origin + categoryHref, { waitUntil: 'domcontentloaded' });
        await sleep(PAGE_DELAY_MS);
      } catch (err) {
        console.warn(`    [warn] Failed to sync group "${group.name}": ${err.message}`);
      }
    }
  }

  return stats;
}

module.exports = { syncToFutbin, SELECTORS };
