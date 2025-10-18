#!/usr/bin/env node
// Simple syntax check using acorn (ECMAScript parser). Parses as module to allow import/export.
const fs = require('fs');
const path = require('path');
try {
    const acorn = require('acorn');
    const file = path.resolve(__dirname, '..', 'extension.js');
    const src = fs.readFileSync(file, 'utf8');
    try {
        acorn.parse(src, { sourceType: 'module', ecmaVersion: 'latest' });
        console.log('acorn: Syntax OK');
        process.exit(0);
    } catch (e) {
        console.error('acorn: Syntax error:', e.message);
        process.exit(2);
    }
} catch (err) {
    console.error('acorn is not installed. Run: npm install --prefix "' + path.resolve(__dirname, '..') + '" acorn --save-dev');
    process.exit(3);
}
