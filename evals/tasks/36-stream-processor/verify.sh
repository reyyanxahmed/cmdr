#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/workspace"

node -e "
const mod = require('./stream-processor.js');
const processLines = typeof mod === 'function' ? mod : (mod.processLines || mod.default);
const path = require('path');
const fs = require('fs');

const inputPath = path.join(__dirname, 'input.txt');
const outputPath = path.join(__dirname, 'output.txt');

// Clean up any previous output
if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

async function test() {
  const count = await processLines(inputPath, outputPath, line => line.toUpperCase());

  if (count !== 5) {
    console.error('Expected 5 lines processed, got ' + count);
    process.exit(1);
  }

  if (!fs.existsSync(outputPath)) {
    console.error('Output file was not created');
    process.exit(1);
  }

  const output = fs.readFileSync(outputPath, 'utf-8').trim().split('\n');
  const expected = ['HELLO WORLD', 'FOO BAR BAZ', 'TESTING 123', 'LINE FOUR', 'FINAL LINE'];

  if (output.length !== 5) {
    console.error('Expected 5 output lines, got ' + output.length + ': ' + JSON.stringify(output));
    process.exit(1);
  }

  for (let i = 0; i < expected.length; i++) {
    if (output[i].trim() !== expected[i]) {
      console.error('Line ' + i + ': expected \"' + expected[i] + '\", got \"' + output[i].trim() + '\"');
      process.exit(1);
    }
  }

  console.log('All stream processor tests passed');
}

test().catch(e => { console.error(e); process.exit(1); });
"

# Clean up output file
rm -f "$(dirname "$0")/workspace/output.txt"
