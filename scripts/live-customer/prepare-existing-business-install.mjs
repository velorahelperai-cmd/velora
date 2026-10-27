// Prepares a review artifact only. Never connects to a database or loads keys.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
const root=resolve(process.env.LOCALAPPDATA??'','Velora','LocalCustomer');
if(!process.env.LOCALAPPDATA)throw Error('LOCAL_CONFIG_ROOT_REQUIRED');
const file='scripts/live-customer/existing-business-live.sql';
const sql=await readFile(file,'utf8');
const digest=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
const receipt=await readFile('.git/velora-release/LOCAL-LIVE-CUSTOMER-20261026/existing-business-regression.json','utf8').then(JSON.parse).catch(()=>null);
if(!receipt)throw Error('EXACT_NATIVE_TRANSACTION_TEST_PASS_REQUIRED');
if(receipt.status!=='PASS'||receipt.inputsStable!==true||receipt.providerRequests!==0||receipt.hostedWrites!==0||receipt.concurrentConnections!==4||receipt.independentNativeSessions!==4||receipt.observedWaiters<3
 ||receipt.actions?.filter(a=>a==='provisioned').length!==1||receipt.actions?.filter(a=>a==='reuse').length!==3
 ||receipt.sqlSha256!==await digest(file)
 ||receipt.testSha256!==await digest('scripts/live-customer/existing-business-regression.sql')
 ||receipt.runnerSha256!==await digest('scripts/live-customer/existing-business-regression.mjs'))throw Error('EXACT_NATIVE_TRANSACTION_TEST_PASS_REQUIRED');
const target={account:'177ef439-3fb0-4e3e-96b8-2a9e8661386d',order:'b96b2411-7525-463e-80a8-cdee621e4785',company:'40d2d885-8b63-49c4-b3da-d2e9566f2750',branch:'a268f9d8-fe5b-41b2-a337-97046a5eaa5c',testOrder:'a4a71659-8922-4add-b9e6-b3aeeea7b1cd'};
const insert=`
-- Exact human-reviewed binding authorization only; does not provision or mutate
-- a company, charge, subscription, rights projection or clock at installation.
do $target_guard$begin
 if current_database()<>'postgres' then raise exception 'HOSTED_DATABASE_MISMATCH';end if;
 if not exists(select 1 from private.es02_account_orders o join private.es02_thawani_live_checkouts c on c.order_id=o.id
  where o.id='${target.order}' and o.account_id='${target.account}' and o.status='settled' and o.provisioned_company_id is null
  and o.environment='live' and c.state='paid' and c.collected_baisa=100 and c.currency='OMR'
  and private.es02_verified_live_catalog_order(o)) then raise exception 'REVIEWED_LIVE_PAYMENT_SCOPE_CHANGED';end if;
 if not exists(select 1 from private.es02_activation_foundation a join private.es02_account_orders o on o.id=a.order_id
  join public.company_members m on m.company_id=a.company_id and m.user_id=a.account_id and m.role='owner' and m.status='active'
  join public.company_branches b on b.company_id=a.company_id and b.is_primary
  where a.company_id='${target.company}' and a.account_id='${target.account}' and o.id='${target.testOrder}' and o.environment='test'
  and o.status='provisioned' and o.provisioned_company_id=a.company_id and b.id='${target.branch}'
  and a.clock_state='waiting_readiness' and a.subscription_started_at is null and a.paid_through_at is null) then raise exception 'REVIEWED_TEST_COMPANY_SCOPE_CHANGED';end if;
 if to_regclass('public.company_members_one_active_owner_per_user') is null then raise exception 'OWNER_INDEX_CHANGED';end if;
end $target_guard$;
insert into private.es02_existing_live_targets(order_id,account_id,company_id,branch_id,test_order_id)
values('${target.order}','${target.account}','${target.company}','${target.branch}','${target.testOrder}');
commit;
`;
if(!/\ncommit;\s*$/.test(sql))throw Error('REVIEW_TRANSACTION_BOUNDARY_INVALID');
const installer=sql.replace(/\ncommit;\s*$/,insert);
const hash=createHash('sha256').update(installer).digest('hex');
const path=join(root,'existing-business-live.review.sql');
await writeFile(path,installer,{encoding:'utf8',mode:0o600});
await writeFile(join(root,'existing-business-live.review.json'),JSON.stringify({status:'REVIEW_ONLY_NOT_APPLIED',project:'vmpifljyozsbtssxhoxd',sha256:hash,target,sourceSha256:receipt.sqlSha256,nativeReceipt:receipt,hostedWrites:0},null,2),{encoding:'utf8',mode:0o600});
console.log(JSON.stringify({status:'REVIEW_ONLY_NOT_APPLIED',path,sha256:hash,hostedWrites:0}));
