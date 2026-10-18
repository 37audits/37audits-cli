import { build } from 'esbuild';

await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  minify: true,
  outfile: 'dist/cli.cjs',
});
