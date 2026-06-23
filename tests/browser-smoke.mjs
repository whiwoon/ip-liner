import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname;
const fileUrl = `file://${root}ip-liner.html`;
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
  const sampleXlsxB64 = readFileSync(`${root}samples/sample-excel-targets.xlsx`).toString('base64');
  const results = await evaluate(`(async () => {
    const $ = id => document.getElementById(id);
    const readyStart = performance.now();
    while (!window.__ipLinerTest) {
      if (performance.now() - readyStart > 30000) throw new Error('app not ready');
      await new Promise(r => setTimeout(r, 50));
    }
    window.__scrollCalls = [];
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function(opts) { window.__scrollCalls.push({ id: this.id, opts }); };
    function choosePolicy(v) {
      document.querySelectorAll('input[name="groupPolicyCheck"]').forEach(cb => { cb.checked = cb.value === v; cb.dispatchEvent(new Event('change', { bubbles: true })); });
    }
    async function run(input, opts = {}, replacements = null) {
      $('pasteModeBtn').click();
      $('inputText').value = input;
      $('inputText').dispatchEvent(new Event('input', { bubbles: true }));
      choosePolicy(opts.groupPolicy || 'single');
      const t0 = performance.now();
      if (replacements) await window.__ipLinerTest.processWithOverrides([...replacements]); else $('runBtn').click();
      const start = performance.now();
      while (!['완료','사용자 확인 대기'].includes($('status').textContent)) {
        if (performance.now() - start > 90000) throw new Error('run timeout: ' + $('status').textContent);
        await new Promise(r => setTimeout(r, 20));
      }
      return { ms: Math.round(performance.now() - t0), status: $('status').textContent, stats: $('stats').textContent, output: window.__ipLinerTest.getLastOutput(), preview: $('output').textContent, log: $('log').textContent };
    }
    const out = {};
    out.title = document.title;
    out.heading = document.querySelector('h1').textContent;
    out.desc = document.querySelector('.desc').textContent;
    out.eyebrow = document.querySelector('.eyebrow')?.textContent || '';
    out.headerFontSize = getComputedStyle(document.querySelector('h1')).fontSize;
    out.initialVisible = [...document.querySelectorAll('main > section:not(.hidden)')].map(x => x.id);
    out.defaultAttach = $('attachMode').classList.contains('active') && $('attachModeBtn').classList.contains('active');
    out.hasDropZone = !!$('dropZone');
    out.rangeInitiallyHidden = $('rangePanel').classList.contains('hidden');
    out.hasTitlePill = !!document.querySelector('.pill');
    out.flowOrder = [...document.querySelectorAll('main > section')].map(x => x.id);
    out.panelBorders = [...document.querySelectorAll('.input-panel,.range-panel,.run-panel,.progress-panel,.log-panel,.output-panel,.trace-panel,.trace-result-panel')].map(x => getComputedStyle(x).borderTopWidth);
    out.traceHeading = document.querySelector('.trace-panel h2').textContent;
    out.progressHeading = document.querySelector('.progress-panel h2').textContent;
    out.logHeading = document.querySelector('.log-panel h2').textContent;
    out.hasAmbiguousPolicy = !!$('ambiguousPolicy');
    out.hasRangeFormat = !!$('rangeFormat');
    out.hasPreviewLimit = !!$('previewLimit');
    out.hasGroupSelect = !!$('groupPolicy');
    out.groupLabel = document.querySelector('.range-panel .section-title').textContent;
    out.groupOptions = [...document.querySelectorAll('.check-card strong')].map(o => o.textContent);
    out.groupOptionTexts = [...document.querySelectorAll('.check-card span')].map(o => o.textContent);
    out.buttonWidths = {
      attach: Math.round($('attachModeBtn').getBoundingClientRect().width),
      paste: Math.round($('pasteModeBtn').getBoundingClientRect().width),
      clear: null, run: null, copy: null, download: null, trace: null
    };
    const dragFile = new File(['10.10.10.1\\\\n10.10.10.2'], 'drag-targets.txt', { type: 'text/plain' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(dragFile);
    $('dropZone').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    for (let i = 0; i < 80 && !$('inputText').value.includes('10.10.10.2'); i++) await new Promise(r => setTimeout(r, 25));
    out.afterDragVisible = [...document.querySelectorAll('main > section:not(.hidden)')].map(x => x.id);
    out.afterDragText = $('inputText').value;
    out.afterDragProgressHidden = $('progressPanel').classList.contains('hidden');
    out.afterDragLogHidden = $('logPanel').classList.contains('hidden');
    $('clearBtn').click();
    $('dropZone').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    for (let i = 0; i < 80 && !$('inputText').value.includes('10.10.10.2'); i++) await new Promise(r => setTimeout(r, 25));
    out.afterClearDropText = $('inputText').value;
    out.afterClearDropVisible = [...document.querySelectorAll('main > section:not(.hidden)')].map(x => x.id);
    $('pasteModeBtn').click(); $('inputText').value='12.123.12.201/20\\n123.22.92.250/29'; $('inputText').dispatchEvent(new Event('input', { bubbles: true }));
    out.afterInputVisible = [...document.querySelectorAll('main > section:not(.hidden)')].map(x => x.id);
    out.buttonWidths.clear = Math.round($('clearBtn').getBoundingClientRect().width);
    choosePolicy('single');
    out.afterPolicyVisible = [...document.querySelectorAll('main > section:not(.hidden)')].map(x => x.id);
    out.buttonWidths.run = Math.round($('runBtn').getBoundingClientRect().width);
    out.normalizedCidr = await run('12.123.12.201/20\\n123.22.92.250/29', { groupPolicy: 'single' });
    out.buttonWidths.copy = Math.round($('copyBtn').getBoundingClientRect().width);
    out.buttonWidths.download = Math.round($('downloadBtn').getBoundingClientRect().width);
    $('traceInput').value = '12.123.0.5';
    $('traceInput').dispatchEvent(new Event('input', { bubbles: true }));
    out.buttonWidths.trace = Math.round($('traceBtn').getBoundingClientRect().width);
    out.logScroll = { top: $('log').scrollTop, height: $('log').scrollHeight, client: $('log').clientHeight };
    let downloadName = '';
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = () => 'blob:test';
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function(){ downloadName = this.download; };
    $('downloadBtn').click();
    HTMLAnchorElement.prototype.click = origClick;
    URL.createObjectURL = origCreate;
    out.downloadName = downloadName;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    out.scrollCalls = window.__scrollCalls.map(x => x.id).filter(Boolean);
    Element.prototype.scrollIntoView = originalScrollIntoView;
    out.single = await run('192.168.1.1,192.168.1.2\\n192.168.1.1', { groupPolicy: 'single' });
    out.cidr = await run('192.168.2.0/30\\n192.168.3.4/32\\n192.168.4.0/31', { groupPolicy: 'single' });
    out.tilde = await run('192.168.5.1~3\\nhttp://192.168.6.8:443', { groupPolicy: 'single' });
    out.expand = await run('192.168.1.3\\n192.168.1.23\\n192.168.1.233', { groupPolicy: 'expand' });
    out.subnet = await run('192.168.7.44', { groupPolicy: 'subnet' });
    out.manualWait = await run('192.168.0.999\\nabc', { groupPolicy: 'single' });
    out.manualRows = [...document.querySelectorAll('.confirmRow code')].map(x => x.textContent);
    out.manualReasons = [...document.querySelectorAll('.confirmRow .reason')].map(x => x.textContent).join('\\n');
    out.manualApplied = await run('192.168.0.999\\nabc', { groupPolicy: 'single' }, ['192.168.0.5', '']);
    out.logClasses = [...document.querySelectorAll('#log .log-line')].map(x => x.className);
    out.sample = await run(${JSON.stringify(sample)}, { groupPolicy: 'single' });
    const bytes = Uint8Array.from(atob('${sampleXlsxB64}'), c => c.charCodeAt(0));
    const file = new File([bytes], 'sample-excel-targets.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await window.__ipLinerTest.loadExcel(file);
    out.excelStats = $('excelStats').textContent;
    out.excelText = $('inputText').value;
    choosePolicy('expand');
    await window.__ipLinerTest.processWithOverrides(Array(20).fill(''));
    out.excelOutput = window.__ipLinerTest.getLastOutput();
    window.__ipLinerTest.traceIp('192.168.10.4');
    out.traceGap = window.__ipLinerTest.getTrace();
    window.__ipLinerTest.traceIp('192.168.20.3');
    out.traceRange = window.__ipLinerTest.getTrace();
    window.__ipLinerTest.traceIp('100.64.6.5');
    out.traceCidr = window.__ipLinerTest.getTrace();
    return out;
  })()`, 160000);

  assert.equal(results.title, 'IP Liner');
  assert.equal(results.heading, 'IP Liner');
  assert.match(results.desc, /단계/);
  assert.match(results.eyebrow, /IP 정리 도구/);
  assert.match(results.headerFontSize, /34px/);
  assert.deepEqual(results.initialVisible, ['inputPanel']);
  assert.equal(results.defaultAttach, true);
  assert.equal(results.hasDropZone, true);
  assert.equal(results.rangeInitiallyHidden, true);
  assert.equal(results.hasTitlePill, false);
  assert.deepEqual(results.flowOrder, ['inputPanel', 'rangePanel', 'runPanel', 'progressPanel', 'logPanel', 'outputPanel', 'tracePanel', 'traceResultPanel']);
  assert.deepEqual(results.panelBorders, ['1px', '1px', '1px', '1px', '1px', '1px', '1px', '1px']);
  assert.equal(results.traceHeading, '역추적');
  assert.equal(results.progressHeading, '진행률');
  assert.equal(results.logHeading, '처리 로그');
  assert.equal(results.hasAmbiguousPolicy, false);
  assert.equal(results.hasRangeFormat, false);
  assert.equal(results.hasPreviewLimit, false);
  assert.equal(results.hasGroupSelect, false);
  assert.equal(results.groupLabel, '범위 추가 선택');
  assert.deepEqual(results.groupOptions, ['범위 추가 선택 안함', '입력 구간만 확장', '대역 전체 추가']);
  assert.ok(results.groupOptionTexts.every(x => /예:/.test(x)));
  assert.ok(results.buttonWidths.clear >= results.buttonWidths.attach - 4);
  assert.ok(results.buttonWidths.run >= results.buttonWidths.attach - 4);
  assert.ok(Math.abs(results.buttonWidths.copy - results.buttonWidths.download) <= 4);
  assert.ok(results.buttonWidths.trace >= results.buttonWidths.attach - 4);
  assert.ok(results.logScroll.top + results.logScroll.client >= results.logScroll.height - 2);
  assert.equal(results.downloadName, 'ip-liner-targets.txt');
  assert.ok(results.scrollCalls.includes('rangePanel'));
  assert.ok(results.scrollCalls.includes('runPanel'));
  assert.ok(results.scrollCalls.includes('progressPanel'));
  assert.ok(results.scrollCalls.includes('outputPanel'));
  assert.deepEqual(results.afterDragVisible, ['inputPanel', 'rangePanel']);
  assert.match(results.afterDragText, /10\.10\.10\.2/);
  assert.equal(results.afterDragProgressHidden, true);
  assert.equal(results.afterDragLogHidden, true);
  assert.match(results.afterClearDropText, /10\.10\.10\.2/);
  assert.deepEqual(results.afterClearDropVisible, ['inputPanel', 'rangePanel']);
  assert.deepEqual(results.afterInputVisible, ['inputPanel', 'rangePanel']);
  assert.deepEqual(results.afterPolicyVisible, ['inputPanel', 'rangePanel', 'runPanel']);
  assert.match(results.normalizedCidr.output, /^12\.123\.0\.1/);
  assert.match(results.normalizedCidr.log, /CIDR 정규화: 12\.123\.12\.201\/20 → 12\.123\.0\.0\/20/);
  assert.match(results.normalizedCidr.output, /123\.22\.92\.249/);
  assert.equal(results.single.output, '192.168.1.1\n192.168.1.2');
  assert.equal(results.cidr.output, '192.168.2.1\n192.168.2.2\n192.168.3.4\n192.168.4.0\n192.168.4.1');
  assert.equal(results.tilde.output, '192.168.5.1\n192.168.5.2\n192.168.5.3\n192.168.6.8');
  assert.equal(results.expand.output.split('\n').length, 231);
  assert.match(results.expand.output, /^192\.168\.1\.3\n/);
  assert.match(results.expand.output, /\n192\.168\.1\.233$/);
  assert.match(results.expand.output, /192\.168\.1\.22/);
  assert.equal(results.subnet.output.split('\n').length, 256);
  assert.match(results.subnet.output, /^192\.168\.7\.0\n/);
  assert.match(results.subnet.output, /\n192\.168\.7\.255$/);
  assert.equal(results.manualWait.status, '사용자 확인 대기');
  assert.deepEqual(results.manualRows, ['192.168.0.999', 'abc']);
  assert.match(results.manualReasons, /잘못된 IP/);
  assert.equal(results.manualApplied.output, '192.168.0.5');
  assert.ok(results.logClasses.some(x => x.includes('bad')));
  assert.ok(results.logClasses.some(x => x.includes('ok')));
  assert.match(results.sample.stats, /최종 출력 IP/);
  assert.match(results.sample.log, /총 입력 건수: 5,000개/);
  assert.match(results.excelStats, /IP 후보/);
  assert.match(results.excelText, /192\.168\.20\.1-5/);
  assert.match(results.excelOutput, /192\.168\.10\.25/);
  assert.match(results.excelOutput, /100\.64\.4\.250/);
  assert.match(results.excelOutput, /100\.64\.5\.10/);
  assert.match(results.traceGap, /시트명: Audit Targets/);
  assert.match(results.traceGap, /셀번호: C2/);
  assert.match(results.traceGap, /직접 추출 IP 여부: 아니오/);
  assert.match(results.traceRange, /셀번호: C4/);
  assert.match(results.excelOutput, /100\.64\.6\.5/);
  assert.match(results.traceCidr, /셀번호: C6/);
  console.log(JSON.stringify({ ok: true, sampleMs: results.sample.ms, sampleStats: results.sample.stats, excelStats: results.excelStats }, null, 2));
}

try {
  await main();
} finally {
  try { ws?.close(); } catch {}
  chrome.kill('SIGTERM');
}
