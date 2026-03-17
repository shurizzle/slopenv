# slopenv

An enhanced `dotenv` wrapper that simplifies environment management in complex directory structures. Features hierarchical file lookup and deterministic override logic, specifically designed for monorepos.

## Features

- 🏢 **Monorepo Aware**: Automatically detects monorepo roots (pnpm, Yarn, NPM, Turbo, Nx, Lerna).
- 🌲 **Hierarchical Loading**: Loads `.env` files from both the package level and the monorepo root.
- 🎯 **Deterministic Precedence**: Clear override logic where local files take precedence over shared ones.
- 🔄 **Automatic NODE_ENV Detection**: Can infer the environment mode from the `.env` files themselves.
- ⚡ **Async Support**: Provides both synchronous and asynchronous APIs for flexibility.
- 🛡️ **Non-Destructive**: Never overrides variables already present in `process.env`.
- 📦 **Zero Config**: Works out of the box with sensible defaults.

## Installation

```bash
npm install slopenv
# or
pnpm add slopenv
# or
yarn add slopenv
```

## Usage

### Simple Usage

The easiest way to use `slopenv` is to call it at the very beginning of your application:

```typescript
import { config } from 'slopenv';

// Populates process.env based on hierarchical lookup
config();

console.log(process.env.MY_VAR);
```

### Asynchronous Usage

For environments where non-blocking I/O is preferred during startup:

```typescript
import { configAsync } from 'slopenv';

async function bootstrap() {
  await configAsync();
  console.log(process.env.MY_VAR);
}

bootstrap();
```

### Advanced Usage

If you prefer to get the parsed variables without automatically populating `process.env`:

```typescript
import { load, loadAsync } from 'slopenv';

// Synchronous
const env = load();
console.log(env.MY_VAR);

// Asynchronous
const envAsync = await loadAsync();
```

You can also specify a custom root directory as the starting point for the search:

```typescript
config('/path/to/project');
// or
await configAsync('/path/to/project');
```

### TypeScript Support

`slopenv` is written in TypeScript and provides built-in types. You can import the `DotenvParseOutput` type if needed:

```typescript
import { load, DotenvParseOutput } from 'slopenv';

const env: DotenvParseOutput = load();
```

## Loading Logic & Precedence

`slopenv` looks for `.env` files in the following order (higher items have higher precedence):

1. **`process.env`** (Existing variables are never overridden)
2. **Package Level** (nearest `package.json`):
   - `.env.local`
   - `.env.[mode].local`
   - `.env.[mode]`
   - `.env`
3. **Monorepo Root Level**:
   - `.env.local`
   - `.env.[mode].local`
   - `.env.[mode]`
   - `.env.shared`
   - `.env`

### Mode Detection

The `[mode]` is determined by:

1. `process.env.NODE_ENV` if it's already set.
2. If not set, `slopenv` scans the `.env` files (starting from the package level) for a `NODE_ENV` definition and uses the first one it finds to trigger the loading of mode-specific files.

## License

MIT © [shurizzle](https://github.com/shurizzle)
