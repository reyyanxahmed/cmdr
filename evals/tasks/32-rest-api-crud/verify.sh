#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/workspace"

# Verify all three files exist
[ -f store.js ] || { echo "store.js missing"; exit 1; }
[ -f routes.js ] || { echo "routes.js missing"; exit 1; }
[ -f server.js ] || { echo "server.js missing"; exit 1; }

node -e "
const store = require('./store.js');

// Test store CRUD operations
// Add item
const item = typeof store.add === 'function'
  ? store.add({ name: 'Widget', price: 9.99 })
  : (typeof store.create === 'function' ? store.create({ name: 'Widget', price: 9.99 }) : null);

if (!item) { console.error('store must export add() or create()'); process.exit(1); }
if (!item.id && item.id !== 0) { console.error('Added item must have an id'); process.exit(1); }
if (item.name !== 'Widget') { console.error('Item name mismatch'); process.exit(1); }

// Get item
const getAll = typeof store.getAll === 'function' ? store.getAll() : (typeof store.list === 'function' ? store.list() : store.findAll ? store.findAll() : null);
if (!getAll || !Array.isArray(getAll) || getAll.length < 1) {
  console.error('store must export getAll()/list() returning array with items');
  process.exit(1);
}

// Get by id
const getOne = typeof store.get === 'function' ? store.get(item.id) : (typeof store.getById === 'function' ? store.getById(item.id) : (typeof store.find === 'function' ? store.find(item.id) : null));
if (!getOne || getOne.name !== 'Widget') {
  console.error('store must export get()/getById()/find() returning the item');
  process.exit(1);
}

// Update item
const updated = typeof store.update === 'function' ? store.update(item.id, { name: 'Gadget', price: 19.99 }) : null;
if (!updated) { console.error('store must export update()'); process.exit(1); }
if (updated.name !== 'Gadget') { console.error('Update failed'); process.exit(1); }

// Delete item
const deleteResult = typeof store.remove === 'function' ? store.remove(item.id) : (typeof store.delete === 'function' ? store.delete(item.id) : null);
if (deleteResult === null || deleteResult === undefined) { console.error('store must export remove()/delete()'); process.exit(1); }

const afterDelete = typeof store.getAll === 'function' ? store.getAll() : (typeof store.list === 'function' ? store.list() : store.findAll());
if (afterDelete.length !== 0) { console.error('Item should be deleted'); process.exit(1); }

// Verify routes.js exports something
const routes = require('./routes.js');
if (typeof routes !== 'function' && typeof routes !== 'object') {
  console.error('routes.js must export a function or object');
  process.exit(1);
}

console.log('All REST API CRUD tests passed');
"
