# node-firebird pool — Bug PoC & Fix

Proof of concept for three bugs in `lib/pool.js` (node-firebird ≥ 2.x).  
No real Firebird server is needed — a tiny fake TCP server simulates the failure scenario.

---

## The bugs

### Bug 1 — `_creating` stuck forever (critical)

**File:** `lib/pool.js` → `Pool.check()`

When no idle connection exists, `check()` calls `this.attach()` and increments `_creating`. The counter is only decremented **inside the `attach()` callback**. If the server accepts TCP but never responds to the Firebird wire protocol (e.g. during SRP authentication under load), the callback never fires. `_creating` stays elevated permanently, the slot is lost, and every `pool.get()` caller waits forever.

```
// original code
self._creating++;
this.attach(self.options, function (err, db) {
    self._creating--;   // ← never reached if attach() hangs
    cb(err, db);        // ← caller never notified
});
```

**Real-world log signature:**
```
*ERRO* Timeout (15000ms) ao aguardar conexão para tenant X.
       Estado do pool: {"dbinuse":0,"_creating":1,"pending":0,"idle":4}
```

**Fix:** `connectTimeout` option — a `setTimeout` wraps the `attach()` call. On expiry, `_creating` is decremented and the caller receives an error immediately. A late-arriving connection (if attach eventually completes) is discarded safely.

---

### Bug 2 — `destroy()` does not drain the `pending` queue

**File:** `lib/pool.js` → `Pool.destroy()`

Callbacks queued in `this.pending` (waiting for a free pool slot) are silently abandoned when `destroy()` is called. Their callers hang indefinitely — there is no error, no timeout, nothing. This is especially harmful when `destroy()` is used as a recovery strategy after a stuck pool.

**Fix:** `this.pending.splice(0)` at the start of `destroy()` calls every waiting callback with `Error('Pool is being destroyed')` before any connection is closed.

---

### Bug 3 — `pool.get()` after `pool.destroy()` silently accumulates

**File:** `lib/pool.js` → `Pool.get()` and `Pool.check()`

There is no `_destroyed` flag. Calling `pool.get()` on an already-destroyed pool pushes the callback into `this.pending` and calls `check()`. `check()` returns early because all slots are gone, but the callback is never served. The caller hangs forever.

**Fix:** `_destroyed = true` is set in `destroy()`. Both `get()` and `check()` check it and reject immediately with `Error('Pool has been destroyed')`.

---

### Bug 4 (minor) — `destroy()` callback never fires when connections are in use

**File:** `lib/pool.js` → `Pool.destroy()`

The original `destroy()` only calls `detachCallback()` for connections found in `pooldb` (idle). Connections currently in use (`dbinuse > 0`) fall through the `forEach` without decrementing `connectionCount`, so it never reaches zero and the `destroy()` completion callback is never invoked.

**Fix:** The `else` branch counts in-use connections down without forcing a detach — releasing them remains the caller's responsibility.

---

## Files

| File | Purpose |
|------|---------|
| `helpers.js` | Shared logging and fake-server factory |
| `reproduce.js` | Demonstrates all bugs — exits with code **1** |
| `reproduce-fixed.js` | Validates all fixes — exits with code **0** |
| `pool-patched.js` | Drop-in replacement for `lib/pool.js` |

---

## How to run

```bash
npm install

# Show the bugs (process hangs → forced exit 1)
node reproduce.js

# Show the fixes (process exits cleanly → exit 0)
node reproduce-fixed.js
```

---

## Expected output

### `node reproduce.js` (bugs present)

```
[fake-server]          Listening on 127.0.0.1:13050 ...
[BUG-1]                pool.get() → TCP connects, Firebird protocol hangs, callback NEVER fires
[pool-state]           creating=1  idle=0  inuse=0  pending=0  destroyed=(no flag)
[pool-state]           creating=1  idle=0  inuse=0  pending=0  destroyed=(no flag)
[BUG-2]                Queuing a second get() in pending, then calling destroy()
[BUG-2]                Before destroy — creating=1  idle=0  inuse=0  pending=1 ...
[BUG-2]                After  destroy — creating=1  idle=0  inuse=0  pending=1 ...  ← pending NOT drained
[BUG-2]                ↑ pending callback was NEVER called — Promise hangs forever
[BUG-3]                pool.get() AFTER pool.destroy() — should be rejected immediately
[BUG-3]                After post-destroy get — creating=1  idle=0  inuse=0  pending=2 ...
[SUMMARY]              Bug 1 confirmed  : _creating=1, permanently stuck (slot lost)
[SUMMARY]              Bug 2 confirmed  : pending callback from before destroy never fired
[SUMMARY]              Bug 3 confirmed  : post-destroy get silently accumulated in pending
```

### `node reproduce-fixed.js` (fixes applied)

```
[fake-server]          Listening on 127.0.0.1:13051 ...
[FIX-1]                pool.get() — attach() will hang, timeout fires after 1500 ms
[pool-state]           creating=1  idle=0  inuse=0  pending=0  destroyed=false
[pool-state]           creating=1  idle=0  inuse=0  pending=0  destroyed=false
[FIX-1 ✓ OK]           callback received error (expected): "Connection timeout after 1500ms"
[pool-state]           creating=0  idle=0  inuse=0  pending=0  destroyed=false  ← back to 0 ✓
[FIX-4]                Queuing a get() in pending, then destroying pool immediately
[FIX-4 ✓ OK]           pending callback received error: "Pool is being destroyed"  ← immediate ✓
[FIX-4]                After  destroy — creating=0  idle=0  inuse=0  pending=0  destroyed=true
[FIX-2]                pool.get() AFTER pool.destroy() — must be rejected immediately
[FIX-2 ✓ OK]           immediately rejected: "Pool has been destroyed"  ← no accumulation ✓
[SUMMARY]              Fix 1 confirmed  : _creating returned to 0 after 1500 ms timeout
[SUMMARY]              Fix 2 confirmed  : post-destroy get() rejected immediately (_destroyed flag)
[SUMMARY]              Fix 4 confirmed  : pending callback drained synchronously by destroy()
```

---

## Proposed change to `lib/index.d.ts`

Add `connectTimeout` to the `Options` interface:

```typescript
export interface Options {
    // ... existing fields ...

    /**
     * Timeout in milliseconds for a single pool.get() attach operation.
     * If attach() does not complete within this time the slot is freed,
     * the caller receives an error, and any late-arriving connection is
     * safely discarded. Set to 0 or omit to disable (default: no timeout).
     *
     * Recommended value: 5000–10000 ms depending on network latency and
     * expected Firebird server response time under load.
     */
    connectTimeout?: number;
}
```

---

## Backward compatibility

All changes are **fully backward-compatible**:

- `connectTimeout` is optional and defaults to disabled (`undefined > 0` is `false`)
- `_destroyed` defaults to `false` — existing code paths are unchanged
- `destroy()` draining of `pending` is new behaviour but harmless for callers that did not add pending requests before calling `destroy()`
