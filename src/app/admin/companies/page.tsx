import { redirect } from "next/navigation";

export default async function CompaniesRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await searchParams;
  const params = new URLSearchParams();
  if (resolved) {
    for (const [key, value] of Object.entries(resolved)) {
      if (typeof value === "string") params.set(key, value);
    }
  }
  const query = params.toString();
  redirect(query ? `/admin?${query}#companies` : "/admin#companies");
}
