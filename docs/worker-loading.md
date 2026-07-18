# Worker Loading

Runtime worker loading is a transport contract, not a bundled worker implementation. This keeps
`@territory-kit/runtime` browser-safe and testable while allowing applications to provide a real
`Worker`, service-worker bridge, or deterministic fake transport.

## Message Schema

`@territory-kit/runtime` exports the worker message and response types:

- `initialize`: dataset id, dataset version, geometry hash, optional index hash, optional
  transferable `ArrayBuffer`
- `query`: dataset id, bounds, level
- `cancel`: request id and reason
- `dispose`: worker shutdown

Responses are:

- `initialized`
- `query-result`
- `cancelled`
- `disposed`
- `error`

The client validates every response before resolving user code: `requestId` must match the request,
the response type must match the operation, `initialized.datasetId` must match the initialize
message, and `query-result.datasetId` must match the query message. Protocol mismatches are
reported as coded `TerritoryError`s before stale data can update runtime state. Worker `error`
responses are converted to `TerritoryError` with the worker code retained in details.

## Transport

```ts
import { createTerritoryWorkerClient } from "@territory-kit/runtime";

const client = createTerritoryWorkerClient({
  send(message, transferables) {
    worker.postMessage(message, transferables);
    return waitForMatchingResponse(message.requestId);
  }
});
```

The runtime option is:

```ts
createTerritoryRuntime({
  catalog,
  workerTransport
});
```

Runtime uses the worker path when a selected catalog artifact carries a transferable binary index
buffer. Otherwise it queries the pooled core engine directly.

## Cancellation

Runtime request cancellation aborts worker initialize and query operations through the request
`AbortSignal`. The worker client sends best-effort `cancel` with the same request id and rejects
with `REQUEST_ABORTED`, so stale worker results cannot commit viewport state. New initialize/query
operations are rejected while disposal is in flight.

## Initialization Reuse

Runtime keeps a per-client registry keyed by dataset id, dataset version, geometry hash, and index
hash. The same binary catalog artifact is initialized once per worker and concurrent requests share
the same initialization promise. Failed initialization entries are removed so later requests can
retry, and runtime disposal clears the registry. Runtime copies catalog-owned buffers before
sending them and uses `transfer: false`, preserving the original artifact for future viewports.

## Transferables

`createTerritoryWorkerClient().initialize({ indexBuffer, transfer: true })` forwards the buffer in
the transfer list. Runtime itself uses `transfer: false` for catalog-owned buffers so a registered
artifact remains reusable across requests.
