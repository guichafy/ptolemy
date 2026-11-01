const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 790, height: 640 } });
  await page.goto('http://localhost:4174/?s=claude-long');
  await page.waitForTimeout(1500);
  const r = await page.evaluate(async () => {
    const e = window.__emit;
    const longTasks = [];
    new PerformanceObserver((l) => l.getEntries().forEach((x) => longTasks.push(x.duration))).observe({ entryTypes: ['longtask'] });
    e({ type: 'session-state-change', sessionId: window.__sid, state: 'running' });
    e({ type: 'text-start', messageId: 'p1', parentToolCallId: null });
    const para = "Linha com **negrito**, `código` e um [link](https://x.y). ";
    const t0 = performance.now();
    // 40 chunks/frame for 150 frames ≈ a fast model for ~2.5s
    for (let f = 0; f < 150; f++) {
      for (let i = 0; i < 40; i++) e({ type: 'text-delta', messageId: 'p1', delta: i === 39 ? "\n\n" : para.slice(0, 15) });
      await new Promise((r) => requestAnimationFrame(r));
    }
    const t1 = performance.now();
    await new Promise((r) => setTimeout(r, 300));
    return { ms: Math.round(t1 - t0), frames: 150, longTasks: longTasks.length, maxLong: Math.round(Math.max(0, ...longTasks)), chars: document.querySelector('[data-slot=conversation-content], [role=log]')?.textContent.length };
  });
  console.log(JSON.stringify(r));
  await browser.close();
})();
