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
});
afterAll(() => {
  (console.log as jest.Mock).mockRestore();
});

describe('cross-language lint directives', () => {
  test('passes when all target files across languages are changed', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lintlang-'));
    const fileTS = path.join(tmpDir, 'file1.ts');
    const filePY = path.join(tmpDir, 'file2.py');
    const fileBZL = path.join(tmpDir, 'file3.bzl');
    const fileToml = path.join(tmpDir, 'config.toml');
    const fileYml = path.join(tmpDir, 'config.yml');
    const fileTsx = path.join(tmpDir, 'Component.tsx');
    // Create source files with directives
    const tsContent = [
      '// LINT.IfChange',
      '// LINT.ThenChange("file2.py")',
      '// LINT.ThenChange("file3.bzl")',
      '// LINT.ThenChange("config.toml")',
      '// LINT.ThenChange("config.yml")',
      '// LINT.ThenChange("Component.tsx")'
    ].join('\n');
    const pyContent = ['# LINT.Label("pylabel")', '# LINT.EndLabel'].join('\n');
    const bzlContent = ['# dummy bazel file'].join('\n');
    const tomlContent = ['# LINT.IfChange', '[database]', 'host = "localhost"', '# LINT.ThenChange("file1.ts")'].join('\n');
    const ymlContent = ['# LINT.IfChange', 'port: 3000', '# LINT.ThenChange("file1.ts")'].join('\n');
    const tsxContent = ['// LINT.IfChange', 'export const Component = () => <div />;', '// LINT.ThenChange("file1.ts")'].join('\n');
    await fs.writeFile(fileTS, tsContent);
    await fs.writeFile(filePY, pyContent);
    await fs.writeFile(fileBZL, bzlContent);
    await fs.writeFile(fileToml, tomlContent);
    await fs.writeFile(fileYml, ymlContent);
    await fs.writeFile(fileTsx, tsxContent);
    // Build diff: change all files
    const diff = [
      `--- a/${fileTS}`,
      `+++ b/${fileTS}`,
      '@@ -1,6 +1,6 @@',
      '-// LINT.IfChange',
      '+// LINT.IfChange // changed',
      ' // LINT.ThenChange("file2.py")',
      ' // LINT.ThenChange("file3.bzl")',
      ' // LINT.ThenChange("config.toml")',
      ' // LINT.ThenChange("config.yml")',
      ' // LINT.ThenChange("Component.tsx")',
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
      '+# dummy bazel file // changed',
      `--- a/${fileToml}`,
      `+++ b/${fileToml}`,
      '@@ -1,4 +1,4 @@',
      ' # LINT.IfChange',
      '-[database]',
      '+[database] # updated',
      ' host = "localhost"',
      ' # LINT.ThenChange("file1.ts")',
      `--- a/${fileYml}`,
      `+++ b/${fileYml}`,
      '@@ -1,3 +1,3 @@',
      ' # LINT.IfChange',
      '-port: 3000',
      '+port: 8080',
      ' # LINT.ThenChange("file1.ts")',
      `--- a/${fileTsx}`,
      `+++ b/${fileTsx}`,
      '@@ -1,3 +1,3 @@',
      ' // LINT.IfChange',
      '-export const Component = () => <div />;',
      '+export const Component = () => <span />;',
      ' // LINT.ThenChange("file1.ts")'
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