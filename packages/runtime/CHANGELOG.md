# @territory-kit/runtime

## 1.2.0 - Unreleased

### Minor Changes

- Add the minimal runtime lifecycle foundation with state inspection, deterministic event
  subscriptions, listener error isolation, and idempotent disposal.
- Add viewport request orchestration with debounce, cancellation, stale-response guards, timeout
  errors, lazy engine reuse, async memory LRU cache, and renderer-independent adapter updates.
- Preserve committed viewport state after cancellation, bind adapter source IDs through the
  renderer-neutral adapter contract, and keep injected cache disposal external by default.
