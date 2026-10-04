import type { LandingCopy } from "@/lib/landing-copy";

const links = [
  ["about", "#about"],
  ["how", "#how"],
  ["packages", "#packages"],
  ["contact", "#contact"],
  ["privacy", "/privacy"],
  ["terms", "/terms"],
  ["deletion", "/data-deletion"],
] as const;

export function SiteFooter({ copy }: { copy: LandingCopy }) {
  return (
    <footer data-seq="footer" className="bg-[#07110d] px-6 py-10 text-[#f7fbf8] lg:px-12">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-6 border-t border-white/10 pt-8">
        <div>
          <p className="text-xl font-bold">Velora</p>
          <p className="mt-2 max-w-[46ch] text-base leading-7 text-[#d5e4da]">{copy.about}</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-3">
          {links.map(([key, href]) => (
            <a key={key} href={href} className="inline-flex min-h-11 items-center text-base underline underline-offset-4">
              {copy.footer[key as keyof typeof copy.footer]}
            </a>
          ))}
        </nav>
        <p className="max-w-[70ch] text-sm leading-6 text-[#adbeaf]">{copy.companyLine}</p>
        <p className="text-sm text-[#adbeaf]">{copy.copyright}</p>
      </div>
    </footer>
  );
}
