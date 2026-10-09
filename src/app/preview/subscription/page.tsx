import { notFound } from "next/navigation";
import { SubscriptionPreview } from "@/preview/subscription/subscription-preview";
export default function Page(){if(process.env.NODE_ENV!=="development")notFound();return <SubscriptionPreview/>;}
