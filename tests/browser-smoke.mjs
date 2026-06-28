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
      document.querySelectorAll('input[name="scopeItemCheck"]:checked').forEach(cb => {
        const sel = document.querySelector('select[name="scopePolicy"][data-scope-key="' + CSS.escape(cb.value) + '"]');
        if (sel) { sel.disabled = false; sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      });
    }
    function chooseScopeMode(v) { /* kept for older test call sites; per-scope policies now drive execution */ }
    function uncheckScope(value) {
      const cb = [...document.querySelectorAll('input[name="scopeItemCheck"]')].find(x => x.value === value);
      if (cb) { cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    function setScopePolicy(value, policy) {
      const cb = [...document.querySelectorAll('input[name="scopeItemCheck"]')].find(x => x.value === value);
      if (cb) cb.checked = true;
      const sel = document.querySelector('select[name="scopePolicy"][data-scope-key="' + CSS.escape(value) + '"]');
      if (sel) { sel.disabled = false; sel.value = policy; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    function selectAllScopes() {
      document.querySelectorAll('input[name="scopeItemCheck"]').forEach(cb => { cb.checked = true; });
    }
    async function run(input, opts = {}, replacements = null) {
      $('pasteModeBtn').click();
      $('inputText').value = input;
      $('inputText').dispatchEvent(new Event('input', { bubbles: true }));
      if (opts.manualScope != null) { $('customInternalInput').value = opts.manualScope; $('customInternalInput').dispatchEvent(new Event('input', { bubbles: true })); }
      if (!opts.noAutoScope) selectAllScopes();
      if (!opts.noAutoScope || opts.scopeMode) chooseScopeMode(opts.scopeMode || 'both');
      (opts.uncheckScopes || []).forEach(uncheckScope);
      choosePolicy(opts.groupPolicy || 'single');
      const t0 = performance.now();
      if (replacements) await window.__ipLinerTest.processWithOverrides([...replacements]); else $('runBtn').click();
      const start = performance.now();
      while (!['완료','사용자 확인 대기','스캔 대상 없음'].includes($('status').textContent)) {
        if (performance.now() - start > 90000) throw new Error('run timeout: ' + $('status').textContent);
        await new Promise(r => setTimeout(r, 20));
      }
      return { ms: Math.round(performance.now() - t0), status: $('status').textContent, stats: $('stats').textContent, output: window.__ipLinerTest.getLastOutput(), preview: $('output').textContent, log: $('log').textContent, scopeSummary: $('scopeSummary').textContent };
    }
    const out = {};
    out.title = document.title;
    out.heading = document.querySelector('h1').textContent;
    out.desc = document.querySelector('.desc').textContent;
    out.eyebrow = document.querySelector('.eyebrow')?.textContent || '';
    out.headerFontSize = getComputedStyle(document.querySelector('h1')).fontSize;
    out.initialVisible = [...document.querySelectorAll('main > section:not(.hidden)')].map(x => x.id);
    out.defaultAttach = $('attachMode').classList.contains('active') && $('attachModeBtn').classList.contains('active');
    out.defaultDark = !document.body.classList.contains('light') && $('darkThemeBtn').classList.contains('active');
    $('lightThemeBtn').click();
    out.lightMode = document.body.classList.contains('light') && $('lightThemeBtn').classList.contains('active');
    $('darkThemeBtn').click();
    out.hasDropZone = !!$('dropZone');
    out.hasRangePanel = !!$('rangePanel');
    out.rangeInitiallyHidden = !$('rangePanel') || $('rangePanel').classList.contains('hidden');
    out.hasTitlePill = !!document.querySelector('.pill');
    out.flowOrder = [...document.querySelectorAll('main > section')].map(x => x.id);
    out.panelBorders = [...document.querySelectorAll('.input-panel,.scope-panel,.run-panel,.progress-panel,.log-panel,.output-panel,.trace-panel,.trace-result-panel')].map(x => getComputedStyle(x).borderTopWidth);
    out.traceHeading = document.querySelector('.trace-panel h2').textContent;
    out.progressHeading = document.querySelector('.progress-panel h2').textContent;
    out.logHeading = document.querySelector('.log-panel h2').textContent;
    out.hasAmbiguousPolicy = !!$('ambiguousPolicy');
    out.hasRangeFormat = !!$('rangeFormat');
    out.hasPreviewLimit = !!$('previewLimit');
    out.hasGroupSelect = !!$('groupPolicy');
    out.scopeInitiallyHidden = $('scopePanel').classList.contains('hidden');
    out.scopeLabel = document.querySelector('.scope-panel .section-title').textContent;
    out.scopeModeOptions = [...document.querySelectorAll('input[name="scopeMode"]')].map(o => o.value);
    out.initialScopeModes = [...document.querySelectorAll('input[name="scopeMode"]')].map(o => o.checked);
    out.bulkPolicyButtons = [...document.querySelectorAll('[data-bulk-policy]')].map(o => o.dataset.bulkPolicy);
    const no = document.querySelector('.step-no');
    const noStyle = getComputedStyle(no);
    out.stepNoStyle = { display: noStyle.display, alignItems: noStyle.alignItems, justifyContent: noStyle.justifyContent, width: noStyle.width, height: noStyle.height, lineHeight: noStyle.lineHeight };
    out.groupLabel = document.querySelector('.range-panel .section-title')?.textContent || '';
    out.groupOptions = [...document.querySelectorAll('.range-panel .check-card strong')].map(o => o.textContent);
    out.groupOptionTexts = [...document.querySelectorAll('.range-panel .check-card span')].map(o => o.textContent);
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
    out.scopeSummary = $('scopeSummary').textContent;
    out.buttonWidths.clear = Math.round($('clearBtn').getBoundingClientRect().width);
    out.scopeChecks = [...document.querySelectorAll('input[name="scopeItemCheck"]')].map(x => ({ value: x.value, checked: x.checked }));
    out.scopePoliciesAfterInput = [...document.querySelectorAll('select[name="scopePolicy"]')].map(x => ({ value: x.value, disabled: x.disabled }));
    selectAllScopes();
    chooseScopeMode('both');
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
    out.outputStyle = { maxHeight: getComputedStyle($('output')).maxHeight, marginBottom: getComputedStyle($('output')).marginBottom };
    let downloadName = '';
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = () => 'blob:test';
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function(){ downloadName = this.download; };
    $('downloadBtn').click();
    out.downloadStatus = $('outputActionStatus').textContent;
    const origClipboard = navigator.clipboard;
    let copiedText = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copiedText = text; } } });
    await $('copyBtn').click();
    out.copyStatus = $('outputActionStatus').textContent;
    out.copiedText = copiedText;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: origClipboard });
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
    out.scopeUncheck = await run('203.0.113.10\\n203.0.113.20\\n192.168.8.44', { groupPolicy: 'subnet', uncheckScopes: ['203.0.113.0/24'] });
    out.maskExcluded = await run('255.255.255.0\\n255.255.255.30', { groupPolicy: 'subnet', noAutoScope: true });
    $('pasteModeBtn').click(); $('inputText').value='100.64.4.10'; $('inputText').dispatchEvent(new Event('input', { bubbles: true }));
    $('customInternalInput').value='100.64.0.0/10\\n12.123.0.0/16'; $('customInternalInput').dispatchEvent(new Event('input', { bubbles: true }));
    out.customInternalVisible = [...document.querySelectorAll('main > section:not(.hidden)')].map(x => x.id);
    out.preInfoAllowed = await run('12.123.12.201/20', { groupPolicy: 'subnet', manualScope: '100.64.0.0/10\\n12.123.0.0/16', scopeMode: 'both' });
    out.invalidExcluded = await run('192.168.0.999\\nabc\\n192.168.0.5', { groupPolicy: 'single' });
    $('pasteModeBtn').click(); $('inputText').value='10.0.1.1\\n10.0.1.3\\n10.0.2.4'; $('inputText').dispatchEvent(new Event('input', { bubbles: true }));
    setScopePolicy('10.0.1.0/24', 'expand');
    setScopePolicy('10.0.2.0/24', 'subnet');
    await window.__ipLinerTest.processWithOverrides(null);
    out.mixedPolicy = { output: window.__ipLinerTest.getLastOutput(), log: $('log').textContent };
    out.logClasses = [...document.querySelectorAll('#log .log-line')].map(x => x.className);
    out.sample = await run(${JSON.stringify(sample)}, { groupPolicy: 'single' });
    const bytes = Uint8Array.from(atob('${sampleXlsxB64}'), c => c.charCodeAt(0));
    const file = new File([bytes], 'sample-excel-targets.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await window.__ipLinerTest.loadExcel(file);
    out.excelStats = $('excelStats').textContent;
    out.excelText = $('inputText').value;
    window.__ipLinerTest.analyzeInputScopes();
    selectAllScopes();
    chooseScopeMode('both');
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
  assert.match(results.desc, /필요한 범위/);
  assert.match(results.eyebrow, /IP 정리 도구/);
  assert.match(results.headerFontSize, /30px/);
  assert.deepEqual(results.initialVisible, ['inputPanel']);
  assert.equal(results.defaultAttach, true);
  assert.equal(results.defaultDark, true);
  assert.equal(results.lightMode, true);
  assert.equal(results.hasDropZone, true);
  assert.equal(results.hasRangePanel, false);
  assert.equal(results.rangeInitiallyHidden, true);
  assert.equal(results.hasTitlePill, false);
  assert.deepEqual(results.flowOrder, ['inputPanel', 'scopePanel', 'runPanel', 'progressPanel', 'logPanel', 'outputPanel', 'tracePanel', 'traceResultPanel']);
  assert.deepEqual(results.panelBorders, ['1px', '1px', '1px', '1px', '1px', '1px', '1px', '1px']);
  assert.equal(results.traceHeading, '역추적');
  assert.equal(results.progressHeading, '결과 / 로그 확인');
  assert.equal(results.logHeading, '처리 로그');
  assert.equal(results.hasAmbiguousPolicy, false);
  assert.equal(results.hasRangeFormat, false);
  assert.equal(results.hasPreviewLimit, false);
  assert.equal(results.hasGroupSelect, false);
  assert.equal(results.scopeInitiallyHidden, true);
  assert.equal(results.scopeLabel, '입력값 IP 대역 확인');
  assert.deepEqual(results.scopeModeOptions, []);
  assert.deepEqual(results.initialScopeModes, []);
  assert.deepEqual(results.bulkPolicyButtons, ['single', 'expand', 'subnet']);
  assert.equal(results.stepNoStyle.display, 'flex');
  assert.equal(results.stepNoStyle.alignItems, 'center');
  assert.equal(results.stepNoStyle.justifyContent, 'center');
  assert.equal(results.groupLabel, '');
  assert.deepEqual(results.groupOptions, []);
  assert.deepEqual(results.groupOptionTexts, []);
  assert.ok(results.buttonWidths.clear >= results.buttonWidths.attach - 4);
  assert.ok(results.buttonWidths.run >= results.buttonWidths.attach - 4);
  assert.ok(Math.abs(results.buttonWidths.copy - results.buttonWidths.download) <= 4);
  assert.ok(results.buttonWidths.trace >= results.buttonWidths.attach - 4);
  assert.ok(results.logScroll.top + results.logScroll.client >= results.logScroll.height - 2);
  assert.equal(results.outputStyle.maxHeight, '360px');
  assert.equal(results.outputStyle.marginBottom, '12px');
  assert.match(results.downloadName, /^ip-liner-targets-\d{8}-\d{6}\.txt$/);
  assert.match(results.downloadStatus, /^다운로드 파일명: ip-liner-targets-\d{8}-\d{6}\.txt$/);
  assert.equal(results.copyStatus, '클립보드에 복사되었습니다.');
  assert.match(results.copiedText, /^12\.123\.0\.1/);
  assert.ok(results.scrollCalls.includes('progressPanel'));
  assert.ok(results.scrollCalls.includes('outputPanel'));
  assert.deepEqual(results.afterDragVisible, ['inputPanel', 'scopePanel']);
  assert.match(results.afterDragText, /10\.10\.10\.2/);
  assert.equal(results.afterDragProgressHidden, true);
  assert.equal(results.afterDragLogHidden, true);
  assert.match(results.afterClearDropText, /10\.10\.10\.2/);
  assert.deepEqual(results.afterClearDropVisible, ['inputPanel', 'scopePanel']);
  assert.deepEqual(results.afterInputVisible, ['inputPanel', 'scopePanel']);
  assert.match(results.scopeSummary, /스캔 대상 후보/);
  assert.equal(results.scopeSummary.includes('감지값'), false);
  assert.ok(results.scopeChecks.some(x => x.value === '12.123.0.0/20' && !x.checked));
  assert.ok(results.scopeChecks.every(x => !x.checked));
  assert.ok(results.scopePoliciesAfterInput.every(x => x.value === '' && x.disabled));
  assert.deepEqual(results.afterPolicyVisible, ['inputPanel', 'scopePanel', 'runPanel']);
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
  assert.equal(results.scopeUncheck.output.split('\n').length, 256);
  assert.match(results.scopeUncheck.output, /^192\.168\.8\.0\n/);
  assert.doesNotMatch(results.scopeUncheck.output, /203\.0\.113/);
  assert.match(results.scopeUncheck.stats, /대상 제외 2개/);
  assert.equal(results.maskExcluded.output, '');
  assert.equal(results.maskExcluded.status, '스캔 대상 없음');
  assert.match(results.maskExcluded.scopeSummary, /255\.255\.255\.0/);
  assert.match(results.maskExcluded.scopeSummary, /255\.255\.255\.30/);
  assert.deepEqual(results.customInternalVisible, ['inputPanel', 'scopePanel']);
  assert.match(results.preInfoAllowed.log, /12\.123\.0\.0\/20=대역 전체 추가/);
  assert.match(results.preInfoAllowed.log, /100\.64\.0\.0\/10=대역 전체 추가/);
  assert.equal(results.invalidExcluded.output, '192.168.0.5');
  assert.match(results.invalidExcluded.log, /자동 제외: 192\.168\.0\.999/);
  assert.match(results.mixedPolicy.output, /^10\.0\.1\.1\n10\.0\.1\.2\n10\.0\.1\.3\n10\.0\.2\.0\n/);
  assert.match(results.mixedPolicy.output, /\n10\.0\.2\.255$/);
  assert.match(results.mixedPolicy.log, /10\.0\.1\.0\/24: 입력 구간만 확장 적용/);
  assert.match(results.mixedPolicy.log, /10\.0\.2\.0\/24: 대역 전체 추가 적용/);
  assert.ok(results.logClasses.some(x => x.includes('warn')));
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
  assert.match(results.traceGap, /원본 직접 추출/);
  assert.match(results.traceGap, /아니오/);
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
