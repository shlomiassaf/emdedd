import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Resolve project root from compiled location (dist/test/run.js → project root)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const fixturesDir = path.join(projectRoot, "test", "fixtures");
const binPath = path.join(projectRoot, "dist", "src", "index.js");

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ ${message}`);
    failed++;
  }
}

// ─── Test 1: Basic embed sync ────────────────────────────────────────────────

console.log("\nTest 1: Basic embed sync");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "emdedd-test-"));
try {
  // Copy fixtures to temp dir
  fs.copyFileSync(
    path.join(fixturesDir, "sample.ts"),
    path.join(tmpDir, "sample.ts")
  );
  fs.copyFileSync(
    path.join(fixturesDir, "input.md"),
    path.join(tmpDir, "test.md")
  );

  // Run embed-sync
  execFileSync("node", [binPath, path.join(tmpDir, "*.md")], {
    stdio: "pipe",
  });

  const actual = fs.readFileSync(path.join(tmpDir, "test.md"), "utf-8");
  const expected = fs.readFileSync(
    path.join(fixturesDir, "expected.md"),
    "utf-8"
  );

  if (actual !== expected) {
    // Show first 5 differing lines for debugging
    const actualLines = actual.split("\n");
    const expectedLines = expected.split("\n");
    let shown = 0;
    for (let i = 0; i < Math.max(actualLines.length, expectedLines.length) && shown < 5; i++) {
      if (actualLines[i] !== expectedLines[i]) {
        console.error(`  Line ${i + 1} differs:`);
        console.error(`    actual  : ${JSON.stringify(actualLines[i])}`);
        console.error(`    expected: ${JSON.stringify(expectedLines[i])}`);
        shown++;
      }
    }
  }
  assert(actual === expected, "Output matches expected markdown");

  // Run again — should be idempotent
  execFileSync("node", [binPath, path.join(tmpDir, "*.md")], {
    stdio: "pipe",
  });
  const secondRun = fs.readFileSync(path.join(tmpDir, "test.md"), "utf-8");
  assert(secondRun === expected, "Idempotent: second run produces same output");
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ─── Test 2: Missing symbol exits with error ─────────────────────────────────

console.log("\nTest 2: Missing symbol reports error");

const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "emdedd-test-"));
try {
  fs.copyFileSync(
    path.join(fixturesDir, "sample.ts"),
    path.join(tmpDir2, "sample.ts")
  );
  fs.writeFileSync(
    path.join(tmpDir2, "bad.md"),
    "<!-- ts-embed: ./sample.ts#NonExistent -->\n",
    "utf-8"
  );

  let exitCode = 0;
  try {
    execFileSync("node", [binPath, path.join(tmpDir2, "*.md")], {
      stdio: "pipe",
    });
  } catch (err: any) {
    exitCode = err.status;
  }

  assert(exitCode === 1, "Exits with code 1 on missing symbol");
} finally {
  fs.rmSync(tmpDir2, { recursive: true, force: true });
}

// ─── Test 3: No patterns prints usage ────────────────────────────────────────

console.log("\nTest 3: No arguments prints usage");

let exitCode3 = 0;
let stderr3 = "";
try {
  execFileSync("node", [binPath], { stdio: "pipe" });
} catch (err: any) {
  exitCode3 = err.status;
  stderr3 = err.stderr?.toString() || "";
}

assert(exitCode3 === 1, "Exits with code 1 when no arguments");
assert(stderr3.includes("Usage"), "Prints usage message");

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n─────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
