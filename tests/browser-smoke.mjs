import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname;
const fileUrl = `file://${root}index.html`;
const port = 12000 + Math.floor(Math.random() * 1000);
const chrome = spawn('/usr/bin/chromium', [
  '--headless=new', '--no-sandbox', `--remote-debugging-port=${port}`,
  '--disable-gpu', '--disable-dev-shm-usage', fileUrl
], { stdio: ['ignore', 'ignore', 'ignore'] });

async function waitJson(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {}
    await sleep(100);
  }
  throw new Error('CDP not ready');
}

let ws, nextId = 1;
const pending = new Map();
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression, timeout = 120000) {
  const result = await Promise.race([
    send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout }),
    sleep(timeout + 5000).then(() => { throw new Error('evaluate timeout'); })
  ]);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function main() {
  await waitJson(`http://127.0.0.1:${port}/json/version`);
  const pages = await waitJson(`http://127.0.0.1:${port}/json/list`);
  const page = pages.find(p => p.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    }
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  await sleep(300);

  const sample = readFileSync(`${root}samples/sample-5000.txt`, 'utf8');
  const results = await evaluate(`(async () => {
    const $ = id => document.getElementById(id);
    function setSel(id, v) { $(id).value = v; $(id).dispatchEvent(new Event('change', { bubbles: true })); }
    async function run(input, opts = {}, overrides = null) {
      $('inputText').value = input;
      setSel('ambiguousPolicy', opts.ambiguousPolicy || 'parse');
      setSel('groupPolicy', opts.groupPolicy || 'expand');
      setSel('rangeFormat', opts.rangeFormat || 'short');
      setSel('previewLimit', opts.previewLimit || '1000');
      const t0 = performance.now();
      if (overrides) await window.__ipLinerTest.processWithOverrides([...overrides]); else $('runBtn').click();
      const start = performance.now();
      while (!['완료','사용자 확인 대기'].includes($('status').textContent)) {
        if (performance.now() - start > 90000) throw new Error('run timeout: ' + $('status').textContent);
        await new Promise(r => setTimeout(r, 20));
      }
      return { ms: Math.round(performance.now() - t0), status: $('status').textContent, stats: $('stats').textContent, output: window.__ipLinerTest.getLastOutput(), preview: $('output').textContent, log: $('log').textContent };
    }
    const out = {};
    out.title = document.title;
    out.policyLabels = [...$('ambiguousPolicy').options].map(o => o.textContent);
    out.confirmExists = [...$('ambiguousPolicy').options].some(o => o.value === 'confirm');
    out.conservative = await run('192.168.1.1\\n192.168.1.2\\n192.168.1.3\\n192.168.1.10', { groupPolicy: 'contiguous' });
    out.expand = await run('192.168.1.3\\n192.168.1.23\\n192.168.1.233', { groupPolicy: 'expand' });
    out.commaRaw = await run('192.168.1.1,192.168.1.2', { ambiguousPolicy: 'raw', groupPolicy: 'single' });
    out.commaExclude = await run('192.168.1.1,192.168.1.2', { ambiguousPolicy: 'exclude', groupPolicy: 'single' });
    out.spaceParse = await run('192.168.1.1 192.168.1.2', { ambiguousPolicy: 'parse', groupPolicy: 'single' });
    out.confirmWait = await run('192.168.1.1,192.168.1.2', { ambiguousPolicy: 'confirm', groupPolicy: 'single' });
    out.confirmPreviewInitial = document.querySelector('.confirmPreview')?.textContent || '';
    document.querySelector('.confirmRow select').value = 'exclude';
    document.querySelector('.confirmRow select').dispatchEvent(new Event('change', { bubbles: true }));
    out.confirmPreviewExclude = document.querySelector('.confirmPreview')?.textContent || '';
    out.sample = await run(${JSON.stringify(sample)}, { ambiguousPolicy: 'parse', groupPolicy: 'contiguous' });
    return out;
  })()`, 160000);

  assert.equal(results.title, 'IP Liner');
  assert.equal(results.confirmExists, true);
  assert.deepEqual(results.policyLabels, ['분리해서 IP로 변환', '원문 그대로 출력', '결과에서 제외', '비표준마다 직접 선택']);
  assert.equal(results.conservative.output, '192.168.1.1-3\n192.168.1.10');
  assert.equal(results.expand.output, '192.168.1.3-233');
  assert.equal(results.commaRaw.output, '192.168.1.1,192.168.1.2');
  assert.equal(results.commaExclude.output, '');
  assert.equal(results.spaceParse.output, '192.168.1.1\n192.168.1.2');
  assert.equal(results.confirmWait.status, '사용자 확인 대기');
  assert.match(results.confirmPreviewInitial, /출력 예시 \(2개\):/);
  assert.match(results.confirmPreviewInitial, /192\.168\.1\.1/);
  assert.match(results.confirmPreviewExclude, /결과에 넣지 않음/);
  assert.match(results.sample.stats, /비표준 입력 4개/);
  assert.match(results.sample.log, /총 입력 건수: 5,000개/);
  console.log(JSON.stringify({ ok: true, sampleMs: results.sample.ms, sampleStats: results.sample.stats }, null, 2));
}

try {
  await main();
} finally {
  try { ws?.close(); } catch {}
  chrome.kill('SIGTERM');
}
