# Measuring the authenticated setup journey

Open the normal `/setup#velora-performance` route in the intended signed-in account. The exact fragment enables existing fixed-stage console measurements for that tab. Removing it disables subsequent emissions. No cookies, storage, identifiers, page text, input values or telemetry destination are added. Server-side production logging remains unchanged; the fragment is not sent in HTTP requests.

Capture console rows whose `service` is `velora.setup.timing`. `elapsed_ms` uses the current document's performance clock. `duration_ms` measures an individual stage invocation. Compare cold document loads separately from client-side returns; an elapsed value on a return is not time since the navigation click. Repeated stages can represent refreshes and are not automatically duplicates.

`session_ready` and `content_visible` are React lifecycle observations, not browser paint measurements. `usable` means an admitted, non-hidden connection view has an enabled control; it does not establish successful connection, complete data readiness or save success. `entry` and `workspace` completion can include failed reads, so verify rendered results and errors alongside the timing. Never infer customer acceptance from these rows alone.

Record the deployed commit, route, selected account/branch privately, viewport actually reported by the browser, network conditions, first load versus return, visible data and interaction outcome. Use server read-performance logs separately to explain the duration; do not substitute them for click-to-data latency. Report sample counts and individual observations before claiming a percentile. A viewport override that does not take effect, unavailable screenshot or unsupported network throttling is missing evidence, not a passing mobile/slow-network test.

## Production observations, 2026-11-02

Two authenticated document reloads on `ba5b07e09a2fb315c13ceb9a8098e659d7ebc399`, normal desktop network, same branch and knowledge step:

| UTC | Session ready from document start | Entry duration | Workspace duration | Workspace completion from document start |
| --- | ---: | ---: | ---: | ---: |
| 12:30 | 3,181 ms | 4,707 ms | 966 ms | 8,875 ms |
| 12:32 | 3,637 ms | 3,216 ms | 1,503 ms | 8,365 ms |

The authenticated branch and approved knowledge rendered after both reads. These are lifecycle observations, not paint or complete knowledge-data timings. No baseline-equivalent pre-change sample, mobile result, throttled-network result or percentile is claimed. The first fragment navigation before these reloads showed a recoverable setup-read failure; reloading the current published bundle recovered, but its cause is not established.

On `6e5a4b3` at 12:37 UTC, entry took 2,383 ms in the browser while its native server execution (`setup_entry`) took 436 ms: two broker resolutions totaled 144 ms and five data HTTP calls totaled 310 ms (overlapping categories). The workspace completed at document-clock 7,453 ms. This identifies substantial time outside the measured native function; it does not isolate network, action dispatch, cold start and response processing from each other. Client and server wall clocks are not used for subtraction.

The paid entry now uses `resource=entry` on the existing private `/api/setup/read` transport. The handler still checks native identity and the captured boundary, then invokes the same inventory action/RPC. No branch identifier, cache, retry, alternate customer page or new authority grant is added. The client refuses late responses after its captured boundary changes. Cross-site reads are rejected and responses remain private/no-store. Compare the deployed GET journey against these observations before claiming improvement.

Next.js documents sequential client dispatch of Server Functions in [Mutating Data](https://nextjs.org/docs/app/getting-started/mutating-data); the installed Next.js guide repeats this constraint. This motivated removing a remaining read from that transport, not weakening the function's authorization. The timing wrapper preserves native return values and failures even when its logging sink fails.

The first GET sample on `2f38d5e` (12:44 UTC) coincided with broad server latency: session reads 7,091/13,656 ms, profile 15,095 ms and inbox 21,595 ms. Browser session readiness was 18,179 ms, entry 4,612 ms and workspace 3,408 ms. Native entry was 2,254 ms, including two broker resolutions totaling 944 ms. This sample does not establish improvement or a transport regression. Supabase's 12:42–12:46 log window separately contained five PostgreSQL timeout events, two PostgREST timeout events and one pooler timeout event; no OOM text matched. A later activity snapshot had no lock backlog. The underlying incident cause remains unproved.

Entry GET now uses the existing request-local verified client scope, including its fresh final broker/cookie fence and actor match. All native identity and inventory checks still execute. The other setup resources retain their existing paths. `setup_entry_http` measures the entire scoped operation; nested `setup_entry` measures its native inventory work, so overlapping totals must not be summed. Tests cover withholding data until the final fence, discarded data after fence failure or actor mismatch, and the shared scope's boundary/cookie/registry/concurrency isolation.
