import 'server-only';
type ProfileResult={kind:'profile';username:string}|{kind:'unavailable'}|{kind:'authorization_required'};
export async function readPersistedInstagramProfile(input:{accountId:string;accessToken:string},http:typeof fetch=fetch):Promise<ProfileResult>{
 const unavailable:ProfileResult={kind:'unavailable'};
 if(!/^\d{1,64}$/.test(input.accountId)||!input.accessToken||/[\s\x00-\x1f\x7f]/.test(input.accessToken))return unavailable;
 try{const response=await http('https://graph.instagram.com/v26.0/me?fields=user_id,username',{method:'GET',headers:{Authorization:`Bearer ${input.accessToken}`},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
  const reader=response.body?.getReader();if(!reader)return unavailable;let bytes=0,raw='';const decoder=new TextDecoder();while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>8192){await reader.cancel();return unavailable;}raw+=decoder.decode(part.value,{stream:true});}raw+=decoder.decode();
  // Exact numeric IDs can exceed JS safe integers; preserve their original JSON spelling.
  const body=JSON.parse(raw,((key:string,value:unknown,context?:{source?:string})=>key==='user_id'&&typeof value==='number'&&context?.source&&/^[0-9]{1,64}$/.test(context.source)?context.source:value) as Parameters<typeof JSON.parse>[1]);
  if(!body||typeof body!=='object'||Array.isArray(body))return unavailable;
  if(!response.ok)return response.status>=400&&response.status<500&&body.error?.code===190?{kind:'authorization_required'}:unavailable;
  const profile=Array.isArray(body.data)&&body.data.length===1?body.data[0]:body;
  return profile?.user_id===input.accountId&&typeof profile.username==='string'&&/^[A-Za-z0-9_.]{1,30}$/.test(profile.username)?{kind:'profile',username:profile.username}:unavailable;
 }catch{return unavailable;}
}
