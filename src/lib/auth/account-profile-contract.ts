import type {ActionResult,AccountProfileView} from '@/lib/tenancy/actions';

export type AccountBoundaryExpectation={userId:string;boundaryFingerprint:string;generation:string};
export type AccountReadAttestation=AccountBoundaryExpectation & {ok:true;nativeSessionId:string;contextGeneration:number};
export type AttestedAccountProfile=
 | {ok:true;data:AccountProfileView;attestation:AccountReadAttestation}
 | Extract<ActionResult<AccountProfileView>,{ok:false}>;
