import {it,expect} from 'vitest';
import {canUseAccountPrepDraft} from './account-prep-eligibility';
const customer={isPlatformAdmin:false,ownedBusinessCount:0,membership:null,workspaceChoices:[],hasBusinessMemberships:false};
it.each([customer,{...customer,isPlatformAdmin:true,ownedBusinessCount:1},{...customer,membership:{role:'staff'},workspaceChoices:[{role:'owner'}]}])('permits approved new customers and existing owners (%#)',context=>expect(canUseAccountPrepDraft(context)).toBe(true));
it.each([{...customer,isPlatformAdmin:true},{...customer,membership:{role:'staff'},hasBusinessMemberships:true},{...customer,hasBusinessMemberships:true}])('rejects staff/platform-only actors with no ownership (%#)',context=>expect(canUseAccountPrepDraft(context)).toBe(false));
