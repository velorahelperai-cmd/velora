/** Expiring server configuration only. This is never commercial connection proof. */
export type SetupMetaTestScope={expectedAccountId:string;companyId:string;branchId:string};
export type SetupMetaTestConfig={expiresAt:string;phoneNumberId:string;wabaId:string;appId:string;graphVersion:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function setupMetaTestConfig(scope:SetupMetaTestScope,env:Record<string,string|undefined>,now=Date.now()):SetupMetaTestConfig|null{
 if(!scope||![scope.expectedAccountId,scope.companyId,scope.branchId].every(value=>typeof value==='string'&&uuid.test(value))
  ||env.VELORA_SETUP_META_TEST_ENABLED!=='true'||env.WHATSAPP_CONFIGURATION_MODE!=='meta_test'
  ||scope.expectedAccountId!==env.VELORA_SETUP_META_TEST_ACCOUNT_ID||scope.companyId!==env.VELORA_SETUP_META_TEST_COMPANY_ID
  ||scope.branchId!==env.VELORA_SETUP_META_TEST_BRANCH_ID)return null;
 const expiresAt=env.VELORA_SETUP_META_TEST_EXPIRES_AT??'',deadline=Date.parse(expiresAt);
 if(!Number.isFinite(now)||!Number.isFinite(deadline)||deadline<=now||deadline>now+7*86400000)return null;
 const phoneNumberId=env.WHATSAPP_TEST_PHONE_NUMBER_ID??'',wabaId=env.WHATSAPP_TEST_WABA_ID??'',appId=env.WHATSAPP_EMBEDDED_SIGNUP_APP_ID??'',graphVersion=env.WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION??'';
 if(![phoneNumberId,wabaId,appId].every(value=>/^[0-9]{1,64}$/.test(value))||!/^v[1-9][0-9]{0,2}\.0$/.test(graphVersion))return null;
 return {expiresAt,phoneNumberId,wabaId,appId,graphVersion};
}
