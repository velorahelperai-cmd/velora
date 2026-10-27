import {es02Uuid} from '@/lib/billing/es02/contracts';
import {PopupReturn} from './popup-return';
export default async function Page({params}:{params:Promise<{orderId:string}>}){
 const {orderId}=await params;
 if(!es02Uuid(orderId))return <p>تعذر تحديد الطلب.</p>;
 // Presentation only: this route never grants payment or provisioning authority.
 return <PopupReturn orderId={orderId}/>;
}
