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

Runtime request cancellation aborts the worker query through the request `AbortSignal`. The worker
client sends `cancel` with the same request id and rejects the runtime query with
`REQUEST_ABORTED`, so stale worker results cannot commit viewport state.

## Transferables

`createTerritoryWorkerClient().initialize({ indexBuffer, transfer: true })` forwards the buffer in
the transfer list. Runtime itself uses `transfer: false` for catalog-owned buffers so a registered
artifact remains reusable across requests.
