import { TerritoryError } from "@territory-kit/dataset";
import type { TerritoryZone } from "@territory-kit/dataset";
import type { TerritoryBounds } from "@territory-kit/core";

export type TerritoryWorkerMessageType = "initialize" | "query" | "cancel" | "dispose";

export interface TerritoryWorkerMessageBase {
  readonly type: TerritoryWorkerMessageType;
  readonly requestId: string;
}

export interface TerritoryWorkerInitializeMessage extends TerritoryWorkerMessageBase {
  readonly type: "initialize";
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly geometryHash: string;
  readonly indexHash?: string;
  readonly indexBuffer?: ArrayBuffer;
}

export interface TerritoryWorkerQueryMessage extends TerritoryWorkerMessageBase {
  readonly type: "query";
  readonly datasetId: string;
  readonly bounds: TerritoryBounds;
  readonly level: number;
}

export interface TerritoryWorkerCancelMessage extends TerritoryWorkerMessageBase {
  readonly type: "cancel";
  readonly reason?: string;
}

export interface TerritoryWorkerDisposeMessage extends TerritoryWorkerMessageBase {
  readonly type: "dispose";
}

export type TerritoryWorkerMessage =
  | TerritoryWorkerInitializeMessage
  | TerritoryWorkerQueryMessage
  | TerritoryWorkerCancelMessage
  | TerritoryWorkerDisposeMessage;

export interface TerritoryWorkerInitializedResponse {
  readonly type: "initialized";
  readonly requestId: string;
  readonly datasetId: string;
  readonly indexHash?: string;
}

export interface TerritoryWorkerQueryResponse {
  readonly type: "query-result";
  readonly requestId: string;
  readonly datasetId: string;
  readonly zones: readonly TerritoryZone[];
}

export interface TerritoryWorkerCancelledResponse {
  readonly type: "cancelled";
  readonly requestId: string;
}

export interface TerritoryWorkerDisposedResponse {
  readonly type: "disposed";
  readonly requestId: string;
}

export interface TerritoryWorkerErrorResponse {
  readonly type: "error";
  readonly requestId: string;
  readonly code?: string;
  readonly message: string;
}

export type TerritoryWorkerResponse =
  | TerritoryWorkerInitializedResponse
  | TerritoryWorkerQueryResponse
  | TerritoryWorkerCancelledResponse
  | TerritoryWorkerDisposedResponse
  | TerritoryWorkerErrorResponse;

export interface TerritoryWorkerTransport {
  send(
    message: TerritoryWorkerMessage,
    transferables?: readonly Transferable[]
  ): Promise<TerritoryWorkerResponse>;
}

export interface TerritoryWorkerClientInitializeInput {
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly geometryHash: string;
  readonly indexHash?: string;
  readonly indexBuffer?: ArrayBuffer;
  readonly transfer?: boolean;
}

export interface TerritoryWorkerClientQueryInput {
  readonly datasetId: string;
  readonly bounds: TerritoryBounds;
  readonly level: number;
}

export interface TerritoryWorkerClientContext {
  readonly requestId?: string;
  readonly signal?: AbortSignal;
}

export interface TerritoryWorkerClient {
  initialize(
    input: TerritoryWorkerClientInitializeInput,
    context?: TerritoryWorkerClientContext
  ): Promise<TerritoryWorkerInitializedResponse>;
  query(
    input: TerritoryWorkerClientQueryInput,
    context?: TerritoryWorkerClientContext
  ): Promise<TerritoryWorkerQueryResponse>;
  cancel(requestId: string, reason?: string): Promise<TerritoryWorkerCancelledResponse>;
  dispose(): Promise<TerritoryWorkerDisposedResponse>;
}

export function createTerritoryWorkerClient(
  transport: TerritoryWorkerTransport
): TerritoryWorkerClient {
  let sequence = 0;
  let disposed = false;

  function nextRequestId(prefix: string): string {
    sequence += 1;
    return `territory-worker-${prefix}-${sequence}`;
  }

  async function sendExpected<T extends TerritoryWorkerResponse>(
    message: TerritoryWorkerMessage,
    expectedType: T["type"],
    transferables: readonly Transferable[] = []
  ): Promise<T> {
    if (disposed && message.type !== "dispose") {
      throw new TerritoryError("RUNTIME_DISPOSED", "Territory worker client has been disposed.");
    }

    const response = await transport.send(message, transferables);

    if (response.type === "error") {
      throw new TerritoryError("UNKNOWN", response.message, {
        details: { workerCode: response.code ?? "UNKNOWN", requestId: response.requestId }
      });
    }

    if (response.type !== expectedType) {
      throw new TerritoryError("ARTIFACT_CORRUPTED", "Worker returned an unexpected response.", {
        details: {
          requestId: message.requestId,
          expectedType,
          actualType: response.type
        }
      });
    }

    return response as T;
  }

  async function throwIfAborted(signal: AbortSignal | undefined, requestId: string): Promise<void> {
    if (!signal?.aborted) {
      return;
    }

    await client.cancel(requestId, "aborted");
    throw new TerritoryError("REQUEST_ABORTED", `Worker request '${requestId}' was aborted.`, {
      details: { requestId }
    });
  }

  const client: TerritoryWorkerClient = {
    initialize(input, context = {}) {
      const requestId = context.requestId ?? nextRequestId("initialize");
      const transferables = input.transfer === true && input.indexBuffer ? [input.indexBuffer] : [];

      return sendExpected<TerritoryWorkerInitializedResponse>(
        {
          type: "initialize",
          requestId,
          datasetId: input.datasetId,
          datasetVersion: input.datasetVersion,
          geometryHash: input.geometryHash,
          ...(input.indexHash ? { indexHash: input.indexHash } : {}),
          ...(input.indexBuffer ? { indexBuffer: input.indexBuffer } : {})
        },
        "initialized",
        transferables
      );
    },
    async query(input, context = {}) {
      const requestId = context.requestId ?? nextRequestId("query");
      await throwIfAborted(context.signal, requestId);

      let abortListener: (() => void) | undefined;
      const abortPromise = new Promise<never>((_, reject) => {
        abortListener = () => {
          void client.cancel(requestId, "aborted");
          reject(
            new TerritoryError("REQUEST_ABORTED", `Worker request '${requestId}' was aborted.`, {
              details: { requestId }
            })
          );
        };
        context.signal?.addEventListener("abort", abortListener, { once: true });
      });
      const queryPromise = sendExpected<TerritoryWorkerQueryResponse>(
        {
          type: "query",
          requestId,
          datasetId: input.datasetId,
          bounds: input.bounds,
          level: input.level
        },
        "query-result"
      );

      try {
        return await (context.signal ? Promise.race([queryPromise, abortPromise]) : queryPromise);
      } finally {
        if (abortListener) {
          context.signal?.removeEventListener("abort", abortListener);
        }
      }
    },
    cancel(requestId, reason = "cancelled") {
      return sendExpected<TerritoryWorkerCancelledResponse>(
        {
          type: "cancel",
          requestId,
          reason
        },
        "cancelled"
      );
    },
    async dispose() {
      if (disposed) {
        return {
          type: "disposed",
          requestId: "territory-worker-dispose-already"
        };
      }

      const requestId = nextRequestId("dispose");
      const response = await sendExpected<TerritoryWorkerDisposedResponse>(
        {
          type: "dispose",
          requestId
        },
        "disposed"
      );
      disposed = true;
      return response;
    }
  };

  return client;
}
