#!/usr/bin/env node
import { createProcessIo } from './io.js';
import { main } from './main.js';

main(process.argv.slice(2), createProcessIo()).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`brud failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
