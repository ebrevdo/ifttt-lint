import { lintDiff } from '../src/LintEngine';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// Suppress console.error to avoid test noise
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  (console.error as jest.Mock).mockRestore();
  (console.log as jest.Mock).mockRestore();
});

describe('cross-language lint directives', () => {
  test('passes when all target files across languages are changed', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lintlang-'));
    const fileTS = path.join(tmpDir, 'file1.ts');
    const filePY = path.join(tmpDir, 'file2.py');
    const fileBZL = path.join(tmpDir, 'file3.bzl');
    // Create source files with directives
    const tsContent = [
      '// LINT.IfChange',
      '// LINT.ThenChange("file2.py")',
      '// LINT.ThenChange("file3.bzl")'
    ].join('\n');
    const pyContent = ['# LINT.Label("pylabel")', '# LINT.EndLabel'].join('\n');
    const bzlContent = ['# dummy bazel file'].join('\n');
    await fs.writeFile(fileTS, tsContent);
    await fs.writeFile(filePY, pyContent);
    await fs.writeFile(fileBZL, bzlContent);
    // Build diff: change TS, PY, and BZL
    const diff = [
      `--- a/${fileTS}`,
      `+++ b/${fileTS}`,
      '@@ -1,3 +1,3 @@',
      '-// LINT.IfChange',
      '+// LINT.IfChange // changed',
      ' // LINT.ThenChange("file2.py")',
      ' // LINT.ThenChange("file3.bzl")',
      `--- a/${filePY}`,
      `+++ b/${filePY}`,
      '@@ -1,2 +1,2 @@',
      '-# LINT.Label("pylabel")',
      '+# LINT.Label("pylabel") // changed',
      ' # LINT.EndLabel',
      `--- a/${fileBZL}`,
      `+++ b/${fileBZL}`,
      '@@ -1,1 +1,1 @@',
      '-# dummy bazel file',
      '+# dummy bazel file // changed'
    ].join('\n');
    const result = await lintDiff(diff, 1, true);
    expect(result).toBe(0);
  });

  test('fails when a target file in another language is not changed', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lintlang-'));
    const fileTS = path.join(tmpDir, 'fileA.ts');
    const filePY = path.join(tmpDir, 'fileB.py');
    // Only two files here
    const tsContent = [
      '// LINT.IfChange',
      '// LINT.ThenChange("fileB.py")'
    ].join('\n');
    const pyContent = ['# initial python code'].join('\n');
    await fs.writeFile(fileTS, tsContent);
    await fs.writeFile(filePY, pyContent);
    // Build diff: change TS but not PY
    const diff = [
      `--- a/${fileTS}`,
      `+++ b/${fileTS}`,
      '@@ -1,2 +1,2 @@',
      '-// LINT.IfChange',
      '+// LINT.IfChange // updated',
      ' // LINT.ThenChange("fileB.py")'
    ].join('\n');
    const code = await lintDiff(diff, 1, true);
    expect(code).toBe(1);
  });
});