// Local browser smoke only. No credentials, remote traffic or sign-in submission.
import {createRequire} from "node:module";
import {mkdirSync} from "node:fs";
import {resolve,join} from "node:path";
const origin=new URL(process.argv[2]??"http://127.0.0.1:3108");
if(origin.protocol!=="http:"||!["127.0.0.1","localhost"].includes(origin.hostname)||origin.username||origin.password||origin.pathname!=="/")throw Error("LOCAL_ORIGIN_REQUIRED");
const bundle=join(process.env.USERPROFILE,".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json");
const {chromium}=createRequire(bundle)("playwright");
const browser=await chromium.launch({headless:true,channel:"chrome"});
const directory=resolve("artifacts/overnight-preview");mkdirSync(directory,{recursive:true});
let passed=0,failed=0;
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.route("**/*",route=>{const url=new URL(route.request().url());return url.origin===origin.origin?route.continue():route.abort();});
 for(const [name,path,mobile] of [["home-desktop","/",false],["login-desktop","/login",false],["login-mobile","/login",true],["conversation-access-guard","/app/conversations",false]]){
  const page=await context.newPage();const errors=[];page.on("pageerror",error=>errors.push(error.message));
  try{if(mobile)await page.setViewportSize({width:390,height:844});const response=await page.goto(new URL(path,origin).href,{waitUntil:"networkidle",timeout:60_000});
   const body=await page.locator("body").innerText();if(!response||response.status()>=500||body.trim().length<20)throw Error("PAGE_UNAVAILABLE");
   if(path==="/login"&&await page.locator("input[type=password]").count()!==1)throw Error("LOGIN_FORM_MISSING");
   if(path.startsWith("/app/")&&!(/login/.test(page.url())||/الخدمة غير متاحة|تسجيل الدخول|الوصول|Sign in|Unavailable/i.test(body)))throw Error("ANONYMOUS_ACCESS_NOT_GATED");
   if(errors.length)throw Error("CLIENT_RUNTIME_ERROR");await page.screenshot({path:join(directory,`${name}.png`),fullPage:true});passed++;console.log(`PASS|${name}`);
  }catch(error){failed++;console.log(`FAIL|${name}|${error.message}`);await page.screenshot({path:join(directory,`${name}-failed.png`),fullPage:true}).catch(()=>{});}
  finally{await page.close();}
 }
 await context.close();
}finally{await browser.close();}
console.log("LOCAL_BROWSER_SMOKE",JSON.stringify({passed,failed,notRun:0,screenshots:directory,authenticatedJourney:"NOT_RUN: local Supabase Auth not provisioned"}));if(failed)process.exitCode=1;
