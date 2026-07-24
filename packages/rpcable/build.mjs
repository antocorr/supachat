import { build } from 'bun';
import { execSync } from 'child_process';

async function buildFormat(format, naming, globalName, target, minify) {
    const result = await build({
        entrypoints: ['./src/index.ts'],
        outdir: './dist',
        target,
        format,
        globalName,
        minify,
        sourcemap: 'external',
        naming,
    });
    if (!result.success) {
        for (const log of result.logs) console.error(log);
        process.exit(1);
    }
    return result.outputs.map(o => o.path);
}

// ESM: modern, minified, no transpile needed
const esm = await buildFormat('esm', 'rpcable.min.js', undefined, 'browser', true);

// CJS: transpile source directly with esbuild for webpack 4 compat
const cjsPath = './dist/rpcable.cjs.js';
try {
    execSync(
        `npx --yes esbuild --bundle --format=cjs --target=es2017 --outfile=${cjsPath} --legal-comments=none ./src/index.ts`,
        { stdio: 'inherit' }
    );
} catch (e) {
    console.error('esbuild transpile failed');
    process.exit(1);
}
const cjs = [cjsPath];

console.log('Build complete:', [...esm, ...cjs].join(', '));