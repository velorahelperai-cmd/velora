// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Tabs } from "./ui";
import { AccessibleDialog } from "./accessible-dialog";
vi.mock("@/lib/demo-state", () => ({useDemo: () => ({locale:"ar"})}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});

it("tabs support RTL arrows, Home, End and a single tab stop", async () => {
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host),change=vi.fn();
 await act(async()=>root.render(<Tabs panelId="content" tabs={[{id:"a",label:"أ"},{id:"b",label:"ب"}]} value="a" onChange={change}/>));
 const buttons=host.querySelectorAll("button");buttons.forEach(b=>b.style.direction="rtl");
 expect(buttons[0].tabIndex).toBe(0);expect(buttons[1].tabIndex).toBe(-1);
 await act(async()=>buttons[0].dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true})));
 expect(change).toHaveBeenLastCalledWith("b");expect(document.activeElement).toBe(buttons[1]);
 await act(async()=>buttons[1].dispatchEvent(new KeyboardEvent("keydown",{key:"Home",bubbles:true})));
 expect(change).toHaveBeenLastCalledWith("a");expect(buttons[0].getAttribute("aria-controls")).toBe("content");
 await act(async()=>root.unmount());host.remove();
});

it("native dialog is modal, blocks busy cancellation and restores focus",async()=>{
 const show=vi.fn(function(this:HTMLDialogElement){this.open=true;});
 const close=vi.fn(function(this:HTMLDialogElement){this.open=false;});
 HTMLDialogElement.prototype.showModal=show;HTMLDialogElement.prototype.close=close;
 const trigger=document.createElement("button"),host=document.createElement("div");document.body.append(trigger,host);trigger.focus();
 const root=createRoot(host),onClose=vi.fn();
 await act(async()=>root.render(<AccessibleDialog label="تعديل الصلاحية" busy onClose={onClose}><button>إلغاء</button></AccessibleDialog>));
 expect(show).toHaveBeenCalledTimes(1);
 await act(async()=>host.querySelector("dialog")!.dispatchEvent(new Event("cancel",{cancelable:true})));
 expect(onClose).not.toHaveBeenCalled();
 await act(async()=>root.render(<AccessibleDialog label="تعديل الصلاحية" onClose={onClose}><button>إلغاء</button></AccessibleDialog>));
 await act(async()=>host.querySelector("dialog")!.dispatchEvent(new Event("cancel",{cancelable:true})));
 expect(onClose).toHaveBeenCalledTimes(1);
 await act(async()=>root.unmount());expect(close).toHaveBeenCalled();expect(document.activeElement).toBe(trigger);host.remove();trigger.remove();
});
