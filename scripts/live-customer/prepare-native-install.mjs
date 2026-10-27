// Produces a reviewable installer outside Git. Does not connect to a database.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const directory=join(process.env.LOCALAPPDATA,'Velora','LocalCustomer');
const approval=JSON.parse(await readFile(join(directory,'one-order-approval.json'),'utf8'));
if(approval.AccountId!=='177ef439-3fb0-4e3e-96b8-2a9e8661386d'||approval.AmountBaisa!==100||approval.Currency!=='OMR'||approval.MaxOrders!==1||approval.Environment!=='live'||!/^\w{8}-\w{4}-4\w{3}-[89ab]\w{3}-\w{12}$/i.test(approval.GrantId)||!Number.isFinite(Date.parse(approval.ApprovedAt)))throw Error('EXPLICIT_ONE_ORDER_APPROVAL_REQUIRED');
const names=['native-live-candidate.sql','native-knowledge-candidate.sql'];
const parts=await Promise.all(names.map(async name=>(await readFile(join('scripts/live-customer',name),'utf8')).replaceAll('\r\n','\n').replace(/^\s*(begin|commit);\s*$/gmi,'')));
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const grant=`insert into private.es02_thawani_live_grants(id,account_id,enabled,amount_baisa,currency,approved_at,expires_at) values(${literal(approval.GrantId)}::uuid,${literal(approval.AccountId)}::uuid,true,100,'OMR',${literal(approval.ApprovedAt)}::timestamptz,${literal(approval.ApprovedAt)}::timestamptz+interval '7 days');`;
const source=['-- EXPLICIT DATABASE INSTALLATION APPROVAL REQUIRED. No payment or business success is manufactured.','begin;','set local role postgres;',...parts,grant,"notify pgrst, 'reload schema';",'commit;',''].join('\n');
const path=join(directory,'native-install.review.sql');await writeFile(path,source);
const sha256=createHash('sha256').update(source).digest('hex');
await writeFile('artifacts/local-live-customer/native-install-manifest.json',JSON.stringify({sha256,files:names,amountBaisa:100,currency:'OMR',maximumOrders:1,live:true,hostedApplied:false,webhookChanges:false},null,2));
console.log(JSON.stringify({status:'REVIEW_ONLY_NOT_APPLIED',sha256,maximumOrders:1,amountBaisa:100,currency:'OMR',webhookChanges:false}));
