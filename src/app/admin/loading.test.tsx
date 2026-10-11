import {existsSync} from "node:fs";
import {join} from "node:path";
import {expect,it,vi} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
vi.mock("@/lib/demo-state",()=>({useDemo:()=>({locale:"en"})}));
it("provides a safe admin loading boundary for dynamic navigation",async()=>{
 const file=join(process.cwd(),"src/app/admin/loading.tsx");
 expect(existsSync(file)).toBe(true);
 if(!existsSync(file))return;
 const {default:Loading}=await import("./loading");
 const html=renderToStaticMarkup(createElement(Loading));
 expect(html).toContain('role="status"');expect(html).toContain('aria-busy="true"');
 expect(html).toContain("Loading admin records");expect(html).not.toContain("OMR");
});
