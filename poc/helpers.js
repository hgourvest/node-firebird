'use strict';

/**
 * Shared helpers used by reproduce.js and reproduce-fixed.js.
 */

const net = require('net');

/** Timestamp prefix for log lines (HH:MM:SS.mmm) */
function ts() {
    return new Date().toISOString().slice(11, 23);
}

/** Structured log with fixed-width tag */
function log(tag, msg) {
    console.log(`[${ts()}] ${tag.padEnd(22)} ${msg}`);
}

/** Compact pool state string */
function poolState(pool) {
    return (
        `creating=${pool._creating}  ` +
        `idle=${pool.pooldb.length}  ` +
        `inuse=${pool.dbinuse}  ` +
        `pending=${pool.pending.length}  ` +
        `destroyed=${pool._destroyed ?? '(no flag)'}`
    );
}

/**
 * Starts a TCP server that accepts connections but NEVER responds to data.
 *
 * This simulates a Firebird server that:
 *   - Completes the TCP three-way handshake (SYN / SYN-ACK / ACK)
 *   - Receives the initial op_connect packet from the client
 *   - Never sends op_accept_data back
 *
 * Result: node-firebird's attach() callback is never called, reproducing the
 * scenario where _creating is permanently incremented.
 */
function startFakeServer(port, onReady) {
    const server = net.createServer((socket) => {
        log('fake-server', `TCP accepted from :${socket.remotePort} — will NOT respond to Firebird protocol`);
        socket.on('data', () => { /* receive op_connect but ignore it */ });
        socket.on('error', () => { /* suppress errors on forced cleanup */ });
    });

    server.on('error', (err) => {
        console.error(`[fake-server] Error: ${err.message}`);
        process.exit(1);
    });

    server.listen(port, '127.0.0.1', () => {
        log('fake-server', `Listening on 127.0.0.1:${port} (accepts TCP, ignores Firebird wire protocol)`);
        onReady(server);
    });
}

module.exports = { ts, log, poolState, startFakeServer };
