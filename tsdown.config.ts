import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/slopenv.ts'],
  format: ['cjs', 'esm'],
  clean: true,
  dts: true,
  sourcemap: true,
  outExtensions: ({ format }) => ({ js: format === 'cjs' ? '.js' : '.mjs' }),
});
