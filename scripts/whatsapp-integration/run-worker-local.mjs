// Offline verification of the actual webhook/consumer route. Never a live runner.
import {spawn} from "node:child_process";
import {verify} from "./postgres.mjs";
if(process.argv.length!==3||process.argv[2]!=="--fixtures-only")throw Error("Use --fixtures-only; live worker execution is not supported here");
await verify();
const child=spawn(process.execPath,["node_modules/vitest/vitest.mjs","run","src/lib/whatsapp/runtime-route-postgres.test.ts","--reporter=verbose"],{
 windowsHide:true,stdio:"inherit",env:{...process.env,C2_RUNTIME_POSTGRES_TESTS:"1",OPENAI_API_KEY:"",GEMINI_API_KEY:"",GOOGLE_API_KEY:"",WHATSAPP_ACCESS_TOKEN:"",WHATSAPP_ALLOW_EXTERNAL_SEND:"false",WHATSAPP_WORKER_ENABLED:"false"},
});
child.on("error",()=>{process.exitCode=1;});child.on("close",code=>{process.exitCode=code??1;});
