# Developer Guide

## Setup

```bash
git clone git@github.com:shlomiassaf/emdedd.git
cd emdedd
npm install
npm run build
```

## Development

```bash
npm run build        # Compile TypeScript → dist/
npm test             # Run tests (requires build)
npm run build && npm test  # Full verify
```

All source lives in `src/index.ts`. Tests are in `test/run.ts` with fixtures in `test/fixtures/`.

Tests execute the compiled `dist/src/index.js` binary against fixture markdown files in temp directories. Always rebuild before running tests.

## Project Structure

```
src/index.ts              CLI entry point + all logic
test/run.ts               Integration tests (no framework)
test/fixtures/
  sample.ts               Source file with TS symbols
  input.md                Markdown with embed markers (before)
  expected.md             Expected output (after)
.github/workflows/ci.yml  Build, test, publish pipeline
```

## Release Flow

1. Ensure tests pass:
   ```bash
   npm run build && npm test
   ```

2. Bump version in `package.json`:
   ```bash
   npm version patch   # 0.1.0 → 0.1.1
   npm version minor   # 0.1.0 → 0.2.0
   npm version major   # 0.1.0 → 1.0.0
   ```
   This creates a git commit and tag automatically.

3. Push the commit and tag:
   ```bash
   git push && git push --tags
   ```

4. GitHub Actions will automatically build, test, and publish to npm on the `v*` tag.

### Prerequisites

- Either Trusted Publisher role for GitHub Actions or `NPM_TOKEN` secret must be configured in the GitHub repo settings (Settings → Secrets → Actions).
- The token needs publish permissions for the `emdedd` package on npmjs.com.

## CI Pipeline

Defined in `.github/workflows/ci.yml`:

| Trigger | Action |
|---------|--------|
| Push to `main` | Build + test (Node 20, 22) |
| Pull request | Build + test (Node 20, 22) |
| Tag `v*` | Build + test + npm publish |

## npx Usage

After publishing, users can run directly without installing:

```bash
npx emdedd "docs/**/*.md,specs/*.md"
```

The `bin.embed-sync` entry in `package.json` maps to `dist/src/index.js`.
