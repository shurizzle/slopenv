#!/usr/bin/env node

// oxlint-disable import/no-nodejs-modules, no-magic-numbers, no-console
import { spawn } from 'node:child_process';

import { config } from './index';

config();

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error('❌ Error: No command provided.');
  console.log('Usage: slopenv <command> [args]');
  process.exit(1);
}

const child = spawn(command, args, {
  stdio: 'inherit',
  shell: false,
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
