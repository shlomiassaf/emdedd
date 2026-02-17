# Plan: Convert to npm package with npx, tests, and CI

## Key Decisions
- Package name: `emdedd` (matches repo)
- Convert Deno APIs → Node.js (`process.argv`, `process.exit`, `process.cwd()`)
- Remove `npm:` import prefixes
- Build with `tsc` to `dist/`, bin entry points to `dist/index.js` for npx
- Add `#!/usr/bin/env node` shebang

## Files to Create/Modify

### 1. `package.json`
- name: `emdedd`, bin: `embed-sync` → `dist/index.js`
- dependencies: `typescript`, `glob`
- devDependencies: `@types/node`
- scripts: build, test, prepublishOnly
- `"type": "module"` (ESM)
- `files: ["dist"]` to keep published package clean

### 2. `tsconfig.json`
- Target ES2022, module NodeNext, outDir dist
- Include src/

### 3. `src/index.ts` — Modify
- Remove Deno shebang, add `#!/usr/bin/env node`
- `npm:typescript@~5.5.0` → `typescript`
- `npm:glob@^11.0.0` → `glob`
- `Deno.args[0]` → `process.argv[2]`
- `Deno.exit(n)` → `process.exit(n)`
- `Deno.cwd()` → `process.cwd()`

### 4. `.gitignore`
- node_modules, dist

### 5. Tests — `test/` directory
- `test/fixtures/sample.ts` — a TS file with an interface + function
- `test/fixtures/input.md` — markdown with embed markers pointing at sample.ts
- `test/fixtures/expected.md` — expected output after embed-sync runs
- `test/run.ts` — simple test script:
  - Copies input.md to a temp file
  - Runs embed-sync on it
  - Compares output to expected.md
  - Exits 0/1

### 6. `.github/workflows/ci.yml`
- Trigger: push to main, PRs
- Jobs: build + test (Node 20)
- npm publish on tag push (uses `NPM_TOKEN` secret)

## Execution Order
1. Create package.json, tsconfig.json, .gitignore
2. Modify src/index.ts (Deno → Node)
3. `npm install`
4. `npm run build` to verify compilation
5. Create test fixtures + test script
6. Run tests to verify
7. Create GitHub Actions workflow
