import "server-only";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIPv4 } from "node:net";
import { IMPORT_AGENT, type PublicImportPorts } from "./public-import";
/** TLS still validates the original hostname; DNS is never consulted during connection. */
export const publicImportHttp: PublicImportPorts = {
 resolve: async hostname => (await lookup(hostname,{all:true,family:4,verbatim:true})).map(v=>v.address),
 request: (url,ip,signal,maxBytes)=>new Promise((resolve,reject)=>{
  const req=request(url,{method:"GET",agent:false,family:4,servername:isIPv4(url.hostname)?undefined:url.hostname,rejectUnauthorized:true,signal,lookup:(_hostname,_options,done)=>done(null,ip,4),headers:{"User-Agent":IMPORT_AGENT,"Accept":"text/html,text/plain","Accept-Encoding":"identity"}},res=>{
   const headers:Record<string,string>={};for(const [key,value]of Object.entries(res.headers))if(typeof value==="string")headers[key.toLowerCase()]=value;
   if(res.headers["content-encoding"]&&res.headers["content-encoding"]!=="identity"||Number(res.headers["content-length"])>maxBytes){res.destroy();reject(Error("CONTENT_TOO_LARGE"));return;}
   const chunks:Buffer[]=[];let bytes=0;res.on("data",chunk=>{bytes+=chunk.length;if(bytes>maxBytes){res.destroy();reject(Error("CONTENT_TOO_LARGE"));}else chunks.push(Buffer.from(chunk));});res.on("end",()=>resolve({status:res.statusCode??0,headers,body:Buffer.concat(chunks).toString("utf8")}));res.on("error",reject);
  });req.on("error",reject);req.end();
 }),
};
