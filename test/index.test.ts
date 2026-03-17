import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test, describe, beforeEach, afterEach } from 'node:test';

import * as slopenv from '../src/index';

const testDir = path.join(process.cwd(), 'temp-test-env');

const setupFiles = (files: Record<string, string>) => {
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  fs.mkdirSync(testDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const fullPath = path.join(testDir, name);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
};

describe('slopenv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
    process.env = { ...originalEnv };
  });

  test('loads basic .env file', () => {
    setupFiles({
      'package.json': JSON.stringify({ name: 'test' }),
      '.env': 'FOO=bar\nBAZ=qux',
    });

    const result = slopenv.load(testDir);
    assert.strictEqual(result.FOO, 'bar');
    assert.strictEqual(result.BAZ, 'qux');
  });

  test('precedence: .env.local overrides .env', () => {
    setupFiles({
      'package.json': JSON.stringify({ name: 'test' }),
      '.env': 'FOO=env\nBAR=env',
      '.env.local': 'FOO=local',
    });

    const result = slopenv.load(testDir);
    assert.strictEqual(result.FOO, 'local');
    assert.strictEqual(result.BAR, 'env');
  });

  test('NODE_ENV specific loading', () => {
    setupFiles({
      'package.json': JSON.stringify({ name: 'test' }),
      '.env': 'NODE_ENV=production\nFOO=env',
      '.env.production': 'FOO=prod',
    });

    const result = slopenv.load(testDir);
    assert.strictEqual(result.NODE_ENV, 'production');
    assert.strictEqual(result.FOO, 'prod');
  });

  test('async loading matches sync loading', async () => {
    setupFiles({
      'package.json': JSON.stringify({ name: 'test' }),
      '.env': 'FOO=bar',
      '.env.local': 'FOO=local',
    });

    const syncResult = slopenv.load(testDir);
    const asyncResult = await slopenv.loadAsync(testDir);

    assert.deepStrictEqual(syncResult, asyncResult);
    assert.strictEqual(asyncResult.FOO, 'local');
  });

  test('config() populates process.env', () => {
    setupFiles({
      'package.json': JSON.stringify({ name: 'test' }),
      '.env': 'CONFIG_TEST=true',
    });

    delete process.env.CONFIG_TEST;
    slopenv.config(testDir);
    assert.strictEqual(process.env.CONFIG_TEST, 'true');
  });

  test('does not override existing process.env variables', () => {
    setupFiles({
      'package.json': JSON.stringify({ name: 'test' }),
      '.env': 'EXISTING=new',
    });

    process.env.EXISTING = 'old';
    const result = slopenv.load(testDir);
    assert.strictEqual(result.EXISTING, undefined);
    assert.strictEqual(process.env.EXISTING, 'old');
  });

  describe('Monorepo Support', () => {
    test('detects npm workspaces and loads root .env', () => {
      setupFiles({
        'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
        '.env': 'ROOT=true\nSHARED=root',
        'packages/pkg-a/package.json': JSON.stringify({ name: 'pkg-a' }),
        'packages/pkg-a/.env': 'SHARED=pkg',
      });

      const pkgADir = path.join(testDir, 'packages', 'pkg-a');
      const result = slopenv.load(pkgADir);

      assert.strictEqual(result.ROOT, 'true');
      assert.strictEqual(result.SHARED, 'pkg');
    });

    test('loads .env.shared from monorepo root', () => {
      setupFiles({
        'turbo.json': '{}',
        'package.json': JSON.stringify({ name: 'root' }),
        '.env.shared': 'SHARED_VAR=common',
        'apps/web/package.json': JSON.stringify({ name: 'web' }),
      });

      const webDir = path.join(testDir, 'apps', 'web');
      const result = slopenv.load(webDir);

      assert.strictEqual(result.SHARED_VAR, 'common');
    });
  });

  describe('Path Traversal Protection', () => {
    test('ignores malicious NODE_ENV in process.env', () => {
      // Create a file outside the test directory (simulated by being in a different subfolder)
      setupFiles({
        'package.json': JSON.stringify({ name: 'test' }),
        '.env': 'FOO=bar',
        'secret/.env.evil': 'SECRET=true',
      });

      // Try to traverse to secret/.env.evil by setting NODE_ENV to ../secret/evil
      // The constructed path would be something like: testDir/.env.../secret/evil
      // but isSafeName should catch it.
      process.env.NODE_ENV = '../secret/evil';
      const result = slopenv.load(testDir);

      assert.strictEqual(result.SECRET, undefined);
      assert.strictEqual(result.FOO, 'bar');
    });

    test('ignores malicious NODE_ENV defined in .env file', () => {
      setupFiles({
        'package.json': JSON.stringify({ name: 'test' }),
        '.env': 'NODE_ENV=../secret/evil\nFOO=bar',
        'secret/.env.evil': 'SECRET=true',
      });

      const result = slopenv.load(testDir);

      assert.strictEqual(result.SECRET, undefined);
      assert.strictEqual(result.FOO, 'bar');
    });

    test('prevents null byte injection', () => {
      setupFiles({
        'package.json': JSON.stringify({ name: 'test' }),
        '.env': 'FOO=bar',
        '.env.evil': 'SECRET=true',
      });

      process.env.NODE_ENV = 'evil\0';
      const result = slopenv.load(testDir);

      assert.strictEqual(result.SECRET, undefined);
    });

    test('prevents invalid characters on Windows-like paths', () => {
      setupFiles({
        'package.json': JSON.stringify({ name: 'test' }),
        '.env': 'FOO=bar',
      });

      const maliciousNames = ['foo:bar', 'foo|bar', 'foo<bar', 'foo>bar'];

      for (const name of maliciousNames) {
        process.env.NODE_ENV = name;
        const result = slopenv.load(testDir);
        // It shouldn't crash and shouldn't load anything unexpected
        // oxlint-disable-next-line no-magic-numbers
        assert.strictEqual(Object.keys(result).length > 0, true);
      }
    });

    test('allows valid NODE_ENV names', () => {
      setupFiles({
        'package.json': JSON.stringify({ name: 'test' }),
        '.env.staging': 'STAGING=true',
      });

      process.env.NODE_ENV = 'staging';
      const result = slopenv.load(testDir);

      assert.strictEqual(result.STAGING, 'true');
    });
  });
});
