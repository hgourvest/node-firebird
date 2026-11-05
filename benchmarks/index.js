#!/usr/bin/env node
'use strict';

const os = require('node:os');
const { runMicroBenchmarks } = require('./micro');
const { runLiveBenchmarks } = require('./live');

async function main() {
    const args = new Set(process.argv.slice(2));
    const json = args.has('--json');
    const wantLive = args.has('--live') || args.has('--all') || process.env.FIREBIRD_BENCH_LIVE === '1';
    const wantMicro = !args.has('--live') || args.has('--micro') || args.has('--all');

    if (!json) {
        const cpus = os.cpus();
        const cpuModel = cpus && cpus[0] ? cpus[0].model.trim() : 'Unknown CPU';
        console.log('========================================================================');
        console.log('  node-firebird Benchmark Suite');
        console.log(`  Node.js ${process.version} (${process.platform}/${process.arch}) | ${cpuModel}`);
        console.log('========================================================================');
    }

    const allSuites = [];

    if (wantMicro) {
        const microSuites = await runMicroBenchmarks({ json });
        allSuites.push(...microSuites);
    }

    if (wantLive) {
        const liveSuites = await runLiveBenchmarks({ json });
        allSuites.push(...liveSuites);
    } else if (!json) {
        console.log('\nTip: Run `npm run bench:live` (or `node benchmarks/index.js --all`) to also run live Firebird server benchmarks.\n');
    }

    if (json) {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            suites: allSuites
        }, null, 2));
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
