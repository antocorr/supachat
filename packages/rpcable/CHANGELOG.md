# Changelog

## 0.2.0 - 2026-03-16

### Added

- Standalone helpers `extend(proxy, handlers)`, `getInstance(proxy)`, and `getTransport(proxy)` for working with RpcAble proxies without reserving RPC method names.
- Native WebSocket lifecycle handling that buffers calls while the socket is still connecting and auto-destroys pending requests on close.
- An `rpcable-session-lab` skill plus reusable session scripts for reproducing transport-specific session bugs.

### Changed

- HTTP now matches the fire-and-forget default used by socket.io and native WebSocket; call `.request()` or `.expects()` when you need a returned value.
- Examples, templates, docs, and tests now use `extend(proxy, ...)` and explicit `.request()` calls where a response is expected.
- Type exports and README guidance now reflect the new helper-based API surface.

### Breaking Changes

- `userSession.extend(...)` has been removed in favor of `extend(userSession, ...)`.
- Direct `await userSession.someMethod()` is no longer supported on HTTP; use `.request()` or `.expects()` instead.
