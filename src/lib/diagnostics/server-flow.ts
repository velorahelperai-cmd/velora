import 'server-only';
import {withLogContext} from '@/lib/logging/logger.mjs';
import {beginDiagnostic} from './flow';
import type {DiagnosticOperation} from './contract';

/** Async log scope only. Incoming metadata never participates in an auth decision. */
export async function withAuthDiagnostic<T>(operation:DiagnosticOperation,incoming:unknown,work:(trace:ReturnType<typeof beginDiagnostic>)=>Promise<T>):Promise<T>{
 const trace=beginDiagnostic(operation,incoming);
 return withLogContext(trace.logContext,async()=>{
  try{return await work(trace);}catch(error){trace.finish('OUTCOME_UNKNOWN');throw error;}
 });
}
