import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const source=()=>fs.readFileSync(new URL('./install.js',import.meta.url),'utf8');
function setup(){
 const dom=new JSDOM('<main data-auth-entry-shell></main>',{url:'https://www.velorahelper.com/verify-email?email=private@example.test',runScripts:'outside-only'});
 const w=dom.window;w.console.info=()=>{};w.fetch=async()=>({status:200});w.eval(source());return {dom,w};
}
test('records safe timing without OTP, email, headers, payload or arbitrary console fields',async()=>{
 const {dom,w}=setup();
 const result=await w.fetch('/verify-email?email=private@example.test',{method:'POST',body:'PRIVATE-OTP-654321',headers:{cookie:'PRIVATE-COOKIE'}});
 assert.equal(result.status,200);
 w.console.info(JSON.stringify({service:'velora.auth',operation:'auth_verification',stage:'refresh',code:'STARTED',request_id:'VEL-AAAAAAAAAAAAAAAA',trace_id:'b'.repeat(32),span_id:'c'.repeat(16),duration_ms:123,secret:'PRIVATE-TOKEN'}));
 const text=JSON.stringify(w.veloraAuthTiming.report());
 for(const value of ['private@example.test','PRIVATE-OTP','654321','PRIVATE-COOKIE','PRIVATE-TOKEN'])assert.equal(text.includes(value),false);
 assert.match(text,/VEL-AAAAAAAAAAAAAAAA/);assert.match(text,/fetch_headers/);assert.match(text,/refresh/);
 w.veloraAuthTiming.stop();dom.window.close();
});
test('restores wrapped APIs and never sends a request itself',()=>{
 const dom=new JSDOM('',{url:'https://www.velorahelper.com/login',runScripts:'outside-only'}),w=dom.window;
 let calls=0;const fetch=w.fetch=async()=>{calls++;return {status:200};},info=w.console.info=()=>{},replace=w.history.replaceState;
 w.eval(source());w.eval(source());assert.equal(calls,0);
 w.veloraAuthTiming.stop();assert.equal(w.fetch,fetch);assert.equal(w.console.info,info);assert.equal(w.history.replaceState,replace);dom.window.close();
});
test('marks visible destination and persists only its own sanitized records',async()=>{
 const {dom,w}=setup();w.history.replaceState(null,'','/setup');w.document.body.innerHTML='<main data-setup-studio="true"></main>';
 await new Promise(r=>setTimeout(r,5));
 const report=w.veloraAuthTiming.report();assert.ok(report.events.some(e=>e.event==='destination_content'));
 w.dispatchEvent(new w.Event('pagehide'));assert.ok(w.sessionStorage.getItem('velora.auth.timing.v1'));
 w.veloraAuthTiming.stop();dom.window.close();
});
