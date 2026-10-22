import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const [,, targetId, expectation = 'pass', screenshotPath] = process.argv;
const tabs = await fetch('http://127.0.0.1:18800/json/list').then(r => r.json());
const tab = tabs.find(t => t.id === targetId);
assert(tab, 'Browser tab must exist');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  const callback = pending.get(message.id);
  if (callback) {
    pending.delete(message.id);
    message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result);
  }
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const callId = ++id;
    pending.set(callId, { resolve, reject });
    ws.send(JSON.stringify({ id: callId, method, params }));
  });
}
try {
  let failures = 0;
  for (const [width, height] of [[320,844],[390,844],[768,1024],[844,390],[1440,900]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const result = await send('Runtime.evaluate', {
      expression: `(async () => {
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const section = document.getElementById('email-address');
        if (!section) throw new Error('Email section is not mounted');
        const input = section.querySelector('input');
        if (!input) throw new Error('Open the email editor before running');
        section.scrollIntoView({block: 'start'});
        const rect = input.getBoundingClientRect();
        const card = section.getBoundingClientRect();
        const buttons = [...section.querySelectorAll('button')].filter(b => ['Save', 'Cancel'].includes(b.textContent.trim()));
        const metrics = {
          viewport: innerWidth,
          inputWidth: rect.width,
          inputInside: rect.left >= card.left && rect.right <= card.right,
          controls: buttons.map(b => { const r = b.getBoundingClientRect(); return {name:b.textContent.trim(),left:r.left,right:r.right}; }),
        };
        metrics.pass = rect.width >= 128 && metrics.inputInside && buttons.length === 2 && metrics.controls.every(b => b.left >= card.left && b.right <= Math.min(card.right, innerWidth));
        return metrics;
      })()`, returnByValue: true, awaitPromise: true,
    });
    assert(!result.exceptionDetails, 'Browser evaluation must complete');
    const metrics = result.result.value;
    console.log(JSON.stringify(metrics));
    if (!metrics.pass) failures++;
  }
  if (expectation === 'fail') assert(failures > 0, 'Expected base to fail');
  else assert.equal(failures, 0, 'Every viewport must retain a usable input and visible actions');
  if (screenshotPath) {
    await send('Emulation.setDeviceMetricsOverride', { width:390, height:844, deviceScaleFactor:1, mobile:false });
    await send('Runtime.evaluate', { expression:`(async () => {await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); const s=document.getElementById('email-address');s.querySelector('.truncate').style.visibility='hidden';s.scrollIntoView({block:'start'});return innerWidth;})()`, returnByValue:true, awaitPromise:true });
    const {data} = await send('Page.captureScreenshot', {format:'png',fromSurface:true});
    await fs.writeFile(screenshotPath, Buffer.from(data,'base64'));
    console.log('Screenshot: '+screenshotPath);
  }
  console.log(`RESULT: ${expectation === 'fail' ? 'EXPECTED_BASE_FAILURE' : 'PASS'} (${failures}/5 failing widths)`);
} finally {
  ws.close();
}
