import type { LandingCopy } from "@/lib/landing-copy";

const links = [
  ["about", "#about"],
  ["how", "#how"],
  ["activities", "#activities"],
  ["packages", "#packages"],
  ["faq", "#faq"],
  ["contact", "#contact"],
  ["privacy", "/privacy"],
  ["terms", "/terms"],
] as const;

export function SiteFooter({ copy }: { copy: LandingCopy }) {
  return (
    <footer data-seq="footer" className="bg-[#07110d] px-6 py-10 text-[#f7fbf8] lg:px-12">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-6 border-t border-white/10 pt-8">
        <div>
          <p className="text-xl font-bold">Velora</p>
          <p className="mt-2 max-w-[46ch] text-sm leading-6 text-[#adbeaf]">{copy.about}</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-3">
          {links.map(([key, href]) => (
            <a key={key} href={href} className="inline-flex min-h-11 items-center text-sm underline">
              {copy.footer[key as keyof typeof copy.footer]}
            </a>
          ))}
        </nav>
        <p className="text-sm text-[#adbeaf]">{copy.copyright}</p>
      </div>
    </footer>
  );
}
