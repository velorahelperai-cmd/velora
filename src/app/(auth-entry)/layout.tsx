import type { ReactNode } from "react";
import { AuthEntryExperience } from "@/components/app/auth-pages";
export default function AuthEntryLayout({children}:{children:ReactNode}) { return <><AuthEntryExperience />{children}</>; }
