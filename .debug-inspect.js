const { chromium } = require('playwright');

function originOf(url) {
  return new URL(url).origin;
}

function findPage(browser, targetOrigin) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      try {
        if (originOf(page.url()) === targetOrigin) return page;
      } catch {}
    }
  }
  return null;
}

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9222', { timeout: 20000 });
  const page = findPage(browser, 'https://www.futbin.com');
  if (!page) throw new Error('Futbin page not found');

  const info = await page.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll('.obj-info-box'));
    return boxes.map(box => {
      const btn = box.querySelector('button.mac-button, button[aria-label="Mark As Completed Button"]');
      return {
        boxClass: box.className,
        boldTexts: Array.from(box.querySelectorAll('.bold')).map(b => b.textContent.trim()),
        btnClass: btn?.className,
        btnAriaLabel: btn?.getAttribute('aria-label'),
        btnDataUrl: btn?.getAttribute('data-url'),
        btnDataRemoveUrl: btn?.getAttribute('data-remove-url'),
      };
    });
  });
  console.log(JSON.stringify(info, null, 2));

  await browser.close();
}

main().catch((err) => {
  console.error('Inspect failed:', err.message);
  process.exit(1);
});
