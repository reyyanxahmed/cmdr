#!/bin/bash
set -euo pipefail

# Check SQL injection is fixed (no string concatenation in query)
node -e "
const src = require('fs').readFileSync('./webapp.js', 'utf-8');
// Should not have direct string concat in SQL
if (src.includes(\"'\" + ' + query') || src.includes('+ query +')) {
  console.error('SQL injection still present');
  process.exit(1);
}
"

# Check XSS is fixed (HTML should be escaped)
node -e "
const { handleRequest } = require('./webapp.js');
let body = '';
const mockRes = {
  writeHead: () => {},
  end: (data) => { body = data; }
};
const mockReq = { url: '/search?q=<script>alert(1)</script>' };
handleRequest(mockReq, mockRes);
if (body.includes('<script>')) {
  console.error('XSS vulnerability still present');
  process.exit(1);
}
"

# Check path traversal is fixed
node -e "
const src = require('fs').readFileSync('./webapp.js', 'utf-8');
// Should have some path validation (resolve, normalize, startsWith, or similar)
if (!src.includes('resolve') && !src.includes('normalize') && !src.includes('startsWith') && !src.includes('includes(\"..\")') && !src.includes('indexOf')) {
  console.error('No path traversal protection found');
  process.exit(1);
}
"
