// oxlint-disable no-magic-numbers, typescript/no-unsafe-call
import { chmodSync } from 'fs';
chmodSync('dist/slopenv.js', 0o755);
chmodSync('dist/slopenv.mjs', 0o755);
