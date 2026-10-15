export type LogContext={request_id?:string;trace_id?:string;span_id?:string;user_id?:string;tenant_id?:string};
export type LogSeverity='trace'|'debug'|'info'|'warn'|'error'|'fatal';
export function withLogContext<T>(fields:LogContext,operation:()=>T):T;
export function logEvent(severity:LogSeverity,event:string,fields?:Record<string,unknown>):void;
