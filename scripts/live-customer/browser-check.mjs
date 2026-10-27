import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.VELORA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.VELORA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage();
 const external=[];
 page.on('request',r=>{const url=new URL(r.url());if(url.protocol.startsWith('http')&&url.hostname!=='127.0.0.1')external.push(url.origin);});
 const readiness=await page.request.get('http://127.0.0.1:3330/api/billing/local-live-readiness');
 const diagnostic=await readiness.json();
 if(readiness.status()!==200||diagnostic.checkoutEnabled!==false||diagnostic.status!=='BLOCKED')throw Error('LOCAL_BLOCKER_REPORT_FAILED');
 const first=await page.goto('http://127.0.0.1:3330/login?next=%2Faccount%2Fbusinesses%2Fnew');
 await page.waitForLoadState('networkidle');
 const initial={status:first.status(),url:page.url(),title:await page.title(),text:(await page.locator('body').innerText()).slice(0,1700)};
 await page.reload();await page.waitForLoadState('networkidle');
 const refreshed={url:page.url(),text:(await page.locator('body').innerText()).slice(0,1700)};
 await page.screenshot({path:'artifacts/local-live-customer/local-login.png',fullPage:true});
 const result={time:new Date().toISOString(),diagnostic,initial,refreshed,externalOrigins:[...new Set(external)],paid:false,authenticated:false,providerRequests:external.filter(origin=>new URL(origin).hostname.endsWith('thawani.om')).length,limits:[diagnostic.configurationReady?'Credentials loaded server-side; no values inspected':'No credentials loaded','No authenticated customer acceptance','No real payment or provisioning','Refresh verifies unauthenticated entry only']};
 await writeFile('artifacts/local-live-customer/browser-evidence.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
} finally {await browser.close();}
