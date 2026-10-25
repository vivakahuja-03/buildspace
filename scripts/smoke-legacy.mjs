// Headless smoke test: bundles src/main.js, runs it in jsdom, visits every page and exercises key flows.
import { build } from 'esbuild'; import { JSDOM, VirtualConsole } from 'jsdom'; import fs from 'node:fs';
const out = await build({ entryPoints: ['legacy/src/main.js'], bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' }, define: { 'import.meta.env.VITE_SUPABASE_URL': '""', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '""' } });
const errs = [], vc = new VirtualConsole(); vc.on('jsdomError', (e) => errs.push(e.message)); vc.on('error', (m) => errs.push(String(m)));
const html = fs.readFileSync('legacy/index.html', 'utf8').replace(/<script[^>]*><\/script>/, '').replace(/<link[^>]*>/, '');
const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window; w.HTMLDialogElement.prototype.showModal = function () { this.open = true; }; w.HTMLDialogElement.prototype.close = function () { this.open = false; }; w.confirm = () => true;
w.fetch = w.fetch || (() => Promise.reject(new Error('no network in smoke test')));
try { w.eval(out.outputFiles[0].text); } catch (e) { errs.push('boot: ' + e.message); }
const $ = (s) => w.document.querySelector(s), fails = [], ok = (c, m) => { if (!c) fails.push(m); };
const go = async (h) => { w.location.hash = h; await new Promise((r) => setTimeout(r, 20)); };
const stored = () => JSON.parse(w.localStorage.getItem('buildspace-v1'));
const submit = (vals) => { const f = $('#f'); for (const [k, v] of Object.entries(vals)) f.elements[k].value = v; f.dispatchEvent(new w.Event('submit', { cancelable: true })); };
if (errs.length) { console.log('BOOT ERRORS', errs.slice(0, 3)); process.exit(1); }
for (const p of ['Overview', 'Projects', 'Schedule', 'Tasks', 'Team', 'Materials', 'Budget', 'Documents', 'Reports', 'Settings']) { await go(p); const t = $('#pg').textContent; ok(t.length > 20 && !/undefined|NaN/.test(t), 'page ' + p + ' empty or has undefined/NaN'); }
await go('Project/1'); for (const t of ['Overview', 'Tasks', 'Schedule', 'Team', 'Materials', 'Budget', 'Documents', 'Activity']) { w.setTab(t); ok(!/undefined|NaN/.test($('#pg').textContent), 'project tab ' + t); }
await go('Materials'); const before = 1800; w.mv(1, 'in'); submit({ q: '5' }); ok(stored().I[0].qty === before + 5, 'receive stock updates qty');
w.mv(1, 'out'); submit({ q: '999999', p: '1' }); ok(stored().I[0].qty === before + 5, 'over-consumption blocked');
w.addE(); const n = stored().E.length; submit({ p: '1', cat: 'Labor', vendor: 'Test', date: '2026-10-01', amt: '1000', status: 'Paid' }); ok(stored().E.length === n + 1, 'expense added');
w.editT(2); submit({ title: 'Foundation excavation', p: '1', who: 'Imran Ali', start: '2026-03-02', due: '2026-05-15', pct: '100', dep: '3' }); ok(stored().T.find((t) => t.id === 2).dep === 1, 'circular dependency rejected');
w.dropT({ preventDefault() {}, dataTransfer: { getData: () => '4' } }, 'In Progress'); ok(stored().T.find((t) => t.id === 4).status === 'In Progress', 'drag-drop changes status');
w.showN(); ok($('#dl').textContent.includes('Notifications'), 'notifications open');
console.log(errs.length || fails.length ? 'SMOKE FAIL\n' + [...errs, ...fails].join('\n') : 'SMOKE OK');
process.exit(errs.length || fails.length ? 1 : 0);
