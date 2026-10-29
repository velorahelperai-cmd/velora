import {redirect} from 'next/navigation';

export const dynamic='force-dynamic';
export const metadata={title:'VELORA QA · Internal simulation',robots:{index:false,follow:false}};
export default async function Page(){
 redirect('/setup');
}
