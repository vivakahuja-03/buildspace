// Headless smoke test of the React app: bundles src/main.tsx, boots it in jsdom, visits every route and checks key flows.
// Needs the project's own dev dependencies (esbuild, jsdom). Run: npm run smoke
import { build } from 'esbuild'; import { JSDOM, VirtualConsole } from 'jsdom'; import fs from 'node:fs';
const out = await build({ entryPoints: ['src/main.tsx'], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
  define: { 'import.meta.env.VITE_SUPABASE_URL': '""', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '""', 'process.env.NODE_ENV': '"development"' } });
const errs = [], fails = [], vc = new VirtualConsole();
vc.on('jsdomError', (e) => errs.push(e.message)); vc.on('error', (m) => errs.push(String(m).slice(0, 300)));
const html = fs.readFileSync('index.html', 'utf8').replace(/<script[^>]*><\/script>/, '');
const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window; w.confirm = () => true; w.print = () => {}; w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
w.HTMLElement.prototype.scrollTo = function () {}; w.HTMLElement.prototype.scrollBy = function () {};
w.IS_REACT_ACT_ENVIRONMENT = false;
try { w.eval(out.outputFiles[0].text); } catch (e) { errs.push('boot: ' + e.message); }
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms)), $ = (s) => w.document.querySelector(s), ok = (c, m) => { if (!c) fails.push(m); };
const go = async (h) => { w.location.hash = h; await wait(); };
await wait(100);
ok(w.document.querySelector('#main'), 'app shell rendered');
const ROUTES = ['/', '/projects', '/projects/1', '/schedule', '/tasks', '/team', '/materials', '/budget', '/documents', '/reports', '/settings', '/search?q=cement', '/nope'];
for (const r of ROUTES) { await go('#' + r); const t = $('#main')?.textContent ?? ''; ok(t.length > 15, `${r} renders content`); ok(!/undefined|NaN|\[object/.test(t), `${r} shows no undefined/NaN`); ok(!$('[role=alert]') || r === '/nope' || !/unexpected error/.test($('[role=alert]').textContent), `${r} has no error boundary`); }
// mobile menu toggle
const menu = w.document.querySelector('button[aria-controls="main-nav"]'); ok(menu, 'mobile menu button exists');
menu?.click(); await wait(); ok(menu?.getAttribute('aria-expanded') === 'true', 'menu opens');
// data survives a store write
await go('#/settings'); const sel = w.document.querySelector('select'); ok(sel, 'settings controls render');
const stored = () => JSON.parse(w.localStorage.getItem('buildspace-v1') ?? '{}'); ok(Array.isArray(stored().P) && stored().P.length > 0, 'data persisted to localStorage');
console.log(errs.length || fails.length ? 'SMOKE FAIL\n' + [...errs, ...fails].join('\n') : 'SMOKE OK');
process.exit(errs.length || fails.length ? 1 : 0);
