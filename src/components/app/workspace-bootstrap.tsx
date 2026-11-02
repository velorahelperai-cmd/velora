'use client';
import {createContext,useContext,type ReactNode} from 'react';
import type {CompanyRole} from '@/lib/tenancy/types';

export type WorkspaceBootstrap={
 workspace:{needsContext:boolean;selectedCompanyId:string|null;isPlatformAdmin:boolean;choices:Array<{companyId:string;displayName:string;role:CompanyRole}>};
 identity:{userId:string;fullName:string;email:string};
 knowledgeAllowed:boolean;
};
const Bootstrap=createContext<WorkspaceBootstrap|null>(null);
/** Display snapshot only. Every page/read/mutation still checks native authority. */
export function WorkspaceBootstrapProvider({value,children}:{value:WorkspaceBootstrap;children:ReactNode}){
 return <Bootstrap.Provider value={value}>{children}</Bootstrap.Provider>;
}
export function useWorkspaceBootstrap(){return useContext(Bootstrap);}
