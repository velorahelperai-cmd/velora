import type {PersonalPhoneSmsDeliveryPort} from "./personal-phone-hook";
import {masterJourneyEnabled} from "@/lib/master-journey/rollout";

/** Provider selection and paid delivery approval are unresolved. Add the reviewed
 * provider adapter here only after approval; arbitrary environment URLs cannot
 * select a provider or bypass this deliberately unavailable port. */
export function createApprovedPersonalPhoneSmsDeliveryPort():PersonalPhoneSmsDeliveryPort|null{return null;}
export function personalPhoneSmsRuntimeConfigured():boolean{
 return masterJourneyEnabled()&&process.env.VELORA_PERSONAL_PHONE_SMS_APPROVED==="true"
  &&process.env.VELORA_PERSONAL_PHONE_SMS_HOOK_REGISTERED==="true"
  &&Boolean(process.env.VELORA_PERSONAL_PHONE_SMS_HOOK_SECRET?.trim())
  &&createApprovedPersonalPhoneSmsDeliveryPort()!==null;
}
