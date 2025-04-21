import { runLint, parseCliArgs } from '../src/main';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

describe('runLint', () => {
  const concurrency = 2;
  let stderrSpy: jest.SpyInstance;
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    (console.error as jest.Mock).mockRestore();
    stderrSpy.mockRestore();
  });

  it('returns 0 and logs parallelism for empty diff text', async () => {
    const code = await runLint({ diffText: '' }, concurrency, true);
    expect(stderrSpy).toHaveBeenCalledWith(`Parallelism: ${concurrency}\n`);
    expect(code).toBe(0);
  });

  it('reads diff from file and returns 0', async () => {
    const tmpFile = path.join(os.tmpdir(), `diff-${Date.now()}.txt`);
    await fs.writeFile(tmpFile, '', 'utf-8');
    const code = await runLint({ filePath: tmpFile }, concurrency, true);
    expect(stderrSpy).toHaveBeenCalledWith(`Parallelism: ${concurrency}\n`);
    expect(code).toBe(0);
    await fs.unlink(tmpFile);
  });

  it('throws error if no input provided', async () => {
    // No filePath, no diffText, no stdin
    await expect(runLint({}, concurrency, true)).rejects.toThrow('No diff input provided');
  });
  
  it('throws error on invalid diff input', async () => {
    // Non-empty text but no valid diff headers
    await expect(runLint({ diffText: 'not a diff' }, concurrency, true))
      .rejects.toThrow('Invalid diff input');
  });
});

describe('parseCliArgs', () => {
  it('defaults with no args', () => {
    const opts = parseCliArgs([]);
    expect(opts).toEqual({
      warnMode: false,
      showHelp: false,
      verbose: false,
      parallelism: -1,
      ignoreList: [],
      diffFile: undefined
    });
  });
  it('parses help flag', () => {
    const opts = parseCliArgs(['--help']);
    expect(opts.showHelp).toBe(true);
  });
  it('parses warn flag', () => {
    const opts = parseCliArgs(['-w']);
    expect(opts.warnMode).toBe(true);
  });
  it('parses parallelism long form', () => {
    const opts = parseCliArgs(['--parallelism', '5']);
    expect(opts.parallelism).toBe(5);
  });
  it('parses parallelism short form', () => {
    const opts = parseCliArgs(['-p', '3']);
    expect(opts.parallelism).toBe(3);
  });
  it('parses parallelism with equals', () => {
    const opts = parseCliArgs(['--parallelism=7']);
    expect(opts.parallelism).toBe(7);
  });
  it('rejects missing parallelism value', () => {
    const opts = parseCliArgs(['--parallelism']);
    expect(opts.error).toMatch(/Missing value for --parallelism/);
  });
  it('rejects invalid parallelism value', () => {
    const opts = parseCliArgs(['-p', 'x']);
    expect(opts.error).toMatch(/Invalid parallelism value: x/);
  });
  it('rejects too many args', () => {
    const opts = parseCliArgs(['a', 'b']);
    expect(opts.error).toBe('Too many arguments');
  });
  it('parses diffFile as positional', () => {
    const opts = parseCliArgs(['file.diff']);
    expect(opts.diffFile).toBe('file.diff');
  });
  it('parses ignore short form', () => {
    const opts = parseCliArgs(['-i', 'path/to/file']);
    expect(opts.ignoreList).toEqual(['path/to/file']);
  });
  it('parses ignore long form', () => {
    const opts = parseCliArgs(['--ignore', 'path/to/file#label']);
    expect(opts.ignoreList).toEqual(['path/to/file#label']);
  });
  it('parses ignore with equals', () => {
    const opts = parseCliArgs(['--ignore=another/file']);
    expect(opts.ignoreList).toEqual(['another/file']);
  });
  it('parses multiple ignore options', () => {
    const opts = parseCliArgs(['-i', 'a', '--ignore=b', '-i', 'c#lbl']);
    expect(opts.ignoreList).toEqual(['a', 'b', 'c#lbl']);
  });
  it('rejects missing ignore value', () => {
    const opts = parseCliArgs(['--ignore']);
    expect(opts.error).toMatch(/Missing value for --ignore/);
  });
});

describe('runLint integration with parallelism flag', () => {
  it('runLint respects parsed parallelism in verbose mode', async () => {
    // Use a higher parallelism than default
    const concurrency = 5;
    // Spy on stderr.write to capture the parallelism log
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    // Invoke runLint directly with empty diff and custom concurrency
    const { runLint } = require('../src/main');
    const code = await runLint({ diffText: '' }, concurrency, true);
    expect(code).toBe(0);
    expect(spy).toHaveBeenCalledWith(`Parallelism: ${concurrency}\n`);
    spy.mockRestore();
  });
});

// Integration test: CLI invocation
describe('CLI invocation', () => {
  it('respects --parallelism flag in CLI (verbose)', () => {
    const { spawnSync } = require('child_process');
    const script = require('path').resolve(__dirname, '../dist/main.js');
    // Invoke CLI with parallelism=3 and verbose flag, empty stdin
    const result = spawnSync(process.execPath, [script, '-v', '-p', '3'], {
      input: '',
      encoding: 'utf-8'
    });
    // stderr should include the parallelism message
    expect(result.stderr).toContain('Parallelism: 3');
    // CLI should exit code 0 on empty diff
    expect(result.status).toBe(0);
  });
  
  it('prints full stack trace on fatal error', () => {
    const { spawnSync } = require('child_process');
    const script = require('path').resolve(__dirname, '../dist/main.js');
    // Invoke CLI with a nonexistent diff file
    const result = spawnSync(process.execPath, [script, 'nonexistent.diff'], {
      encoding: 'utf-8'
    });
    // Should exit with code 2
    expect(result.status).toBe(2);
    // stderr should contain the error message and stack trace lines
    const lines = result.stderr.trim().split(/\r?\n/);
    // expect first line is the error message
    expect(lines[0]).toMatch(/^Error: /);
    // there should be stack trace frames matching /^\s+at /
    expect(lines.some((l: string) => /^\s+at /.test(l))).toBe(true);
  });
  it('fails on invalid LINT pragma in source file', () => {
    const { spawnSync } = require('child_process');
    const fsSync = require('fs');
    const os = require('os');
    const path = require('path');
    // Create a temp file with invalid pragma
    const tmpFile = path.join(os.tmpdir(), `lint-invalid-${Date.now()}.ts`);
    fsSync.writeFileSync(tmpFile, '// LINT.IfChange()', 'utf-8');
    // Craft a diff that references the temp file
    const diff = [
      `--- a/${tmpFile}`,
      `+++ b/${tmpFile}`,
      '@@ -1 +1 @@',
      '// LINT.IfChange()',
    ].join('\n');
    const script = path.resolve(__dirname, '../dist/main.js');
    const result = spawnSync(process.execPath, [script, '-v'], {
      input: diff,
      encoding: 'utf-8'
    });
    expect(result.status).toBe(2);
    // Error should include file path and line number
    expect(result.stderr).toMatch(/Malformed LINT.IfChange directive at .*:1/);
  });
});