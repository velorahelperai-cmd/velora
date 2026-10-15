/** Each provider operation defaults OFF and requires an exact explicit flag.
 * Enabling a flag never establishes installed provider, tenant, or send authority:
 * the native connection contract, signing reader and paid/window RPCs enforce it. */
export type InstagramConfig = {graphVersion:'v26.0'|null;connectEnabled:boolean;receiveEnabled:boolean;sendEnabled:boolean};
export function instagramConfig(environment:Readonly<Record<string,string|undefined>>=process.env):InstagramConfig {
 const graphVersion=environment.INSTAGRAM_GRAPH_VERSION==='v26.0'?'v26.0':null;
 return {graphVersion,connectEnabled:!!graphVersion&&environment.INSTAGRAM_CONNECT_ENABLED==='true',receiveEnabled:!!graphVersion&&environment.INSTAGRAM_RECEIVE_ENABLED==='true',sendEnabled:!!graphVersion&&environment.INSTAGRAM_ALLOW_EXTERNAL_SEND==='true'};
}
export function instagramReviewMode(companyId:string|null|undefined,environment:Readonly<Record<string,string|undefined>>=process.env):boolean{
 return environment.INSTAGRAM_REVIEW_ENABLED==='true'&&typeof companyId==='string'
  &&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(companyId)
  &&environment.INSTAGRAM_REVIEW_COMPANY_ID===companyId;
}
