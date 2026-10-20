import { beforeEach, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { phoneCallingCode, supportedPhoneCountry } from "@/lib/business-phone-input";
import { countries } from "./country-options";
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
vi.mock("react", async () => ({
  ...await vi.importActual<typeof import("react")>("react"),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: unknown) => {
      hooks.slots[index] = typeof value === "function" ? (value as (old: unknown) => unknown)(hooks.slots[index]) : value;
    }];
  },
  useRef: () => ({ current: null }),
  useEffect: () => {},
}));
import { CountryCombobox } from "./country-combobox";
type Props = { children?: ReactNode; role?: string; dir?: string; value?: string; "aria-expanded"?: boolean; onFocus?: () => void; onChange?: (e: { target: { value: string } }) => void; onKeyDown?: (e: { key: string; preventDefault: () => void }) => void };
function all(root: ReactNode): ReactElement<Props>[] {
  const result: ReactElement<Props>[] = [];
  Children.forEach(root, node => {
    if (isValidElement<Props>(node)) { result.push(node); result.push(...all(node.props.children)); }
  });
  return result;
}
beforeEach(() => { hooks.slots = []; hooks.cursor = 0; });
it.each([false, true])("preserves every supported dialing country and isolated codes, Arabic=%s", ar => {
  const onChange = vi.fn();
  const render = () => { hooks.cursor = 0; return CountryCombobox({ id: "phone", value: "OM", ar, disabled: false, onChange, compactOptions: true, labelSuffix: phoneCallingCode, allowCountry: supportedPhoneCountry }); };
  all(render()).find(x => x.props.role === "combobox")?.props.onFocus?.();
  const nodes = all(render());
  expect(nodes.filter(x => x.props.role === "option")).toHaveLength(countries.filter(x => supportedPhoneCountry(x.code)).length);
  const codes = nodes.filter(x => x.type === "bdi");
  expect(codes).toHaveLength(countries.filter(x => supportedPhoneCountry(x.code)).length);
  expect(codes.every(x => x.props.dir === "ltr")).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
});
it.each([false, true])("keeps keyboard search/selection and Escape behavior, Arabic=%s", ar => {
  const onChange = vi.fn();
  const render = () => { hooks.cursor = 0; return CountryCombobox({ id: "phone", value: "OM", ar, disabled: false, onChange, compactOptions: true, labelSuffix: phoneCallingCode, allowCountry: supportedPhoneCountry }); };
  const input = () => all(render()).find(x => x.props.role === "combobox")!;
  input().props.onFocus?.();
  input().props.onChange?.({ target: { value: "+93" } });
  expect(all(render()).filter(x => x.props.role === "option")).toHaveLength(1);
  input().props.onKeyDown?.({ key: "Enter", preventDefault: vi.fn() });
  expect(onChange).toHaveBeenCalledExactlyOnceWith("AF");
  expect(input().props["aria-expanded"]).toBe(false);
  input().props.onFocus?.();
  input().props.onKeyDown?.({ key: "Escape", preventDefault: vi.fn() });
  expect(input().props["aria-expanded"]).toBe(false);
  expect(onChange).toHaveBeenCalledTimes(1);
});
