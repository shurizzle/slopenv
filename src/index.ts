import dotenv from 'dotenv';
import fs from 'node:fs';
import afs from 'node:fs/promises';
import path from 'node:path';

export type { DotenvParseOutput } from 'dotenv';

const isSafeName = (name: string): boolean =>
  // oxlint-disable-next-line no-control-regex
  !/[<>:"/\\|?*\u0000-\u001F\u007F]/.test(name);

/**
 * File system operations that can be handled by the runner.
 * @internal
 */
type FileOp =
  | { type: 'exists'; path: string }
  | { type: 'readFile'; path: string };

/**
 * Executes a generator synchronously.
 * @internal
 */
const run = <T>(gen: Generator<FileOp, T, unknown>): T => {
  let next = gen.next();
  while (!next.done) {
    const op = next.value;
    try {
      const res =
        op.type === 'exists'
          ? fs.existsSync(op.path)
          : fs.readFileSync(op.path, 'utf8');
      next = gen.next(res);
    } catch (error) {
      next = gen.throw(error);
    }
  }
  return next.value;
};

/**
 * Executes a generator asynchronously.
 * @internal
 */
const runAsync = async <T>(gen: Generator<FileOp, T, unknown>): Promise<T> => {
  let next = gen.next();
  while (!next.done) {
    const op = next.value;
    try {
      let res: boolean | string = false;
      if (op.type === 'exists') {
        try {
          // oxlint-disable-next-line no-await-in-loop
          await afs.access(op.path, afs.constants.F_OK);
          res = true;
        } catch {
          res = false;
        }
      } else {
        // oxlint-disable-next-line no-await-in-loop
        res = await afs.readFile(op.path, 'utf8');
      }
      next = gen.next(res);
    } catch (error) {
      next = gen.throw(error);
    }
  }
  return next.value;
};

/**
 * Logic for finding the nearest package root.
 * @internal
 */
const findPackageRootFlow = function* findPackageRootFlow(
  startDir: string,
): Generator<FileOp, string | null, unknown> {
  let currentDir = startDir;

  while (true) {
    const pkgPath = path.join(currentDir, 'package.json');
    if ((yield { type: 'exists', path: pkgPath }) as boolean) {
      return currentDir;
    }
    const parent = path.dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }

  return null;
};

/**
 * Information about a detected monorepo root.
 */
interface Monorepo {
  /** The type of monorepo manager detected. */
  type: 'npm' | 'pnpm' | 'yarn' | 'turbo' | 'nx' | 'lerna';
  /** The absolute path to the monorepo root directory. */
  rootDir: string;
}

/**
 * Logic for detecting if a directory is part of a monorepo.
 * @internal
 */
const detectMonorepoFlow = function* detectMonorepoFlow(
  startDir: string,
): Generator<FileOp, Monorepo | null, unknown> {
  let currentDir = startDir;

  while (true) {
    const markers = [
      { file: 'pnpm-workspace.yaml', type: 'pnpm' },
      { file: 'lerna.json', type: 'lerna' },
      { file: 'nx.json', type: 'nx' },
      { file: 'turbo.json', type: 'turbo' },
    ] as const;

    for (const marker of markers) {
      if (
        (yield {
          type: 'exists',
          path: path.join(currentDir, marker.file),
        }) as boolean
      ) {
        return { type: marker.type, rootDir: currentDir };
      }
    }

    const pkgPath = path.join(currentDir, 'package.json');
    if ((yield { type: 'exists', path: pkgPath }) as boolean) {
      try {
        const content = (yield { type: 'readFile', path: pkgPath }) as string;
        // oxlint-disable-next-line typescript/no-unsafe-assignment
        const pkg = JSON.parse(content);
        // oxlint-disable-next-line typescript/no-unsafe-member-access
        if (pkg.workspaces) {
          return { type: 'npm', rootDir: currentDir };
        }
      } catch {}
    }

    const parent = path.dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }

  return null;
};

/**
 * Logic for loading and parsing a .env file.
 * @internal
 */
const loadDotEnvFlow = function* loadDotEnvFlow(
  path: string,
): Generator<FileOp, dotenv.DotenvParseOutput, unknown> {
  try {
    const content = (yield { type: 'readFile', path }) as string;
    const envs = dotenv.parse(content);
    for (const [key] of Object.entries(envs)) {
      if (key in process.env) {
        delete envs[key];
      }
    }
    return envs;
  } catch {
    return {};
  }
};

/**
 * Merges new environment variables into an existing object if they don't already exist.
 * @internal
 */
const mergeDotEnv = (
  vars: dotenv.DotenvParseOutput,
  all?: dotenv.DotenvParseOutput,
): dotenv.DotenvParseOutput => {
  const res = all ?? {};
  for (const [key, value] of Object.entries(vars)) {
    if (!(key in res)) {
      res[key] = value;
    }
  }
  return res;
};

/**
 * Internal cache for parsed .env files to avoid redundant I/O during NODE_ENV detection.
 * @internal
 */
interface Cache {
  repoLocal?: dotenv.DotenvParseOutput;
  repoEnv?: dotenv.DotenvParseOutput;
  monoLocal?: dotenv.DotenvParseOutput;
  monoShared?: dotenv.DotenvParseOutput;
  monoEnv?: dotenv.DotenvParseOutput;
}

/**
 * Defines the order and location of .env files to be loaded.
 * @internal
 */
const TRIES: {
  file: (name: string | null, dir: string) => string | null;
  monoRepo: boolean;
  cacheKey?: keyof Cache;
}[] = [
  {
    file: (_name: string | null, dir: string) => path.join(dir, '.env.local'),
    monoRepo: false,
    cacheKey: 'repoLocal',
  },
  {
    file: (name: string | null, dir: string) =>
      name && isSafeName(name) ? path.join(dir, `.env.${name}.local`) : null,
    monoRepo: false,
  },
  {
    file: (name: string | null, dir: string) =>
      name && isSafeName(name) ? path.join(dir, `.env.${name}`) : null,
    monoRepo: false,
  },
  {
    file: (_name: string | null, dir: string) => path.join(dir, '.env'),
    monoRepo: false,
    cacheKey: 'repoEnv',
  },
  {
    file: (_name: string | null, dir: string) => path.join(dir, '.env.local'),
    monoRepo: true,
    cacheKey: 'monoLocal',
  },
  {
    file: (name: string | null, dir: string) =>
      name && isSafeName(name) ? path.join(dir, `.env.${name}.local`) : null,
    monoRepo: true,
  },
  {
    file: (name: string | null, dir: string) =>
      name && name !== 'shared' && isSafeName(name)
        ? path.join(dir, `.env.${name}`)
        : null,
    monoRepo: true,
  },
  {
    file: (_name: string | null, dir: string) => path.join(dir, '.env.shared'),
    monoRepo: true,
    cacheKey: 'monoShared',
  },
  {
    file: (_name: string | null, dir: string) => path.join(dir, '.env'),
    monoRepo: true,
    cacheKey: 'monoEnv',
  },
];

/**
 * Internal implementation of environment variable loading logic.
 * @internal
 */
const _loadFlow = function* _loadFlow(
  name: string | null,
  pkgRoot: string,
  mono_?: Monorepo | null,
  cache_?: Cache,
): Generator<FileOp, dotenv.DotenvParseOutput, unknown> {
  const cache: Cache = cache_ ?? {};
  const mono = mono_ === undefined ? yield* detectMonorepoFlow(pkgRoot) : mono_;
  const isMono = pkgRoot === mono?.rootDir;

  const env: dotenv.DotenvParseOutput = {};
  for (const try_ of TRIES) {
    if (try_.monoRepo) {
      if (!mono) {
        continue;
      }
      if (try_.cacheKey) {
        const v = cache[try_.cacheKey];
        if (v) {
          mergeDotEnv(v, env);
          continue;
        }
      }
      const p = try_.file(name, mono.rootDir);
      if (p) {
        mergeDotEnv(yield* loadDotEnvFlow(p), env);
      }
    } else {
      if (isMono) {
        continue;
      }
      if (try_.cacheKey) {
        const v = cache[try_.cacheKey];
        if (v) {
          mergeDotEnv(v, env);
          continue;
        }
      }
      const p = try_.file(name, pkgRoot);
      if (p) {
        mergeDotEnv(yield* loadDotEnvFlow(p), env);
      }
    }
  }

  return env;
};

/**
 * Loads environment variables from hierarchical .env files without modifying process.env.
 * @internal
 */
const loadFlow = function* loadFlow(
  root: string = process.cwd(),
): Generator<FileOp, dotenv.DotenvParseOutput, unknown> {
  const pkgRootResult = yield* findPackageRootFlow(root);
  const pkgRoot = pkgRootResult ?? root;
  let mono = null;
  let isMono = false;

  if (pkgRootResult) {
    mono = yield* detectMonorepoFlow(pkgRoot);
    isMono = pkgRoot === (mono ? mono.rootDir : null);
  }

  if (process.env.NODE_ENV) {
    return yield* _loadFlow(process.env.NODE_ENV, pkgRoot, mono);
  }

  const cache: Cache = {};

  for (const try_ of TRIES) {
    if (!try_.cacheKey) {
      continue;
    }

    if (try_.monoRepo) {
      if (!mono) {
        continue;
      }
      const p = try_.file(null, mono.rootDir);
      if (p) {
        cache[try_.cacheKey] = yield* loadDotEnvFlow(p);
        const name = cache[try_.cacheKey]?.NODE_ENV;
        if (name) {
          return yield* _loadFlow(name, pkgRoot, mono, cache);
        }
      }
    } else {
      if (isMono) {
        continue;
      }
      const p = try_.file(null, pkgRoot);
      if (p) {
        cache[try_.cacheKey] = yield* loadDotEnvFlow(p);
        const name = cache[try_.cacheKey]?.NODE_ENV;
        if (name) {
          return yield* _loadFlow(name, pkgRoot, mono, cache);
        }
      }
    }
  }
  return yield* _loadFlow(null, pkgRoot, mono, cache);
};

/**
 * Loads environment variables from hierarchical .env files without modifying process.env.
 *
 * It looks for .env files at the package level and monorepo root level,
 * following a deterministic precedence logic.
 *
 * @param root - The starting directory for the search (defaults to process.cwd())
 * @returns An object containing the parsed environment variables
 */
export const load = (root: string = process.cwd()): dotenv.DotenvParseOutput =>
  run(loadFlow(root));

/**
 * Loads environment variables from hierarchical .env files without modifying process.env.
 * Performs all I/O operations asynchronously.
 *
 * @param root - The starting directory for the search (defaults to process.cwd())
 * @returns A promise that resolves to an object containing the parsed environment variables
 */
export const loadAsync = (
  root: string = process.cwd(),
): Promise<dotenv.DotenvParseOutput> => runAsync(loadFlow(root));

/**
 * Loads environment variables from hierarchical .env files and populates process.env.
 *
 * It will not override variables that are already defined in process.env.
 *
 * @param root - The starting directory for the search (defaults to process.cwd())
 * @returns An object containing the parsed environment variables
 */
export const config = (
  root: string = process.cwd(),
): dotenv.DotenvParseOutput => {
  const env = load(root);
  for (const [k, v] of Object.entries(env)) {
    process.env[k] = v;
  }
  return env;
};

/**
 * Loads environment variables from hierarchical .env files and populates process.env.
 * Performs all I/O operations asynchronously.
 *
 * It will not override variables that are already defined in process.env.
 *
 * @param root - The starting directory for the search (defaults to process.cwd())
 * @returns A promise that resolves to an object containing the parsed environment variables
 */
export const configAsync = async (
  root: string = process.cwd(),
): Promise<dotenv.DotenvParseOutput> => {
  const env = await loadAsync(root);
  for (const [k, v] of Object.entries(env)) {
    process.env[k] = v;
  }
  return env;
};
