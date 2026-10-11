import type {Metadata} from "next";
import {renderTeamsRoute,type TeamSearchParams} from "@/components/teams/teams-route";
export const metadata:Metadata={title:"Internal teams · Velora Admin"};
export default async function Page({searchParams}:{searchParams:TeamSearchParams}){return renderTeamsRoute(true,searchParams);}
