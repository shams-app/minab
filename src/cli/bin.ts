#!/usr/bin/env node
/**
 * The executable wrapper around `runCli`. Everything real lives in
 * `main.ts`, which takes its argv and output sinks as parameters so the
 * test suite can run whole commands in-process; this file is the only
 * place that touches `process` and the console.
 */

import { runCli } from './main.js';

const exitCode = await runCli(process.argv.slice(2), {
    out: text => console.log(text),
    err: text => console.error(text),
    cwd: process.cwd()
});
process.exitCode = exitCode;
