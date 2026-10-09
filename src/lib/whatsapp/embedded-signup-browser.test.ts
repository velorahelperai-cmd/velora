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
  expect(parseSignupMessage("https://www.facebook.com",{type:"WA_EMBEDDED_SIGNUP",event:"FINISH",data:{waba_ids:["222","444"],phone_number_id:"333"}})).toEqual({event:"UNSUPPORTED"});
 });
 it("uses the documented v4 code-exchange SDK contract",()=>{
  expect(signupLoginOptions("444")).toEqual({config_id:"444",response_type:"code",override_default_response_type:true,extras:{setup:{}}});
 });
});
