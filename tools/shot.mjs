// Screenshot driver: node tools/shot.mjs <url-query> <out.png> [waitMs] [js-to-eval-after-load]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER || '/home/artis/PROJECTS/mcqueen/tools/node/node_modules/puppeteer-core');
const [, , query = '', out = 'shot.png', waitMs = '4000', js = '', w = '915', h = '412'] = process.argv;
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || `${process.env.HOME}/.local/chrome/chrome-headless-shell-linux64/chrome-headless-shell`,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const port = process.env.PORT || 8123;
const t0 = Date.now();
await page.goto(`${process.env.BASE || `http://localhost:${port}/index.html`}?shot&fast&${query}`, { waitUntil: 'load', timeout: 600000 });
await page.waitForFunction(() => window.game && window.game.state !== 'loading', { timeout: 600000 }).catch((e) => logs.push('wait failed ' + e.message));
logs.push(`loaded in ${Date.now() - t0} ms`);
if (js) { const r = await page.evaluate(js).catch((e) => 'eval error ' + e.message); if (r !== undefined) logs.push('eval: ' + JSON.stringify(r)); }
await new Promise((r) => setTimeout(r, +waitMs));
await page.screenshot({ path: out });
console.log([...new Set(logs)].slice(0, 60).join('\n'));
await browser.close();
