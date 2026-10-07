import { createRequire } from 'node:module';
const { chromium } = createRequire('C:/Users/user/Neo-Luddite/package.json')('playwright');
import { pathToFileURL } from 'node:url';

const [, , htmlPath, pdfPath] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.pdf({
  path: pdfPath,
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: `<div style="width:100%;font-size:8px;color:#7a746a;padding:0 20mm 0 22mm;display:flex;justify-content:space-between;font-family:'Noto Sans KR',sans-serif">
    <span>그럴듯하게 틀리는 것들 — AI 상담 챗봇 현장 백서</span><span class="pageNumber"></span></div>`,
});
await browser.close();
