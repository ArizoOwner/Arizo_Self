/**
 * 🧪 Arizo Automated Test Runner
 * Comprehensive, deterministic async test harness with zero external dependencies
 */

import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const suites = [];
let currentSuite = null;
let passed = 0;
let failed = 0;
const failures = [];

export function describe(suiteName, fn) {
  const suite = { name: suiteName, tests: [] };
  suites.push(suite);
  const prevSuite = currentSuite;
  currentSuite = suite;
  try {
    fn();
  } catch (err) {
    suite.tests.push({
      name: 'Suite Initialization',
      fn: () => { throw err; }
    });
  } finally {
    currentSuite = prevSuite;
  }
}

export function it(testName, fn) {
  if (currentSuite) {
    currentSuite.tests.push({ name: testName, fn });
  } else {
    suites.push({ name: 'Global', tests: [{ name: testName, fn }] });
  }
}

export function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
  }
}

export function assertDeepEqual(actual, expected, message) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(message || `Deep equality mismatch:\nExpected: ${expectedStr}\nActual:   ${actualStr}`);
  }
}

export async function runAllTests() {
  const files = readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
  console.log(`\x1b[1m\x1b[35m⚡ Arizo Test Suite — Running ${files.length} test suites...\x1b[0m`);
  const startTime = Date.now();

  for (const file of files) {
    const fileUrl = pathToFileURL(join(__dirname, file)).href;
    await import(fileUrl);
  }

  // Execute all collected suites & tests sequentially
  for (const suite of suites) {
    console.log(`\n\x1b[1m\x1b[36m▶ Suite: ${suite.name}\x1b[0m`);
    for (const test of suite.tests) {
      try {
        await test.fn();
        console.log(`\x1b[32m  ✔ ${test.name}\x1b[0m`);
        passed++;
      } catch (err) {
        console.error(`\x1b[31m  ✖ ${test.name}\x1b[0m`);
        console.error(`    \x1b[90m${err.stack || err.message}\x1b[0m`);
        failed++;
        failures.push({ suite: suite.name, test: test.name, error: err });
      }
    }
  }

  const duration = Date.now() - startTime;
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\x1b[1m📊 Test Summary:\x1b[0m`);
  console.log(`  \x1b[32m✔ Passed: ${passed}\x1b[0m`);
  if (failed > 0) {
    console.log(`  \x1b[31m✖ Failed: ${failed}\x1b[0m`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    process.exit(1);
  } else {
    console.log(`  \x1b[36m⏱ Duration: ${duration}ms\x1b[0m`);
    console.log(`  \x1b[1m\x1b[32m🎉 ALL TESTS PASSED (100% Green)!\x1b[0m`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    process.exit(0);
  }
}

// Auto-run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAllTests().catch(err => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
  });
}
