import { expect, it, vi } from "vitest";
import { Readable } from "node:stream";
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:https", () => ({ request }));
import { safeFetchWebsite } from "./safe-website-fetcher";

it("connects only to the validated IP and retains the original TLS and HTTP hostname", async () => {
  request.mockImplementation((_url, _options, callback) => ({
    on() { return this; },
    end() {
      const response = Object.assign(Readable.from([Buffer.from("<title>Shop</title>Public knowledge")]), { statusCode: 200, headers: { "content-type": "text/html" } });
      callback(response);
    },
  }));
  const lookup = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  const result = await safeFetchWebsite("https://shop.example.invalid/about", { lookupFn: lookup });
  expect(result).toMatchObject({ ok: true, extractedText: "Shop Public knowledge" });
  expect(lookup).toHaveBeenCalledTimes(1);
  const [url, options] = request.mock.calls[0];
  expect(url.hostname).toBe("93.184.216.34");
  expect(url.pathname).toBe("/about");
  expect(options.servername).toBe("shop.example.invalid");
  expect(options.headers.Host).toBe("shop.example.invalid");
});