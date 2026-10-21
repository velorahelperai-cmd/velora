const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODES=['setup_trial','company_live','admin_test'] as const;
const TOKENS=['prompt_tokens','completion_tokens','reasoning_tokens','cached_tokens','cache_write_tokens','total_tokens'] as const;
const METRICS=[...TOKENS,'cost_usd','cost_baisa'] as const;
type MetricName=typeof METRICS[number];
export type UsageMetric={known:number;unknownRows:number;total:number|null};
export type UsageTotals=Record<MetricName,UsageMetric>;
export type UsageGroup={usageMode:typeof MODES[number];provider:string;modelId:string;actualModelId:string|null;pricingVersion:string;pricingSnapshot:Record<string,unknown>;attempts:number;unknownOutcomeAttempts:number;pendingAttempts:number;totals:UsageTotals};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
function canonical(v:unknown):string {
 if(Array.isArray(v))return `[${v.map(canonical).join(',')}]`;
 if(object(v))return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
 if(v===null||typeof v==='string'||typeof v==='boolean'||(typeof v==='number'&&Number.isFinite(v)))return JSON.stringify(v);
 throw Error('INVALID_USAGE_ROW');
}
/** Attribute reservations by created_at; later reconciliation updates that month. */
export function monthlyUsagePeriod(month:string,asOf=new Date()) {
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!Number.isFinite(asOf.getTime()))throw Error('INVALID_USAGE_PERIOD');
 const [year,m]=month.split('-').map(Number);
 if(year<2000||year>9998)throw Error('INVALID_USAGE_PERIOD');
 const start=Date.UTC(year,m-1,1)-4*3600000,end=Date.UTC(year,m,1)-4*3600000;
 if(start>=asOf.getTime())throw Error('INVALID_USAGE_PERIOD');
 return {month,timezone:'Asia/Muscat' as const,startsAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString(),readBefore:new Date(Math.min(end,asOf.getTime())).toISOString()};
}
function emptyTotals():UsageTotals {return Object.fromEntries(METRICS.map(k=>[k,{known:0,unknownRows:0,total:0}])) as UsageTotals;}
function numeric(value:unknown,scale:number):number|null {
 if(value===null||value===undefined)return null;
 if(typeof value!=='number'&&(typeof value!=='string'||!/^\d+(?:\.\d+)?$/.test(value)))throw Error('INVALID_USAGE_ROW');
 const n=Number(value),atoms=Math.round(n*scale);
 if(scale===1&&!Number.isSafeInteger(n))throw Error('INVALID_USAGE_ROW');
 if(!Number.isFinite(n)||n<0||!Number.isSafeInteger(atoms)||Math.abs(atoms/scale-n)>1e-12)throw Error('INVALID_USAGE_ROW');
 return n;
}
function add(totals:UsageTotals,row:Record<string,unknown>) {
 for(const key of METRICS){const scale=key==='cost_usd'?1e10:key==='cost_baisa'?1e6:1;
  const n=numeric(row[key],scale),metric=totals[key];
  if(n===null)metric.unknownRows++;
  else {const sum=Math.round(metric.known*scale)+Math.round(n*scale);if(!Number.isSafeInteger(sum))throw Error('USAGE_TOTAL_OUT_OF_RANGE');metric.known=sum/scale;}
  metric.total=metric.unknownRows?null:metric.known;
 }
}
export function aggregateMonthlyUsage(companyId:string,month:string,rows:unknown[],asOf=new Date()) {
 if(!UUID.test(companyId)||!Array.isArray(rows))throw Error('INVALID_USAGE_INPUT');
 const period=monthlyUsagePeriod(month,asOf),totals=emptyTotals(),groups=new Map<string,UsageGroup>(),seen=new Set<string>(),attemptKeys=new Set<string>();
 let attempts=0,unknownOutcomeAttempts=0,pendingAttempts=0;
 for(const row of rows){
  if(!object(row)||row.company_id!==companyId)throw Error('USAGE_SCOPE_MISMATCH');
  if(typeof row.created_at!=='string'||!/^\d{4}-\d\d-\d\dT/.test(row.created_at)||!Number.isFinite(Date.parse(row.created_at)))throw Error('INVALID_USAGE_ROW');
  const at=Date.parse(row.created_at);if(at<Date.parse(period.startsAt)||at>=Date.parse(period.readBefore))continue;
  if(!UUID.test(String(row.id))||!UUID.test(String(row.execution_id))||!Number.isSafeInteger(row.attempt)||Number(row.attempt)<1||!MODES.includes(row.usage_mode as typeof MODES[number])||!text(row.provider)||!text(row.model_id)||!(row.actual_model_id===null||row.actual_model_id===undefined||text(row.actual_model_id))||!text(row.pricing_version)||!object(row.pricing_snapshot)||!['reserved','running','success','rejected','incomplete','uncertain'].includes(String(row.status)))throw Error('INVALID_USAGE_ROW');
  const identity=`${row.execution_id}:${row.attempt}`;
  if(seen.has(String(row.id))||attemptKeys.has(identity))throw Error('USAGE_DUPLICATE_ATTEMPT');seen.add(String(row.id));attemptKeys.add(identity);
  const v=Object.fromEntries(TOKENS.map(k=>[k,numeric(row[k],1)]));
  const {prompt_tokens:p,completion_tokens:c,reasoning_tokens:r,cached_tokens:cached,cache_write_tokens:write,total_tokens:total}=v;
  if((r!==null&&c!==null&&r>c)||(cached!==null&&p!==null&&cached>p)||(write!==null&&p!==null&&write>p)||(cached!==null&&write!==null&&p!==null&&cached+write>p)||(total!==null&&p!==null&&c!==null&&total!==p+c))throw Error('INVALID_USAGE_ROW');
  const mode=row.usage_mode as typeof MODES[number],actual=typeof row.actual_model_id==='string'?row.actual_model_id:null;
  const key=canonical([mode,row.provider,row.model_id,actual,row.pricing_version,row.pricing_snapshot]);
  let group=groups.get(key);if(!group){group={usageMode:mode,provider:row.provider,modelId:row.model_id,actualModelId:actual,pricingVersion:row.pricing_version,pricingSnapshot:JSON.parse(canonical(row.pricing_snapshot)),attempts:0,unknownOutcomeAttempts:0,pendingAttempts:0,totals:emptyTotals()};groups.set(key,group);}
  const unknown=row.status==='uncertain'||row.status==='incomplete',pending=row.status==='reserved'||row.status==='running';
  attempts++;group.attempts++;if(unknown){unknownOutcomeAttempts++;group.unknownOutcomeAttempts++;}if(pending){pendingAttempts++;group.pendingAttempts++;}
  add(totals,row);add(group.totals,row);
 }
 return {companyId,...period,asOf:asOf.toISOString(),attribution:'ledger_created_at' as const,basis:'recorded_usage_tariff_estimate' as const,providerInvoiceCost:null,attempts,unknownOutcomeAttempts,pendingAttempts,totals,groups:[...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,g])=>g)};
}
export type MonthlyUsageReport=ReturnType<typeof aggregateMonthlyUsage>;
