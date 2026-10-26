import * as esbuild from 'esbuild';
import { mkdir } from 'node:fs/promises';

const dev = process.argv.includes('--dev');
const ctx = await esbuild.context({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  outfile: 'public/app.js',
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
  legalComments: 'none',
  logLevel: 'info',
  assetNames: 'assets/[name]-[hash]',
  loader: { '.glsl': 'text' },
});
await mkdir('public', { recursive: true });
await ctx.rebuild();
if (dev) { await ctx.dispose(); } else { await ctx.dispose(); }
console.log('[build] public/app.js written');
