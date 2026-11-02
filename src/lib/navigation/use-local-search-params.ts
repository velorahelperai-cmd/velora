'use client';

import {useEffect,useState} from 'react';
import {useSearchParams} from 'next/navigation';

/** For view-only URL state. Data reads and mutations must authorize separately. */
export function useLocalSearchParams(){
 const routeSearch=useSearchParams().toString();
 const [params,setParams]=useState(()=>new URLSearchParams(routeSearch));
 useEffect(()=>{
  // Read the current URL, never a delayed router snapshot from an older action.
  const sync=()=>setParams(new URLSearchParams(window.location.search));
  sync();window.addEventListener('popstate',sync);
  return()=>window.removeEventListener('popstate',sync);
 },[routeSearch]);
 const navigate=(href:string)=>{
  window.history.pushState(null,'',href);
  setParams(new URLSearchParams(href.split('?')[1]??''));
 };
 return [params,navigate] as const;
}
