export type AuthCorrelation={readonly request_id:string;readonly trace_id:string;readonly parent_span_id:string};
export function readAuthCorrelation(value:unknown):AuthCorrelation|null;

export function authCorrelationHeaders(value:unknown):Record<string,string>;
export function readAuthCorrelationHeaders(headers:Pick<Headers,"get">):AuthCorrelation|null;
