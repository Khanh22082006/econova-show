const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({width: 1920, height: 1080});
  
  // Test screen.html
  await page.goto('http://localhost:39281/screen.html', {waitUntil: 'networkidle2'});
  await page.evaluate(() => { document.getElementById('startScreen').click(); });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({path: 'scr_v3_screen.png'});
  
  await browser.close();
})();
