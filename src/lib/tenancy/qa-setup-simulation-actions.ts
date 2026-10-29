'use server';
import {getCompanyAccess} from './access';
import {canUseQaSetupSimulation} from './qa-setup-simulation';

export async function readQaSetupSimulationAccess(expectedAccountId:string):Promise<boolean> {
 const access=await getCompanyAccess();
 return access.ok && access.context.userId===expectedAccountId && canUseQaSetupSimulation(access.context);
}
