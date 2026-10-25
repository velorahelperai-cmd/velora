/** Untrusted diagnostic metadata only: never an identity, capability or authorization. */
export function readAuthCorrelation(value) {
 try {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys=Object.keys(value);
  if(keys.length!==3 || keys.some(key=>!['request_id','trace_id','parent_span_id'].includes(key)))return null;
  const {request_id,trace_id,parent_span_id}=value;
  if(typeof request_id!=='string'||!/^VEL-[A-F0-9]{16}$/.test(request_id))return null;
  if(typeof trace_id!=='string'||!/^[a-f0-9]{32}$/.test(trace_id)||/^0+$/.test(trace_id))return null;
  if(typeof parent_span_id!=='string'||!/^[a-f0-9]{16}$/.test(parent_span_id)||/^0+$/.test(parent_span_id))return null;
  return {request_id,trace_id,parent_span_id};
 }catch{return null;}
}

/** Fixed first-party headers; no auth inputs, URL parameters or identity fields. */
export function authCorrelationHeaders(value){
 const row=readAuthCorrelation(value);
 return row?{'x-velora-request-id':row.request_id,'x-velora-trace-id':row.trace_id,'x-velora-parent-span-id':row.parent_span_id}:{};
}
export function readAuthCorrelationHeaders(headers){
 try{return readAuthCorrelation({request_id:headers.get('x-velora-request-id'),trace_id:headers.get('x-velora-trace-id'),parent_span_id:headers.get('x-velora-parent-span-id')});}catch{return null;}
}
