'use strict';

/**
 * Minimal zero-dependency benchmark harness using process.hrtime.bigint().
 *
 * Supports both synchronous micro-benchmarks and async (Promise-returning)
 * integration benchmarks, reporting ops/sec, custom throughput (e.g. rows/s
 * or MB/s), mean, p50, p95, and min/max timings.
 */

const { performance } = require('perf_hooks');

/**
 * Format a number with thousand separators.
 * @param {number} n
 * @param {number} [decimals=0]
 */
function formatNumber(n, decimals = 0) {
    if (!Number.isFinite(n)) return String(n);
    const fixed = n.toFixed(decimals);
    const [intPart, fracPart] = fixed.split('.');
    const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fracPart !== undefined ? `${withCommas}.${fracPart}` : withCommas;
}

/**
 * Format duration in nanoseconds to human-readable string (ns, µs, ms, s).
 * @param {number} ns
 */
function formatDurationNs(ns) {
    if (ns < 1_000) return `${ns.toFixed(0)} ns`;
    if (ns < 1_000_000) return `${(ns / 1_000).toFixed(2)} µs`;
    if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(2)} ms`;
    return `${(ns / 1_000_000_000).toFixed(2)} s`;
}

/**
 * Run a synchronous benchmark function.
 *
 * @param {string} name
 * @param {() => void} fn
 * @param {object} [options]
 * @param {number} [options.warmupMs=100]
 * @param {number} [options.minTimeMs=400]
 * @param {number} [options.minSamples=30]
 * @param {number} [options.maxSamples=200]
 * @param {number} [options.itemsPerOp=1]  e.g. rows decoded per call
 * @param {string} [options.unit='ops/s']  e.g. 'rows/s', 'MB/s'
 */
function benchSync(name, fn, options = {}) {
    const warmupMs = options.warmupMs ?? 80;
    const minTimeMs = options.minTimeMs ?? 300;
    const minSamples = options.minSamples ?? 25;
    const maxSamples = options.maxSamples ?? 150;
    const itemsPerOp = options.itemsPerOp ?? 1;
    const unit = options.unit ?? 'ops/s';

    // 1. Calibrate batch size so each sample takes at least ~2ms
    let batchSize = 1;
    const warmupDeadline = performance.now() + warmupMs;
    while (performance.now() < warmupDeadline) {
        const t0 = process.hrtime.bigint();
        for (let i = 0; i < batchSize; i++) {
            fn();
        }
        const elapsedNs = Number(process.hrtime.bigint() - t0);
        if (elapsedNs < 500_000 && batchSize < 100_000) {
            batchSize *= 2;
        }
    }

    // 2. Collect samples
    const samplesNs = [];
    let totalOps = 0;
    const startMs = performance.now();

    while (
        samplesNs.length < minSamples ||
        (performance.now() - startMs < minTimeMs && samplesNs.length < maxSamples)
    ) {
        const t0 = process.hrtime.bigint();
        for (let i = 0; i < batchSize; i++) {
            fn();
        }
        const dt = Number(process.hrtime.bigint() - t0);
        samplesNs.push(dt / batchSize);
        totalOps += batchSize;
    }

    return summarize(name, samplesNs, totalOps, itemsPerOp, unit);
}

/**
 * Run an asynchronous benchmark function.
 *
 * @param {string} name
 * @param {() => Promise<void>} fn
 * @param {object} [options]
 * @param {number} [options.warmupIterations=3]
 * @param {number} [options.iterations=25]
 * @param {number} [options.itemsPerOp=1]
 * @param {string} [options.unit='ops/s']
 */
async function benchAsync(name, fn, options = {}) {
    const warmupIterations = options.warmupIterations ?? 3;
    const iterations = options.iterations ?? 25;
    const itemsPerOp = options.itemsPerOp ?? 1;
    const unit = options.unit ?? 'ops/s';

    for (let i = 0; i < warmupIterations; i++) {
        await fn();
    }

    const samplesNs = [];
    for (let i = 0; i < iterations; i++) {
        const t0 = process.hrtime.bigint();
        await fn();
        const dt = Number(process.hrtime.bigint() - t0);
        samplesNs.push(dt);
    }

    return summarize(name, samplesNs, iterations, itemsPerOp, unit);
}

function summarize(name, samplesNs, totalOps, itemsPerOp, unit) {
    const sorted = samplesNs.slice().sort((a, b) => a - b);
    const sumNs = sorted.reduce((acc, v) => acc + v, 0);
    const meanNs = sumNs / sorted.length;
    const p50Ns = sorted[Math.floor(sorted.length * 0.5)];
    const p95Ns = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const minNs = sorted[0];
    const maxNs = sorted[sorted.length - 1];

    const opsPerSec = 1_000_000_000 / meanNs;
    const throughput = opsPerSec * itemsPerOp;

    return {
        name,
        opsPerSec,
        throughput,
        unit,
        itemsPerOp,
        meanNs,
        p50Ns,
        p95Ns,
        minNs,
        maxNs,
        samples: sorted.length,
        totalOps,
    };
}

/**
 * Print a formatted ASCII table of benchmark results.
 * @param {string} suiteTitle
 * @param {Array<ReturnType<typeof summarize>>} results
 */
function printTable(suiteTitle, results) {
    console.log(`\n=== ${suiteTitle} ===`);
    const nameWidth = Math.max(38, ...results.map((r) => r.name.length));
    const header =
        'Benchmark'.padEnd(nameWidth) +
        ' │ ' +
        'Throughput'.padStart(20) +
        ' │ ' +
        'Mean / op'.padStart(11) +
        ' │ ' +
        'p50'.padStart(11) +
        ' │ ' +
        'p95'.padStart(11);
    const rule = '─'.repeat(header.length);
    console.log(rule);
    console.log(header);
    console.log(rule);

    for (const r of results) {
        const decimals = r.throughput >= 100 ? 0 : 2;
        const tputStr = `${formatNumber(r.throughput, decimals)} ${r.unit}`;
        console.log(
            r.name.padEnd(nameWidth) +
                ' │ ' +
                tputStr.padStart(20) +
                ' │ ' +
                formatDurationNs(r.meanNs).padStart(11) +
                ' │ ' +
                formatDurationNs(r.p50Ns).padStart(11) +
                ' │ ' +
                formatDurationNs(r.p95Ns).padStart(11)
        );
    }
    console.log(rule);
}

module.exports = {
    benchSync,
    benchAsync,
    printTable,
    formatNumber,
    formatDurationNs,
};
