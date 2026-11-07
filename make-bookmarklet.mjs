#!/usr/bin/env node
/*
 * make-bookmarklet.mjs
 *
 * Deterministically turn a readable JavaScript source file into a
 * copy/paste bookmarklet: a single `javascript:void (...)` line.
 *
 * There are no dependencies. `node` plus this file is the whole toolchain,
 * so a rebuild is byte-for-byte reproducible on any machine.
 *
 * What it does, in order:
 *   1. strips `//` line comments and block comments
 *   2. collapses each run of whitespace *outside* string, template, and
 *      regex literals down to a single space
 *   3. wraps the result as `javascript:void <code>`
 *   4. proves the result still parses by running `node --check` on it
 *
 * The input must be a single expression (as table-count-manual.js is: one
 * IIFE). `void` applies to the expression that follows it, so the bookmarklet
 * evaluates it and returns undefined. A source file of loose statements would
 * need its own IIFE wrapper before it is valid here.
 *
 * It is deliberately conservative. It never renames an identifier,
 * reorders anything, or touches whitespace inside a literal. It also
 * never deletes a newline: newlines become spaces, so automatic semicolon
 * insertion behaves exactly as it did in the source. The output is
 * therefore guaranteed to parse whenever the input does, and to mean the
 * same thing for any source that does not rely on a line break being
 * significant right after return / throw / break / continue / ++ / --.
 *
 * Usage:
 *   node make-bookmarklet.mjs <input.js>              # -> <input>.txt
 *   node make-bookmarklet.mjs <input.js> -o out.txt
 *   node make-bookmarklet.mjs <input.js> --check      # verify, do not write
 *   node make-bookmarklet.mjs <input.js> --stdout     # print, do not write
 *
 * Default output path: the input path with a .txt extension.
 *
 * Exit codes:
 *   0  wrote the bookmarklet, printed it, or --check found it up to date
 *   1  bad usage, unreadable input, a failed parse check, or --check found
 *      the existing .txt stale
 */

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw'
]);

const isWordChar = (c) => /[A-Za-z0-9_$]/.test(c);

/* The identifier immediately before the end of `code`, if any. */
function lastWord(code) {
  let j = code.length;
  while (j > 0 && isWordChar(code[j - 1])) j -= 1;
  return code.slice(j);
}

/*
 * Is a `/` at this position the start of a regex literal rather than a
 * division operator? The one real ambiguity in hand-minifying JS. We look
 * at the last significant character emitted: after a value (identifier,
 * number, `)`, `]`, `}`, or a string) it is division; otherwise, or right
 * after a keyword like `return`, it is a regex.
 */
function regexAllowed(code, prevSig) {
  if (!prevSig) return true;
  if (KEYWORDS.has(lastWord(code))) return true;
  if (isWordChar(prevSig)) return false;
  if (prevSig === ')' || prevSig === ']' || prevSig === '}' || prevSig === '"') return false;
  return true;
}

function minify(src) {
  let out = '';
  let i = 0;
  let state = 'code';
  let pendingSpace = false;
  let prevSig = '';

  const emit = (ch) => { out += ch; };
  const flushSpace = () => {
    if (pendingSpace && out.length) emit(' ');
    pendingSpace = false;
  };

  while (i < src.length) {
    const c = src[i];

    if (state === 'code') {
      if (c === '/' && src[i + 1] === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && src[i + 1] === '*') { state = 'block'; i += 2; continue; }
      if (c === '/' && regexAllowed(out, prevSig)) {
        flushSpace(); emit('/'); state = 'regex'; i += 1; continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        flushSpace(); emit(c); state = c === "'" ? 'sq' : c === '"' ? 'dq' : 'tpl';
        prevSig = '"'; i += 1; continue;
      }
      if (/\s/.test(c)) { pendingSpace = true; i += 1; continue; }
      flushSpace();
      emit(c);
      prevSig = c;
      i += 1;
      continue;
    }

    if (state === 'sq' || state === 'dq') {
      emit(c);
      if (c === '\\') { emit(src[i + 1] || ''); i += 2; continue; }
      if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"')) state = 'code';
      i += 1;
      continue;
    }

    if (state === 'tpl') {
      emit(c);
      if (c === '\\') { emit(src[i + 1] || ''); i += 2; continue; }
      if (c === '`') state = 'code';
      i += 1;
      continue;
    }

    if (state === 'line') {
      if (c === '\n') { state = 'code'; pendingSpace = true; }
      i += 1;
      continue;
    }

    if (state === 'block') {
      if (c === '*' && src[i + 1] === '/') { state = 'code'; pendingSpace = true; i += 2; continue; }
      i += 1;
      continue;
    }

    if (state === 'regex') {
      emit(c);
      if (c === '\\') { emit(src[i + 1] || ''); i += 2; continue; }
      if (c === '[') { state = 'regexClass'; i += 1; continue; }
      if (c === '/') {
        state = 'code';
        prevSig = ')';
        i += 1;
        while (i < src.length && /[a-z]/i.test(src[i])) { emit(src[i]); i += 1; }
        continue;
      }
      i += 1;
      continue;
    }

    if (state === 'regexClass') {
      emit(c);
      if (c === '\\') { emit(src[i + 1] || ''); i += 2; continue; }
      if (c === ']') state = 'regex';
      i += 1;
      continue;
    }
  }

  return out.trim();
}

/* Parse-check the generated code with the same node that is running us. */
function parses(code) {
  const dir = mkdtempSync(join(tmpdir(), 'bookmarklet-'));
  const file = join(dir, 'check.js');
  try {
    writeFileSync(file, code);
    const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (res.status === 0) return { ok: true };
    return { ok: false, detail: (res.stderr || res.error || 'node --check failed').toString().trim() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error('usage: node make-bookmarklet.mjs <input.js> [-o <output.txt>] [--check] [--stdout]');
  process.exit(1);
}

const argv = process.argv.slice(2);
let input = null;
let output = null;
let check = false;
let toStdout = false;

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--check') { check = true; continue; }
  if (arg === '--stdout') { toStdout = true; continue; }
  if (arg === '-o' || arg === '--out') { output = argv[++i]; if (!output) usage('missing path after ' + arg); continue; }
  if (arg === '-h' || arg === '--help') usage();
  if (arg.startsWith('-')) usage(`unknown option ${arg}`);
  if (input) usage('more than one input file');
  input = arg;
}

if (!input) usage('no input file');
if (check && toStdout) usage('--check and --stdout are mutually exclusive');

const inputPath = resolve(input);
if (!existsSync(inputPath)) usage(`no such file: ${inputPath}`);
if (!output) output = inputPath.replace(/\.[^./\\]+$/, '') + '.txt';
const outputPath = resolve(output);

const source = readFileSync(inputPath, 'utf8');
const code = minify(source);
const bookmarklet = `javascript:void ${code}\n`;

const parsed = parses(code);
if (!parsed.ok) {
  console.error('error: minified output does not parse; refusing to write a broken bookmarklet');
  console.error(parsed.detail);
  process.exit(1);
}

if (toStdout) {
  process.stdout.write(bookmarklet);
  process.exit(0);
}

if (check) {
  if (!existsSync(outputPath)) {
    console.error(`stale: ${outputPath} does not exist (run without --check to generate it)`);
    process.exit(1);
  }
  const existing = readFileSync(outputPath, 'utf8');
  if (existing !== bookmarklet) {
    console.error(`stale: ${outputPath} does not match ${inputPath} (run without --check to regenerate it)`);
    process.exit(1);
  }
  console.log(`ok: ${outputPath} is up to date`);
  process.exit(0);
}

writeFileSync(outputPath, bookmarklet);
console.log(`wrote ${outputPath} (${bookmarklet.length} bytes, parses clean)`);
