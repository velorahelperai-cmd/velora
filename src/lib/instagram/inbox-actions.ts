'use server';
import {createClient} from '@/lib/supabase/server';
import {createInstagramInboxStore} from './inbox-store';
import type {InstagramRpcClient} from './connection-store';
import type {InstagramAssignInput,InstagramPageInput,InstagramReadInput,InstagramThreadInput} from './inbox-contracts';
async function store(){return createInstagramInboxStore(await createClient() as unknown as InstagramRpcClient);}
export async function loadInstagramInboxPage(input:InstagramPageInput){try{return await (await store()).inbox(input);}catch{return {ok:false as const,code:'UNAVAILABLE' as const};}}
export async function loadInstagramThreadPage(input:InstagramThreadInput){try{return await (await store()).thread(input);}catch{return {ok:false as const,code:'UNAVAILABLE' as const};}}
/** Invoke only after the latest returned thread page has been rendered. Receipt
 * limits acknowledgment to the inbound boundary issued by that exact page. */
export async function markInstagramThreadRead(input:InstagramReadInput){try{return await (await store()).markRead(input);}catch{return {ok:false as const,code:'UNAVAILABLE' as const};}}
export async function assignInstagramConversation(input:InstagramAssignInput){try{return await (await store()).assign(input);}catch{return {ok:false as const,code:'UNAVAILABLE' as const};}}
