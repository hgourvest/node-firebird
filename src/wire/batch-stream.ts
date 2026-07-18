/***************************************
 *
 *   batchStream — object-mode Writable over the Firebird 4 batch API
 *
 *   The COPY FROM analogue: write parameter rows, they are flushed in
 *   chunks through statement.executeBatch (single prepared statement,
 *   protocol-level batching, BLOB values included). Backpressure is the
 *   Writable machinery itself: a write callback is held while a chunk
 *   is in flight.
 *
 ***************************************/

import { Writable } from 'stream';
import { fromCallback } from '../callback';
import { batchResultToError } from '../utils';

/**
 * Build the Writable for Database.batchStream / Transaction.batchStream.
 * With `ownsTransaction` (the Database form) the stream runs its own
 * transaction: committed on finish, rolled back on error/destroy —
 * all-or-nothing for the whole stream. The Transaction form leaves
 * commit/rollback to the caller.
 *
 * Rows accumulate up to options.flushRows (default 1000) per
 * executeBatch flush; the remaining executeBatch options (chunkSize,
 * bufferSize, …) pass through. After 'finish', stream.recordCount and
 * stream.affectedRows carry the totals.
 */
function makeBatchStream(target: any, query: string, options: any, ownsTransaction: boolean): Writable {
    options = options || {};
    const flushRows = options.flushRows > 0 ? Math.floor(options.flushRows) : 1000;

    const batchOptions = { ...options };
    delete batchOptions.flushRows;
    delete batchOptions.highWaterMark;

    let transaction: any = null;
    let statement: any = null;
    let buffered: any[][] = [];

    const init = async () => {
        if (statement) {
            return;
        }
        transaction = ownsTransaction ? await target.transactionAsync() : target;
        statement = await fromCallback((cb) => transaction.newStatement(query, cb));
    };

    const flush = async () => {
        if (!buffered.length) {
            return;
        }
        await init();
        const chunk = buffered;
        buffered = [];
        const result: any = await fromCallback((cb) =>
            statement.executeBatch(transaction, chunk, cb, batchOptions));
        if (!result.success) {
            // the same all-or-nothing error shape database.executeBatch uses
            throw batchResultToError(result);
        }
        (stream as any).recordCount += result.recordCount;
        for (const count of result.updateCounts) {
            (stream as any).affectedRows += count;
        }
    };

    const cleanup = async (commit: boolean) => {
        if (statement) {
            const stmt = statement;
            statement = null;
            await new Promise<void>((resolve) => stmt.release(() => resolve()));
        }
        if (ownsTransaction && transaction) {
            const tx = transaction;
            transaction = null;
            await (commit ? tx.commitAsync() : tx.rollbackAsync());
        }
    };

    const stream = new Writable({
        objectMode: true,
        highWaterMark: options.highWaterMark > 0 ? options.highWaterMark : flushRows,

        write(row: any, _enc: any, cb: (err?: any) => void) {
            if (!Array.isArray(row)) {
                cb(new Error('batchStream expects parameter-array rows'));
                return;
            }
            buffered.push(row);
            if (buffered.length >= flushRows) {
                flush().then(() => cb(), cb);
            } else {
                cb();
            }
        },

        final(cb: (err?: any) => void) {
            // an empty stream finishes without touching the server at all
            // (flush() early-returns and init never runs)
            flush()
                .then(() => cleanup(true))
                .then(() => cb(), (err) => {
                    // the failed stream must not commit half a bulk load
                    cleanup(false).catch(() => { /* rollback best-effort */ });
                    cb(err);
                });
        },

        destroy(err: any, cb: (err?: any) => void) {
            cleanup(false)
                .then(() => cb(err), () => cb(err));
        },
    });

    (stream as any).recordCount = 0;
    (stream as any).affectedRows = 0;
    return stream;
}

export = makeBatchStream;
