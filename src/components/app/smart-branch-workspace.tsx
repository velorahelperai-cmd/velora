'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {useDemo} from '@/lib/demo-state';
import type {SmartBranchSetup} from '@/lib/tenancy/smart-onboarding';
import {SmartSetupBranches} from './smart-setup-branches';
import {WorkspaceShell} from './workspace-shell';

export function SmartBranchWorkspace({userId,companyId,initial}:{userId:string;companyId:string;initial:SmartBranchSetup}){
  const {locale}=useDemo(),router=useRouter();
  const [setup,setSetup]=useState(initial);
  return <WorkspaceShell title={locale==='ar'?'تجهيز الفروع':'Prepare branches'}>
    <SmartSetupBranches userId={userId} companyId={companyId} locale={locale} setup={setup} onSaved={setSetup} onClose={()=>router.push('/setup')}/>
  </WorkspaceShell>;
}
