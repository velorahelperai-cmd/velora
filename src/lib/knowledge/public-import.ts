import { createHash } from "node:crypto";
import { isIPv4 } from "node:net";
export const IMPORT_AGENT = "VeloraKnowledgeImporter";
export type PublicImportPorts = { resolve: (hostname: string) => Promise<string[]>; request: (url: URL, pinnedIPv4: string, signal: AbortSignal, maxBytes: number) => Promise<{ status: number; headers: Record<string, string>; body: string }> };
export type PublicImportResult = { ok: true; data: { sourceUrl: string; extractedAt: string; contentHash: string; confidence: "unverified"; text: string } } | { ok: false; code: string };
export function publicIPv4(address: string): boolean {
 if (!isIPv4(address)) return false;const [a,b,c]=address.split(".").map(Number);
 return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19)||a===192&&b===0||a===192&&b===88&&c===99||a===198&&b===51&&c===100||a===203&&b===0&&c===113);
}
function sourceUrl(value: string): URL {
 const u=new URL(value);
 if(u.protocol!=="https:"||u.port&&u.port!=="443"||u.username||u.password||u.search||u.hash||u.hostname.includes(":")||/(^|\.)(localhost|local|internal|invalid|test)$/.test(u.hostname)||isIPv4(u.hostname)&&!publicIPv4(u.hostname))throw Error("UNSAFE_SOURCE");
 return u;
}
function robotsPath(value: string): string { return value.replace(/[^\x00-\x7F]+/g,part=>encodeURIComponent(part)).replace(/%([0-9a-f]{2})/gi,(all,hex:string)=>{const c=String.fromCharCode(parseInt(hex,16));return /[A-Za-z0-9._~-]/.test(c)?c:all.toUpperCase();}); }
/** RFC9309 longest-match rules; attestation separately represents the user's permission claim. */
export function robotsAllows(body: string, pathname: string): boolean {
 const groups:Array<{agents:string[];rules:Array<{allow:boolean;path:string}>}>=[];let group={agents:[] as string[],rules:[] as Array<{allow:boolean;path:string}>};
 for(const raw of body.split(/\r?\n/)){const line=raw.split("#",1)[0].trim();const at=line.indexOf(":");if(at<0)continue;const key=line.slice(0,at).trim().toLowerCase(),value=line.slice(at+1).trim();
 if(key==="user-agent"){if(group.rules.length){groups.push(group);group={agents:[],rules:[]};}group.agents.push(value.toLowerCase());}
 else if((key==="allow"||key==="disallow")&&group.agents.length&&value)group.rules.push({allow:key==="allow",path:robotsPath(value)});
 }groups.push(group);
 const exact=groups.filter(g=>g.agents.includes(IMPORT_AGENT.toLowerCase()));const chosen=exact.length?exact:groups.filter(g=>g.agents.includes("*"));let winner:{allow:boolean;size:number}|null=null;
 for(const rule of chosen.flatMap(g=>g.rules)){const pattern="^"+rule.path.split("*").map(p=>p.replace(/[.+?^${}()|[\]\\]/g,"\\$&")).join(".*").replace(/\\\$$/,"$");if(new RegExp(pattern).test(robotsPath(pathname))){const size=rule.path.replace(/\*/g,"").length;if(!winner||size>winner.size||size===winner.size&&rule.allow)winner={allow:rule.allow,size};}}
 return winner?.allow??true;
}
function visibleText(html: string): string {
 if(/<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(html))throw Error("UNSUPPORTED_PRIVATE_OR_DYNAMIC_PAGE");
 const body=html.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1]??html;
 const text=body.replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,"").replace(/<!--[\s\S]*?-->/g,"").replace(/<\/?(?:p|div|section|article|h[1-6]|li|br|tr)\b[^>]*>/gi,"\n").replace(/<[^>]*>/g,"")
 .replace(/&#(x[0-9a-f]+|\d+);/gi,(_all,n:string)=>{const code=n[0].toLowerCase()==="x"?parseInt(n.slice(1),16):Number(n);return code>0&&code<=0x10ffff?String.fromCodePoint(code):"";}).replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_,n:string)=>({amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" "}[n]??""))
 .split("\n").map(v=>v.replace(/\s+/g," ").trim()).filter(Boolean).join("\n");
 if(!text)throw Error("UNSUPPORTED_PRIVATE_OR_DYNAMIC_PAGE");if(text.length>12000)throw Error("CONTENT_TOO_LARGE");return text;
}
export async function collectPublicKnowledge(value: string, rightsAttested: boolean, ports: PublicImportPorts): Promise<PublicImportResult> {
 if(!rightsAttested)return {ok:false,code:"RIGHTS_ATTESTATION_REQUIRED"};
 const signal=AbortSignal.timeout(10000);
 const resolvePinned=async(u:URL)=>{let aborted:()=>void=()=>{};const abort=new Promise<never>((_,reject)=>{aborted=()=>reject(Error('FETCH_UNAVAILABLE'));if(signal.aborted)aborted();else signal.addEventListener('abort',aborted,{once:true});});try{const ips=await Promise.race([ports.resolve(u.hostname),abort]);if(!ips.length||ips.some(ip=>!publicIPv4(ip)))throw Error('UNSAFE_SOURCE');return ips[0];}finally{signal.removeEventListener('abort',aborted);}};
 const fetchOne=async(u:URL,cap:number)=>{const ip=await resolvePinned(u);const r=await ports.request(u,ip,signal,cap);if(Buffer.byteLength(r.body)>cap)throw Error("CONTENT_TOO_LARGE");return r;};
 const permission=async(u:URL)=>{let robots=sourceUrl(`${u.origin}/robots.txt`);for(let n=0;n<3;n++){const r=await fetchOne(robots,131072);if([301,302,303,307,308].includes(r.status)&&r.headers.location){robots=sourceUrl(new URL(r.headers.location,robots).href);continue;}if(r.status===404||r.status===410)return;if(r.status!==200||!robotsAllows(r.body,u.pathname))throw Error("SOURCE_PERMISSION_DENIED");return;}throw Error("SOURCE_PERMISSION_DENIED");};
 try{let current=sourceUrl(value);for(let hop=0;hop<4;hop++){await permission(current);const r=await fetchOne(current,1048576);if([301,302,303,307,308].includes(r.status)&&r.headers.location){current=sourceUrl(new URL(r.headers.location,current).href);continue;}if(r.status!==200)throw Error(r.status===401||r.status===403?"SOURCE_PERMISSION_DENIED":"FETCH_UNAVAILABLE");if(!/^(text\/html|text\/plain)(;|$)/i.test(r.headers["content-type"]??""))throw Error("UNSUPPORTED_PRIVATE_OR_DYNAMIC_PAGE");const text=/^text\/plain/i.test(r.headers["content-type"])?r.body.trim():visibleText(r.body);if(!text||text.length>12000)throw Error("CONTENT_TOO_LARGE");return {ok:true,data:{sourceUrl:current.href,extractedAt:new Date().toISOString(),contentHash:createHash("sha256").update(text).digest("hex"),confidence:"unverified",text}};}return {ok:false,code:"REDIRECT_LIMIT"};
 }catch(error){return {ok:false,code:error instanceof Error&&["UNSAFE_SOURCE","SOURCE_PERMISSION_DENIED","CONTENT_TOO_LARGE","UNSUPPORTED_PRIVATE_OR_DYNAMIC_PAGE"].includes(error.message)?error.message:"FETCH_UNAVAILABLE"};}
}
