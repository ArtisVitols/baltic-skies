// Screenshot the loading screen part-way through: node tools/early.mjs out.png ms
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const puppeteer = require('/home/artis/PROJECTS/mcqueen/tools/node/node_modules/puppeteer-core');
const [, , out = 'early.png', ms = '1500'] = process.argv;
const browser = await puppeteer.launch({ executablePath: `${process.env.HOME}/.local/chrome/chrome-headless-shell-linux64/chrome-headless-shell`, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'], protocolTimeout: 600000 });
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390 });
await page.goto(`http://localhost:${process.env.PORT || 8123}/index.html`, { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, +ms));
await page.screenshot({ path: out });
await browser.close();
