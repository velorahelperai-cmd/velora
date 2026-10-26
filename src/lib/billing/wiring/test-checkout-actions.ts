"use server";
/** Legacy company checkout is retired. New account purchases use Thawani UAT. */
export type StartTestCheckoutResult = {ok:true;url:string;orderId?:string;message?:string}|{ok:false;code:string;orderId?:string;message?:string};
export async function startTestCheckoutAction(input:{planVersionId:string;clientOpId:string;expectedCompanyId?:string}):Promise<StartTestCheckoutResult>{
 void input; return {ok:false,code:"test_not_configured"};
}
export async function resumeTestCheckoutAction(input:{orderId:string}):Promise<StartTestCheckoutResult>{
 void input; return {ok:false,code:"test_not_configured"};
}
