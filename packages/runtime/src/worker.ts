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
  let disposing = false;

  function nextRequestId(prefix: string): string {
    sequence += 1;
    return `territory-worker-${prefix}-${sequence}`;
  }

  async function sendExpected<T extends TerritoryWorkerResponse>(
    message: TerritoryWorkerMessage,
    expectedType: T["type"],
    transferables: readonly Transferable[] = []
  ): Promise<T> {
    if ((disposed || disposing) && message.type !== "dispose" && message.type !== "cancel") {
      throw new TerritoryError("RUNTIME_DISPOSED", "Territory worker client has been disposed.");
    }

    const response = await transport.send(message, transferables);
    assertWorkerResponseProtocol(message, response, expectedType);

    if (response.type === "error") {
      throw new TerritoryError("UNKNOWN", response.message, {
        details: { workerCode: response.code ?? "UNKNOWN", requestId: response.requestId }
      });
    }

    return response as T;
  }

  async function throwIfAborted(signal: AbortSignal | undefined, requestId: string): Promise<void> {
    if (!signal?.aborted) {
      return;
    }

    await cancelSafely(requestId, "aborted");
    throw new TerritoryError("REQUEST_ABORTED", `Worker request '${requestId}' was aborted.`, {
      details: { requestId }
    });
  }

  function createAbortError(requestId: string): TerritoryError {
    return new TerritoryError("REQUEST_ABORTED", `Worker request '${requestId}' was aborted.`, {
      details: { requestId }
    });
  }

  async function cancelSafely(requestId: string, reason: string): Promise<void> {
    try {
      await client.cancel(requestId, reason);
    } catch {
      // Cancellation is best-effort; the original abort/dispose path owns the visible result.
    }
  }

  async function sendAbortableExpected<T extends TerritoryWorkerResponse>(
    message: TerritoryWorkerMessage,
    expectedType: T["type"],
    input: {
      readonly signal?: AbortSignal;
      readonly transferables?: readonly Transferable[];
    } = {}
  ): Promise<T> {
    await throwIfAborted(input.signal, message.requestId);

    let abortListener: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      abortListener = () => {
        void cancelSafely(message.requestId, "aborted");
        reject(createAbortError(message.requestId));
      };
      input.signal?.addEventListener("abort", abortListener, { once: true });
    });
    const responsePromise = sendExpected<T>(message, expectedType, input.transferables ?? []);

    try {
      return await (input.signal ? Promise.race([responsePromise, abortPromise]) : responsePromise);
    } finally {
      if (abortListener) {
        input.signal?.removeEventListener("abort", abortListener);
      }
    }
  }

  const client: TerritoryWorkerClient = {
    initialize(input, context = {}) {
      const requestId = context.requestId ?? nextRequestId("initialize");
      const transferables = input.transfer === true && input.indexBuffer ? [input.indexBuffer] : [];

      return sendAbortableExpected<TerritoryWorkerInitializedResponse>(
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
        {
          ...(context.signal ? { signal: context.signal } : {}),
          transferables
        }
      );
    },
    async query(input, context = {}) {
      const requestId = context.requestId ?? nextRequestId("query");
      return sendAbortableExpected<TerritoryWorkerQueryResponse>(
        {
          type: "query",
          requestId,
          datasetId: input.datasetId,
          bounds: input.bounds,
          level: input.level
        },
        "query-result",
        {
          ...(context.signal ? { signal: context.signal } : {})
        }
      );
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

      disposing = true;
      const requestId = nextRequestId("dispose");
      try {
        const response = await sendExpected<TerritoryWorkerDisposedResponse>(
          {
            type: "dispose",
            requestId
          },
          "disposed"
        );
        disposed = true;
        return response;
      } finally {
        disposing = false;
      }
    }
  };

  return client;
}

function assertWorkerResponseProtocol(
  message: TerritoryWorkerMessage,
  response: TerritoryWorkerResponse,
  expectedType: TerritoryWorkerResponse["type"]
): void {
  if (response.requestId !== message.requestId) {
    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      "Worker protocol invalid: response requestId does not match the request.",
      {
        details: {
          expectedRequestId: message.requestId,
          actualRequestId: response.requestId,
          expectedType,
          actualType: response.type
        }
      }
    );
  }

  if (response.type !== expectedType && response.type !== "error") {
    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      "Worker protocol invalid: response type does not match the request.",
      {
        details: {
          requestId: message.requestId,
          expectedType,
          actualType: response.type
        }
      }
    );
  }

  if (
    message.type === "initialize" &&
    response.type === "initialized" &&
    response.datasetId !== message.datasetId
  ) {
    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      "Worker protocol invalid: initialized datasetId does not match the request.",
      {
        details: {
          requestId: message.requestId,
          expectedDatasetId: message.datasetId,
          actualDatasetId: response.datasetId
        }
      }
    );
  }

  if (
    message.type === "query" &&
    response.type === "query-result" &&
    response.datasetId !== message.datasetId
  ) {
    throw new TerritoryError(
      "ARTIFACT_CORRUPTED",
      "Worker protocol invalid: query-result datasetId does not match the request.",
      {
        details: {
          requestId: message.requestId,
          expectedDatasetId: message.datasetId,
          actualDatasetId: response.datasetId
        }
      }
    );
  }
}
