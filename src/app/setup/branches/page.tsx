import { redirect } from "next/navigation";

/** Phase B smart branch workspace removed; classic setup owns branch UX until ES02 rebuild. */
export default function Page() {
  redirect("/setup");
}
