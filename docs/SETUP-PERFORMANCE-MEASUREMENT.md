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

The entry remains a Server Action, while subsequent branch reads use GET transport. Instrument its native server execution as `setup_entry` before attributing its duration to action queuing, broker work or the inventory RPC. The timing wrapper must preserve native return values and failures, even when its logging sink fails.
