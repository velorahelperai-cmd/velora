"use client";
import {useCallback} from 'react';
import {AccountPageFrame} from './account-page-frame';

/** Compatibility entry for existing callers. Show the shared page UI directly;
 * no loading announcement, animation or waiting screen owns admission. */
export function ApprovedAccountLoader(props:{label:string;ready?:boolean;onComplete?:()=>void}){
  void props;
  return <AccountPageFrame/>;
}

/** Readiness is owned by the account check, never by presentation completion. */
export function useApprovedLoaderGate(pending:boolean){
  const finish=useCallback(()=>{/* Presentation completion is advisory only. */},[]);
  return {holding:pending,finish};
}
