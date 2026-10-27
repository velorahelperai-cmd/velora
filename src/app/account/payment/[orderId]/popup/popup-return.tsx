"use client";
import {useEffect} from 'react';
export function PopupReturn({orderId}:{orderId:string}){
 useEffect(()=>{
  try{if(typeof BroadcastChannel!=='undefined'){
   const channel=new BroadcastChannel('velora-payment');
   channel.postMessage({type:'velora-payment-return',orderId});channel.close();
  }}catch{/* The original dialog also verifies on focus and through bounded polling. */}
  window.close();
 },[orderId]);
 return <main dir="rtl" style={{padding:24,fontFamily:'Tajawal,Arial,sans-serif'}}><h1>جارٍ التحقق من نتيجة الدفع</h1><p>يمكنك العودة إلى نافذة فيلورا الأصلية؛ حالة الطلب تُراجع هناك من الخادم.</p><a href={`/account/payment/${orderId}`}>متابعة التحقق من نفس الطلب</a></main>;
}
