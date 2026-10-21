import 'server-only';
import {aggregateMonthlyUsage,monthlyUsagePeriod} from './monthly-usage';
export type MonthlyUsageQuery=PromiseLike<{data:unknown;error:unknown}>&{
 eq(key:string,value:string):MonthlyUsageQuery;gte(key:string,value:string):MonthlyUsageQuery;lt(key:string,value:string):MonthlyUsageQuery;
 order(key:string,options:{ascending:boolean}):MonthlyUsageQuery;range(start:number,end:number):MonthlyUsageQuery;
};
export type MonthlyUsageDb={from(table:string):{select(columns:string):MonthlyUsageQuery}};
const COLUMNS='id,company_id,execution_id,attempt,usage_mode,provider,model_id,actual_model_id,status,prompt_tokens,completion_tokens,reasoning_tokens,cached_tokens,cache_write_tokens,total_tokens,cost_usd,cost_baisa,pricing_version,pricing_snapshot,created_at';
const PAGE=250,MAX_ROWS=10000;
export async function readMonthlyAIUsage(db:MonthlyUsageDb,companyId:string,month:string,asOf=new Date()) {
 const period=monthlyUsagePeriod(month,asOf),rows:unknown[]=[];
 // Validate scope even if the ledger happens to be empty.
 aggregateMonthlyUsage(companyId,month,[],asOf);
 for(let offset=0;offset<=MAX_ROWS;offset+=PAGE){
  const {data,error}=await db.from('ai_usage_ledger').select(COLUMNS).eq('company_id',companyId).gte('created_at',period.startsAt).lt('created_at',period.readBefore).order('id',{ascending:true}).range(offset,offset+PAGE-1);
  if(error||!Array.isArray(data))throw Error('USAGE_READ_UNAVAILABLE');
  rows.push(...data);if(rows.length>MAX_ROWS)throw Error('USAGE_READ_LIMIT');
  if(data.length<PAGE)return aggregateMonthlyUsage(companyId,month,rows,asOf);
 }
 throw Error('USAGE_READ_LIMIT');
}
