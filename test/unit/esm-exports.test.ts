import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'url';
import path from 'path';

/**
 * Node resolves named ESM imports from the compiled CJS entry through
 * cjs-module-lexer static analysis. That analyzability is what makes
 * `import { attach } from 'node-firebird'` work (package.json "exports"
 * routes both conditions to lib/index.js) — and it would silently break
 * if a compiler/module-layout change stopped emitting lexable exports.
 * This test pins it against the build output.
 */
describe('ESM named-export interop', () => {
    it('exposes the public surface to ESM named imports', async () => {
        const entry = pathToFileURL(path.resolve(__dirname, '../../lib/index.js')).href;
        const mod: any = await import(entry);

        // default export (the whole CJS namespace)
        expect(typeof mod.default.attach).toBe('function');

        // named exports across the export styles used in src/index.ts:
        // plain functions, consts, re-exports and overloaded declarations
        for (const name of [
            'attach', 'create', 'attachOrCreate', 'drop', 'pool',
            'attachAsync', 'createAsync', 'attachOrCreateAsync', 'dropAsync',
            'parseConnectionUri', 'parseConnectionString', 'parseNamedPlaceholders',
            'escape',
        ]) {
            expect(typeof mod[name], name).toBe('function');
        }
        expect(typeof mod.GDSCode).toBe('object');
        expect(typeof mod.SQL_TYPES).toBe('object');
        expect(Array.isArray(mod.ISOLATION_READ_COMMITTED)).toBe(true);
        expect(typeof mod.AUTH_PLUGIN_SRP).toBe('string');
    });
});
