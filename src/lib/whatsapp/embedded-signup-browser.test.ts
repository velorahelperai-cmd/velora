import {describe,expect,it} from "vitest";
import {parseSignupMessage,joinSignupSignals,signupLoginOptions} from "./embedded-signup-browser";
describe("signup SDK signals",()=>{
 it.each(["https://facebook.com.attacker.example","https://evilfacebook.com","http://www.facebook.com","https://www.facebook.com:444"])("rejects a lookalike Facebook origin %s",origin=>{
  expect(parseSignupMessage(origin,JSON.stringify({type:"WA_EMBEDDED_SIGNUP",event:"FINISH",data:{waba_id:"222",phone_number_id:"333"}}))).toBeNull();
 });
 it("joins callback code and verified-later selectors in either arrival order",()=>{
  const finish=parseSignupMessage("https://www.facebook.com",JSON.stringify({type:"WA_EMBEDDED_SIGNUP",event:"FINISH",data:{waba_id:"222",phone_number_id:"333"}}));
  expect(finish).toEqual({event:"FINISH",wabaId:"222",phoneNumberId:"333"});
  expect(joinSignupSignals({code:"ephemeral"},finish!)).toEqual({code:"ephemeral",wabaId:"222",phoneNumberId:"333"});
  expect(joinSignupSignals(joinSignupSignals({},finish!),{code:"ephemeral"})).toEqual({code:"ephemeral",wabaId:"222",phoneNumberId:"333"});
 });
 it("does not choose a WABA from ambiguous multi-WABA data",()=>{
  expect(parseSignupMessage("https://www.facebook.com",{type:"WA_EMBEDDED_SIGNUP",event:"FINISH",data:{waba_ids:["222","444"],phone_number_id:"333"}})).toEqual({event:"MULTIPLE_ACCOUNTS"});
 });
 it("uses Embedded Signup v5 and explicitly opts out of Business app onboarding",()=>{
  expect(signupLoginOptions("444")).toEqual({config_id:"444",response_type:"code",override_default_response_type:true,extras:{setup:{},version:"v5",features:[{name:"whatsapp_business_app_onboarding",enabled:false}]}});
  expect(JSON.stringify(signupLoginOptions("444"))).not.toMatch(/featureType|sessionInfoVersion/);
 });
it("returns FINISH_ONLY_WABA as its own signal", () => {
  expect(parseSignupMessage("https://www.facebook.com",{type:"WA_EMBEDDED_SIGNUP",event:"FINISH_ONLY_WABA",data:{waba_id:"222"}})).toEqual(expect.objectContaining({event:"FINISH_ONLY_WABA"}));
  expect(parseSignupMessage("https://evil.example",{type:"WA_EMBEDDED_SIGNUP",event:"FINISH_ONLY_WABA",data:{waba_id:"222"}})).toBeNull();
});
const v5=(event:string,data:object)=>parseSignupMessage("https://www.facebook.com",{type:"WA_EMBEDDED_SIGNUP",event,data,extra_top_level:1});
it("parses the documented v5 FINISH shape with messaging_account_ids and unknown keys",()=>{
  expect(v5("FINISH",{phone_number_id:"333",is_on_biz_app:false,messaging_account_ids:["222"],primary_waac_ids:[],page_ids:[],catalog_ids:[],dataset_ids:[],business_id:"9",instagram_account_ids:[],future:"x"})).toEqual({event:"FINISH",wabaId:"222",phoneNumberId:"333"});
});
it("rejects v5 finishes the new-number route must not accept, without choosing anything",()=>{
  expect(v5("FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",{phone_number_id:"333",is_on_biz_app:true,messaging_account_ids:["222"]})).toEqual({event:"BUSINESS_APP_ONBOARDING"});
  expect(v5("FINISH",{phone_number_id:"333",is_on_biz_app:true,messaging_account_ids:["222"]})).toEqual({event:"BUSINESS_APP_ONBOARDING"});
  expect(v5("FINISH_GRANT_ONLY_API_ACCESS",{})).toEqual({event:"GRANT_ONLY"});
  expect(v5("FINISH",{phone_number_id:"333",messaging_account_ids:["222","444"]})).toEqual({event:"MULTIPLE_ACCOUNTS"});
  expect(v5("FINISH",{phone_number_id:"333",waba_id:"222",messaging_account_ids:["444"]})).toEqual({event:"MULTIPLE_ACCOUNTS"});
  expect(v5("FINISH",{messaging_account_ids:["222"]})).toEqual({event:"MISSING_PHONE_NUMBER"});
  expect(v5("FINISH",{phone_number_id:"333",messaging_account_ids:["abc"]})).toEqual({event:"UNSUPPORTED"});
  expect(v5("FINISH",{phone_number_id:"333",is_on_biz_app:"no",messaging_account_ids:["222"]})).toEqual({event:"UNSUPPORTED"});
  expect(v5("CANCEL",{current_step:"PHONE_NUMBER_SETUP"})).toEqual({event:"CANCEL"});
  expect(v5("ERROR",{error_message:"x",error_code:"1",session_id:"s",timestamp:"1"})).toEqual({event:"ERROR"});
});
});
