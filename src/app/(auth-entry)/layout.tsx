import type { ReactNode } from "react";
import { AuthEntryExperience } from "@/components/app/auth-pages";
/** Preview auth can spend multi-10s on continuity/provider; keep the action under the platform limit. */
export const maxDuration = 120;
export default function AuthEntryLayout({children}:{children:ReactNode}) { return <><AuthEntryExperience />{children}</>; }
