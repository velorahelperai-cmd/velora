import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

export async function measurePassageScale(stack){
 await stack.verify();
 assert.equal(stack.database,'c1_ui_integration');
 // The SQL has its own 180s bound; allow cleanup/output beyond that deadline.
 // Only this owned disposable database is targeted, without credentials in argv.
 return new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i','-u','postgres',stack.names.postgres,'psql','-X','-U','supabase_admin',
   '-d',stack.database,'-Atq','-v','ON_ERROR_STOP=1'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='',errors='',settled=false;
  const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){reject(error);}else{resolve(output.trim());}};
  const timer=setTimeout(()=>{child.kill();finish(Error('PASSAGE_SCALE_TRANSPORT_TIMEOUT'));},210000);
  child.stdout.on('data',chunk=>{output+=chunk;});
  child.stderr.on('data',chunk=>{errors+=chunk;});
  child.on('error',finish);
  child.on('close',code=>finish(code===0?undefined:Error(stack.redact(errors)||'PASSAGE_SCALE_FAILED')));
  child.stdin.on('error',()=>{});
  child.stdin.end(readFileSync('scripts/performance/knowledge-passages-scale.sql','utf8'));
 });
}
