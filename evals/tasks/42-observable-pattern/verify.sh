#!/bin/bash
set -euo pipefail

node -e "
const { Observable, map, filter, take } = require('./observable.js');

// Test Observable.of
const values1 = [];
const obs = Observable.of(1, 2, 3, 4, 5);
const unsub = obs.subscribe({ next: v => values1.push(v) });
if (JSON.stringify(values1) !== '[1,2,3,4,5]') {
  console.error('of() failed:', values1);
  process.exit(1);
}

// Test unsubscribe is a function
if (typeof unsub !== 'function') {
  console.error('subscribe should return unsubscribe function');
  process.exit(1);
}

// Test map operator
const values2 = [];
const mapped = map(x => x * 2);
const obs2 = mapped(Observable.of(1, 2, 3));
obs2.subscribe({ next: v => values2.push(v) });
if (JSON.stringify(values2) !== '[2,4,6]') {
  console.error('map failed:', values2);
  process.exit(1);
}

// Test filter operator
const values3 = [];
const filtered = filter(x => x > 2);
const obs3 = filtered(Observable.of(1, 2, 3, 4));
obs3.subscribe({ next: v => values3.push(v) });
if (JSON.stringify(values3) !== '[3,4]') {
  console.error('filter failed:', values3);
  process.exit(1);
}

// Test take operator
const values4 = [];
const taken = take(2);
const obs4 = taken(Observable.of(1, 2, 3, 4, 5));
obs4.subscribe({ next: v => values4.push(v) });
if (JSON.stringify(values4) !== '[1,2]') {
  console.error('take failed:', values4);
  process.exit(1);
}
"
