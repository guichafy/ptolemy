const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const out = process.argv[2];
  const page = await browser.newPage({ viewport: { width: 790, height: 640 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type()==='warning') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  for (const s of ['codex', 'claude-long']) {
    await page.goto('http://localhost:4173/?s=' + s);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/chat-${s}.png` });
  }
  // hover context
  await page.goto('http://localhost:4173/?s=claude-long');
  await page.waitForTimeout(1200);
  await page.hover('button[aria-label^="Contexto usado"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/chat-context.png` });
  // streaming turn
  await page.goto('http://localhost:4173/?s=codex');
  await page.waitForTimeout(1000);
  await page.fill('textarea', 'Liste 3 fatos sobre ele');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/chat-waiting.png` });
  await page.evaluate(() => {
    const e = window.__emit;
    e({ type: 'session-state-change', sessionId: window.__sid, state: 'running' });
    e({ type: 'tool-call', toolCallId: 'x1', toolName: 'Shell', args: { command: "rg -n 'presidente' docs/" }, parentToolCallId: null });
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/chat-tool.png` });
  await page.evaluate(async () => {
    const e = window.__emit;
    e({ type: 'tool-result', toolCallId: 'x1', result: 'docs/a.md:3: presidente' });
    e({ type: 'text-start', messageId: 'm1', parentToolCallId: null });
    const txt = "1. **Nascimento:** Caetés (PE), 1945.\n2. **Mandatos:** 2003–2010 e desde 2023.\n3. Fundou o PT em 1980 e ";
    for (const ch of txt.match(/.{1,3}/gs)) { e({ type: 'text-delta', messageId: 'm1', delta: ch }); }
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/chat-streaming.png` });
  await page.evaluate(() => {
    const e = window.__emit;
    e({ type: 'text-end', messageId: 'm1' });
    e({ type: 'session-info', info: { resolvedModel: 'gpt-6-astra', contextUsage: { usedTokens: 41000, maxTokens: 272000, inputTokens: 40100, outputTokens: 900, updatedAt: 'x' } } });
    e({ type: 'finish', reason: 'completed', usage: { inputTokens: 1, outputTokens: 1 }, durationMs: 6200 });
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/chat-finished.png` });
  console.log(errors.join('\n') || 'no console errors');
  await browser.close();
})();
