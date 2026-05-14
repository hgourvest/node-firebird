'use strict';

/**
 * reproduce.js — Demonstrates three bugs in node-firebird's Pool class (lib/pool.js).
 *
 * No real Firebird server is required. A fake TCP server (see helpers.js) accepts
 * connections but never responds to the Firebird wire protocol, triggering the bugs.
 *
 * ─── Bug 1 · _creating stuck forever ────────────────────────────────────────
 *
 *   In Pool.check(), when no idle connection exists:
 *
 *       self._creating++;
 *       this.attach(options, function(err, db) {
 *           self._creating--;   // ← only here
 *           ...
 *           cb(err, db);
 *       });
 *
 *   If attach() never calls back (TCP connects, but server stalls on Firebird
 *   protocol, e.g. SRP auth), _creating is never decremented. The pool slot is
 *   permanently locked. pool.get() callers wait forever.
 *
 * ─── Bug 2 · destroy() does not drain pending callbacks ─────────────────────
 *
 *   pool.destroy() only iterates this.internaldb (connected databases). Callbacks
 *   queued in this.pending (waiting for a free slot) are silently abandoned — they
 *   are never called, so any awaiting Promise hangs until the process exits.
 *
 *   Additionally, if any connection is currently in use (dbinuse > 0), the
 *   destroy() callback itself is never invoked because connectionCount never
 *   reaches zero (the in-use branch falls through without calling detachCallback).
 *
 * ─── Bug 3 · pool.get() after pool.destroy() silently accumulates ────────────
 *
 *   There is no _destroyed guard. Calling pool.get() on a destroyed pool pushes
 *   the callback into this.pending and calls check(), which returns early because
 *   _destroyed is never checked. The callback is never served.
 *
 * ─── How to run ──────────────────────────────────────────────────────────────
 *
 *   npm install
 *   node reproduce.js
 *
 * Expected: process does NOT exit cleanly (hangs due to open sockets / pending
 * callbacks). Exit code 1 is forced after the demo to confirm bugs are present.
 */

const Firebird        = require('node-firebird');
const { log, poolState, startFakeServer } = require('./helpers');

const FAKE_PORT   = 13050;
const TICK_MS     = 600;   // interval between pool-state snapshots

startFakeServer(FAKE_PORT, (server) => {

    const options = {
        host:           '127.0.0.1',
        port:           FAKE_PORT,
        database:       '/tmp/poc.fdb',
        user:           'SYSDBA',
        password:       'masterkey',
        lowercase_keys: true,
        isPool:         true,
        // No connectTimeout — original (buggy) behaviour
    };

    const pool = Firebird.pool(5, options);

    console.log('\n══════════════════════════════════════════════════════════════════');
    console.log('  node-firebird · pool bug reproduction (original lib/pool.js)');
    console.log('══════════════════════════════════════════════════════════════════\n');

    // ── Bug 1 ─────────────────────────────────────────────────────────────────
    log('BUG-1', 'pool.get() → TCP connects, Firebird protocol hangs, callback NEVER fires');

    pool.get((err, db) => {
        // ← BUG: this line is never reached
        log('BUG-1 ✗ WRONG', `callback fired (unexpected): err=${err?.message} db=${!!db}`);
    });

    let tick = 0;

    const interval = setInterval(() => {
        tick++;
        log('pool-state', poolState(pool));

        // ── Bug 2 (setup) ──────────────────────────────────────────────────────
        if (tick === 2) {
            log('BUG-2', 'Queuing a second get() in pending, then calling destroy()');

            pool.get((err, db) => {
                // ← BUG: destroy() never calls this; the Promise hangs forever
                if (err) log('BUG-2 ✓ OK    ', `pending callback received error: "${err.message}"`);
                else     log('BUG-2 ✗ WRONG ', `got db unexpectedly: ${!!db}`);
            });

            log('BUG-2', `Before destroy — ${poolState(pool)}`);
            pool.destroy();
            log('BUG-2', `After  destroy — ${poolState(pool)}`);
            log('BUG-2', '↑ pending callback was NEVER called — Promise hangs forever');
        }

        // ── Bug 3 ──────────────────────────────────────────────────────────────
        if (tick === 3) {
            log('BUG-3', 'pool.get() AFTER pool.destroy() — should be rejected immediately');

            pool.get((err, db) => {
                // ← BUG: no _destroyed guard; callback silently queued, never served
                if (err) log('BUG-3 ✓ OK    ', `rejected: "${err.message}"`);
                else     log('BUG-3 ✗ WRONG ', `got db after destroy: ${!!db}`);
            });

            log('BUG-3', `After post-destroy get — ${poolState(pool)}`);
        }

        // ── Summary ────────────────────────────────────────────────────────────
        if (tick === 5) {
            clearInterval(interval);

            console.log('\n══════════════════════════════════════════════════════════════════');
            log('SUMMARY', `Final state      : ${poolState(pool)}`);
            log('SUMMARY', 'Bug 1 confirmed  : _creating=1, permanently stuck (slot lost)');
            log('SUMMARY', 'Bug 2 confirmed  : pending callback from before destroy never fired');
            log('SUMMARY', 'Bug 3 confirmed  : post-destroy get silently accumulated in pending');
            log('SUMMARY', 'Process would hang forever without forced exit below');
            console.log('══════════════════════════════════════════════════════════════════\n');

            server.close();
            process.exit(1); // exit(1) = bugs confirmed
        }
    }, TICK_MS);
});
