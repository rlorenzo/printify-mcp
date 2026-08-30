#!/usr/bin/env node

// Root entry for consumers that resolve the package by path rather than through
// the "exports" map. Mirrors package.json main -> the library surface, NOT the
// CLI: importing this must not start a server or patch the caller's console.

export * from './dist/exports.js';
export { default } from './dist/exports.js';
