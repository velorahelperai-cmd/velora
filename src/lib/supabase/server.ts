import { cache } from "react";
import { AsyncLocalStorage } from "node:async_hooks";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createBrokerUserClient } from "@/lib/auth/broker";
import { createProviderAuthClient } from "@/lib/auth/broker/provider";
import { measureRead } from '@/lib/diagnostics/read-performance';
import {coalesceBrokerRead} from './read-scope';

type BrokerRead = Awaited<ReturnType<typeof createBrokerUserClient>>;
type VerifiedReadClient = {key:string;client:SupabaseClient<Database>;bound:Extract<BrokerRead,{ok:true}>;open:boolean;invalid:boolean};
const verifiedReadClient = new AsyncLocalStorage<VerifiedReadClient>();

export class VerifiedReadBoundaryError extends Error {
 constructor(message:string,readonly code:'UNAUTHENTICATED'|'UNAVAILABLE'='UNAVAILABLE'){super(message);}
}

/** Opt-in read composition only. Shares transport, never permission results.
 * Both broker resolutions bypass React.cache and the in-flight read map. No
 * result can escape before the final live boundary and cookie checks pass.
 * Callers must bind successful payload actors to the returned actorId. */
export async function runWithVerifiedReadClient<T>(work:()=>Promise<T>):Promise<{value:T;actorId:string}>{
 const store=await cookies();
 const key=snapshotCookieKey(store);
 const pairs=JSON.parse(key) as Array<{name:string;value:string}>;
 const initial=await measureRead('broker',()=>createBrokerUserClient({getAll:()=>pairs.map(c=>({...c}))}));
 if(!initial.ok)throw new VerifiedReadBoundaryError('READ_BOUNDARY_UNAVAILABLE',initial.code);
 const boundary=initial.resolve.boundary;
 const fields=['boundaryFingerprint','userId','nativeSessionId','cookieName','generation','authOrdinal','contextGeneration','browserLineageId'] as const;
 const captured=fields.map(field=>boundary[field]??null);
 const scope:VerifiedReadClient={key,client:initial.client,bound:initial,open:true,invalid:false};
 return verifiedReadClient.run(scope,async()=>{
  try{
   const value=await work();
   scope.open=false;
   if(scope.invalid||snapshotCookieKey(await cookies())!==key)throw new Error('READ_BOUNDARY_CHANGED');
   const current=await measureRead('broker_fresh',()=>createBrokerUserClient({getAll:()=>pairs.map(c=>({...c}))}));
   if(!current.ok)throw new VerifiedReadBoundaryError('READ_BOUNDARY_UNAVAILABLE',current.code);
   if(current.resolve.registryId!==initial.resolve.registryId||fields.some((field,index)=>(current.resolve.boundary[field]??null)!==captured[index])
    ||snapshotCookieKey(await cookies())!==key)throw new VerifiedReadBoundaryError('READ_BOUNDARY_CHANGED','UNAUTHENTICATED');
   return {value,actorId:boundary.userId};
  }finally{scope.open=false;}
 });
}

function snapshotCookieKey(cookieStore: Awaited<ReturnType<typeof cookies>>): string {
  const pairs = cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
  return JSON.stringify(pairs);
}

// Per-request memoization keyed by a single stable primitive cookie snapshot string.
// Cookie mutations produce a new key within the same request; React.cache resets across requests.
const resolveBrokerForCookieSnapshot = cache(async (cookieSnapshotKey: string) => {
  const pairs = JSON.parse(cookieSnapshotKey) as Array<{ name: string; value: string }>;
  return coalesceBrokerRead(cookieSnapshotKey,()=>measureRead('broker',()=>createBrokerUserClient({
    getAll: () => pairs.map((c) => ({ name: c.name, value: c.value })),
  })));
});

/** Identity reads only; never exposes a cookie writer. The operation's fresh
 * final broker fence must complete before its result is returned. Outside an
 * opted-in read this uses the same request resolver as createBrokerBoundClient. */
export async function createReadOnlyBrokerClient():Promise<BrokerRead>{
 const key=snapshotCookieKey(await cookies());
 const scope=verifiedReadClient.getStore();
 if(scope?.open){
  if(scope.key!==key){scope.invalid=true;throw new VerifiedReadBoundaryError('READ_BOUNDARY_CHANGED');}
  // Callers may read identity fields, but cannot mutate our final comparison.
  return {...scope.bound,resolve:{...scope.bound.resolve,boundary:{...scope.bound.resolve.boundary}}};
 }
 return resolveBrokerForCookieSnapshot(key);
}

/**
 * Request-scoped Supabase client backed by the WP01A session broker.
 * Tokens live server-side; browser only carries opaque handle cookies.
 * Legacy sb-* auth cookies are ignored (no dual-reader fallback).
 */
export async function createClient(): Promise<SupabaseClient<Database>> {
  return measureRead('client',async()=>{
  const cookieStore = await cookies();
  const cookieSnapshotKey = snapshotCookieKey(cookieStore);
  const scoped=verifiedReadClient.getStore();
  if(scoped?.open){
    if(scoped.key!==cookieSnapshotKey){scoped.invalid=true;throw new Error('READ_BOUNDARY_CHANGED');}
    return scoped.client;
  }
  const resolved = await resolveBrokerForCookieSnapshot(cookieSnapshotKey);
  if (resolved.ok) return resolved.client;

  // A broker/refresh outage is not evidence of logout. Returning a sessionless
  // client here makes activity checks expire and quarantine a valid session.
  // Existing callers handle a failed client read as unavailable, without granting access.
  if (resolved.code === "UNAVAILABLE") throw new Error("BROKER_SESSION_UNAVAILABLE");

  // Unauthenticated request path: memory-only provider client with no session.
  // Callers that require auth still fail at getUser/RPC under RLS.
  const bundle = createProviderAuthClient();
  if (!bundle) {
    throw new Error("Supabase public env is incomplete");
  }
  return bundle.client;
  });
}

/** Resolve broker session for writers that need handle/cookie mutation. */
export async function createBrokerBoundClient(options?: { fresh?: boolean }) {
  const cookieStore = await cookies();
  const reader = {
    getAll: () => cookieStore.getAll().map((c) => ({ name: c.name, value: c.value })),
  };
  const writer = {
    set(name: string, value: string, options?: Record<string, unknown>) {
      try {
        cookieStore.set(name, value, options as never);
      } catch {
        /* Server Component read-only cookie context */
      }
    },
  };
  const cookieSnapshotKey = snapshotCookieKey(cookieStore);
  // Authority fences must observe DB revocation/rotation even when cookies did not change.
  const bound = options?.fresh
    ? await measureRead('broker_fresh',()=>createBrokerUserClient(reader))
    : await resolveBrokerForCookieSnapshot(cookieSnapshotKey);
  return { cookieStore, reader, writer, bound };
}
