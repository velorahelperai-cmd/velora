import type {AIModelId} from "../types";
export type AdminAIState = {
 budget:{limit_baisa:number;spent_baisa:number;held_baisa:number;enabled:boolean};
 companies:Array<{id:string;name:string;status:string}>;
 models:Array<{model_id:AIModelId;attempts:number;succeeded:number;cost_baisa:number}>;
 recent:Array<{id:string;company_id:string;model_id:AIModelId;status:string;cost_baisa:number|null;cost_usd:number|null;reserved_baisa:number;prompt_tokens:number|null;completion_tokens:number|null;cached_tokens:number|null;reasoning_tokens:number|null;error_code:string|null;request_id:string|null;latency_ms:number|null;created_at:string}>;
};
export type AdminAIActionInput={companyId:string;question:string;executionId:string;model:"auto"|AIModelId;locale:"ar"|"en";contextMode:"connection"|"company";maxOutputTokens?:number;maxCostBaisa?:number};
