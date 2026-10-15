import { expect, it, vi } from "vitest";
import { collectPublicKnowledge, robotsAllows } from "./public-import";
const html = "<html><body><h1>Our services</h1><p>We offer installation and support in Muscat.</p><script>hidden paid facts</script></body></html>";
const reply = (status = 200, body = html, headers: Record<string, string> = { "content-type": "text/html" }) => ({ status, body, headers });
const fixtures = () => ({ resolve: vi.fn(async () => ["93.184.216.34"]), request: vi.fn(async (url: URL) => url.pathname === "/robots.txt" ? reply(200, "User-agent: *\nAllow: /", { "content-type": "text/plain" }) : reply()) });
it("private or mixed DNS targets make no HTTP calls", async () => {
 const ports=fixtures();ports.resolve.mockResolvedValue(["93.184.216.34","127.0.0.1"]);
 expect(await collectPublicKnowledge("https://public.example/services",true,ports)).toMatchObject({ok:false,code:"UNSAFE_SOURCE"});expect(ports.request).not.toHaveBeenCalled();
});
it("DNS rebinding between robots and page cannot redirect the connection to a private address", async () => {
 const ports=fixtures();ports.resolve.mockResolvedValueOnce(["93.184.216.34"]).mockResolvedValueOnce(["10.0.0.4"]);
 expect(await collectPublicKnowledge("https://public.example/services",true,ports)).toMatchObject({ok:false,code:"UNSAFE_SOURCE"});expect(ports.request).toHaveBeenCalledTimes(1);
});
it("robots denial and private redirects prevent fetching the target page", async () => {
 const ports=fixtures();ports.request.mockResolvedValue(reply(200,"User-agent: *\nDisallow: /services",{"content-type":"text/plain"}));
 expect(await collectPublicKnowledge("https://public.example/services",true,ports)).toMatchObject({ok:false,code:"SOURCE_PERMISSION_DENIED"});expect(ports.request).toHaveBeenCalledTimes(1);
 const redirects=fixtures();redirects.request.mockImplementation(async url=>url.pathname==="/robots.txt"?reply(404,"",{}):reply(302,"",{location:"https://169.254.169.254/latest"}));
 expect(await collectPublicKnowledge("https://public.example/services",true,redirects)).toMatchObject({ok:false,code:"UNSAFE_SOURCE"});
});
it("requires rights attestation and rejects credentials, signed queries and login pages", async () => {
 const ports=fixtures();expect(await collectPublicKnowledge("https://public.example/services",false,ports)).toMatchObject({ok:false,code:"RIGHTS_ATTESTATION_REQUIRED"});
 expect(await collectPublicKnowledge("https://user:secret@public.example/services",true,ports)).toMatchObject({ok:false,code:"UNSAFE_SOURCE"});expect(await collectPublicKnowledge("https://public.example/services?token=secret",true,ports)).toMatchObject({ok:false,code:"UNSAFE_SOURCE"});
 ports.request.mockImplementation(async url=>url.pathname==="/robots.txt"?reply(404,"",{}):reply(200,"<body><input type='password'>Sign in</body>"));expect(await collectPublicKnowledge("https://public.example/services",true,ports)).toMatchObject({ok:false,code:"UNSUPPORTED_PRIVATE_OR_DYNAMIC_PAGE"});
});
it("extracts only deterministic visible text with unverified confidence and stable content hash", async () => {
 const result=await collectPublicKnowledge("https://public.example/services",true,fixtures());expect(result).toMatchObject({ok:true,data:{sourceUrl:"https://public.example/services",confidence:"unverified",text:"Our services\nWe offer installation and support in Muscat."}});
 if(result.ok){expect(result.data.text).not.toContain("hidden paid facts");expect(result.data.contentHash).toMatch(/^[a-f0-9]{64}$/);}
});
it("robots uses the most specific rule and combines matching groups", () => {
 expect(robotsAllows("User-agent: *\nDisallow: /\nAllow: /public","/public/menu")).toBe(true);
 expect(robotsAllows("User-agent: VeloraKnowledgeImporter\nDisallow: /private\nUser-agent: VeloraKnowledgeImporter\nDisallow: /billing","/billing")).toBe(false);
});
it('robots unicode paths match their URL percent encoding',()=>{expect(robotsAllows('User-agent: *\nDisallow: /خدمات','/%D8%AE%D8%AF%D9%85%D8%A7%D8%AA')).toBe(false);});
it('rejects oversized page bytes and never extracts script-only pages',async()=>{
 const p=fixtures();p.request.mockImplementation(async url=>url.pathname==='/robots.txt'?reply(404,'',{}):reply(200,'x'.repeat(1048577)));expect(await collectPublicKnowledge('https://public.example/services',true,p)).toMatchObject({ok:false,code:'CONTENT_TOO_LARGE'});
 p.request.mockImplementation(async url=>url.pathname==='/robots.txt'?reply(404,'',{}):reply(200,'<body><script>renderFacts()</script></body>'));expect(await collectPublicKnowledge('https://public.example/services',true,p)).toMatchObject({ok:false,code:'UNSUPPORTED_PRIVATE_OR_DYNAMIC_PAGE'});
});
