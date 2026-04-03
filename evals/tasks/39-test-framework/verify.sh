#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/workspace"

node -e "
const fw = require('./test-framework.js');
const { describe, it, expect, run } = fw;

// Register tests
describe('Math', () => {
  it('adds numbers', () => {
    expect(1 + 1).toBe(2);
  });

  it('subtracts numbers', () => {
    expect(5 - 3).toBe(2);
  });

  it('fails intentionally', () => {
    expect(1).toBe(2);
  });
});

describe('Objects', () => {
  it('compares objects', () => {
    expect({ a: 1, b: 2 }).toEqual({ a: 1, b: 2 });
  });

  it('compares arrays', () => {
    expect([1, 2, 3]).toEqual([1, 2, 3]);
  });
});

describe('Errors', () => {
  it('detects throws', () => {
    expect(() => { throw new Error('boom'); }).toThrow();
  });

  it('non-throwing fails toThrow', () => {
    expect(() => {}).toThrow();
  });
});

const results = run();

if (typeof results !== 'object' || results === null) {
  console.error('run() must return an object');
  process.exit(1);
}

if (typeof results.passed !== 'number' || typeof results.failed !== 'number') {
  console.error('run() must return { passed, failed, results }');
  process.exit(1);
}

// We expect: 5 passing (adds, subtracts, compares objects, compares arrays, detects throws)
// and 2 failing (fails intentionally, non-throwing fails toThrow)
if (results.passed !== 5) {
  console.error('Expected 5 passed, got ' + results.passed);
  process.exit(1);
}
if (results.failed !== 2) {
  console.error('Expected 2 failed, got ' + results.failed);
  process.exit(1);
}

if (!Array.isArray(results.results)) {
  console.error('results.results must be an array');
  process.exit(1);
}

console.log('All test framework tests passed');
"
