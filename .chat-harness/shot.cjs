const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 790, height: 640 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  for (const s of ['claude', 'codex']) {
    await page.goto('http://localhost:4175/?s=' + s); await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/v2-${s}.png` });
    await page.hover('button[aria-label^="Contexto usado"]'); await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/v2-${s}-hover.png` });
    await page.click('button[aria-label^="Contexto usado"]'); await page.waitForTimeout(900); await page.screenshot({ path: `${out}/v2-${s}-details-top.png` });
    await page.getByText('Ferramentas usadas na conversa').click().catch(() => {});
    await page.getByText('Ferramentas (chamadas + saídas)').click().catch(() => {});
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/v2-${s}-details.png` });
  }
  console.log(errors.join('\n') || 'no errors');
  await browser.close();
})();
