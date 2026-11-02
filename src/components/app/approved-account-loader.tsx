"use client";
import {useCallback} from 'react';

/** The owner has hidden the animated loading screen site-wide. Keep only an
 * accessible pending status; no canvas, overlay, font load or visual timer.
 * Existing admission callers remain responsible for protecting their content. */
export function ApprovedAccountLoader({label}:{label:string;ready?:boolean;onComplete?:()=>void}){
  return <span className="sr-only" role="status" aria-busy="true" aria-label={label}>{label}</span>;
}

/** Readiness is owned by the account check, never by presentation completion. */
export function useApprovedLoaderGate(pending:boolean){
  const finish=useCallback(()=>{/* Presentation completion is advisory only. */},[]);
  return {holding:pending,finish};
}
