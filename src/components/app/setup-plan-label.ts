import type {PaidSetupPackage} from '@/lib/tenancy/paid-setup-contracts';

/** Customer-facing names shared by the setup header and launch review. */
export function setupPlanLabel(locale:'ar'|'en',plan:PaidSetupPackage|null|undefined):string {
 const labels={basic:{ar:'القياسية',en:'Standard'},premium:{ar:'المميزة',en:'Premium'}};
 return plan?labels[plan][locale]:(locale==='ar'?'غير متاحة':'Unavailable');
}
