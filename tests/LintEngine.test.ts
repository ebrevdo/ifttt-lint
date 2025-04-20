import { parseChangedLines } from '../src/DiffParser';
import { parseFileDirectives } from '../src/DirectiveParser';
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

describe('parseChangedLines', () => {
  test('empty diff returns empty map', () => {
    const result = parseChangedLines('');
    expect(result.size).toBe(0);
  });

  test('simple add and delete', () => {
    const diff = `
--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
-old line
+new line
 unchanged line
`.trim();
    const map = parseChangedLines(diff);
    expect(map.has('file.txt')).toBe(true);
    const changes = map.get('file.txt')!;
    expect(changes.addedLines.has(1)).toBe(true);
    expect(changes.removedLines.has(1)).toBe(true);
  });
});

describe('DirectiveParser', () => {
  test('parses directives with correct line numbers', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-'));
    const filePath = path.join(tmpDir, 'test.ts');
    const content = [
      '// LINT.IfChange',
      '// LINT.IfChange(\'g\')',
      'console.log("hello");',
      '// LINT.ThenChange("file2.ts#label")',
      '// LINT.Label("label")',
      'some code',
      '// LINT.EndLabel'
    ].join('\n');
    await fs.writeFile(filePath, content);
    const directives = await parseFileDirectives(filePath);
    expect(directives).toEqual([
      { kind: 'IfChange', line: 1 },
      { kind: 'IfChange', line: 2, label: 'g' },
      { kind: 'ThenChange', line: 4, target: 'file2.ts#label' },
      { kind: 'Label', line: 5, name: 'label' },
      { kind: 'EndLabel', line: 7 },
    ]);
  });
  
  test('parses double-quoted IfChange label', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-'));
    const filePath = path.join(tmpDir, 'test2.ts');
    const content = [
      '// LINT.IfChange',
      '// LINT.IfChange("dbl")',
      '// LINT.ThenChange("file3.ts#lbl")',
      '// LINT.Label("lbl")',
      'code',
      '// LINT.EndLabel'
    ].join('\n');
    await fs.writeFile(filePath, content);
    const directives2 = await parseFileDirectives(filePath);
    expect(directives2).toEqual([
      { kind: 'IfChange', line: 1 },
      { kind: 'IfChange', line: 2, label: 'dbl' },
      { kind: 'ThenChange', line: 3, target: 'file3.ts#lbl' },
      { kind: 'Label', line: 4, name: 'lbl' },
      { kind: 'EndLabel', line: 6 },
    ]);
  });
  
  test('parses directives in C-style block comments', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-'));
    const filePath = path.join(tmpDir, 'test.c');
    const content = [
      'int main() {',
      '  /*',
      '   LINT.IfChange',
      '   LINT.ThenChange("foo.c")',
      '  */',
      '  return 0;',
      '}'
    ].join('\n');
    await fs.writeFile(filePath, content, 'utf-8');
    const directives = await parseFileDirectives(filePath);
    expect(directives).toEqual([
      { kind: 'IfChange', line: 2 },
      { kind: 'ThenChange', line: 3, target: 'foo.c' }
    ]);
  });
});

describe('lintDiff', () => {
  test('no error when target file changed', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-'));
    const file1 = path.join(tmpDir, 'file1.ts');
    const file2 = path.join(tmpDir, 'file2.ts');
    const file1Content = ['// LINT.IfChange', '// LINT.ThenChange("file2.ts")'].join('\n');
    const file2Content = ['// LINT.Label("dummy")', '// LINT.EndLabel'].join('\n');
    await fs.writeFile(file1, file1Content);
    await fs.writeFile(file2, file2Content);
    const diff = [
      `--- a/${file1}`,
      `+++ b/${file1}`,
      '@@ -1,2 +1,2 @@',
      '-// LINT.IfChange',
      '+// LINT.IfChange // changed',
      ' // LINT.ThenChange("file2.ts")',
      `--- a/${file2}`,
      `+++ b/${file2}`,
      '@@ -1,2 +1,2 @@',
      '-// LINT.Label("dummy")',
      '+// LINT.Label("dummy") // changed',
      ' // LINT.EndLabel'
    ].join('\n');
    const result = await lintDiff(diff, 1, true);
    expect(result).toBe(0);
  });

  test('error when target file not changed', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-'));
    const file1 = path.join(tmpDir, 'file1.ts');
    const file2 = path.join(tmpDir, 'file2.ts');
    const file1Content = ['// LINT.IfChange', '// LINT.ThenChange("file2.ts")'].join('\n');
    const file2Content = ['// LINT.Label("dummy")', '// LINT.EndLabel'].join('\n');
    await fs.writeFile(file1, file1Content);
    await fs.writeFile(file2, file2Content);
    const diff = [
      `--- a/${file1}`,
      `+++ b/${file1}`,
      '@@ -1,1 +1,1 @@',
      '-// LINT.IfChange',
      '+// LINT.IfChange // changed',
      ' // LINT.ThenChange("file2.ts")'
    ].join('\n');
    const result = await lintDiff(diff, 1, true);
    expect(result).toBe(1);
  });
  
  test('reports IfChange label in error context', async () => {
    // Setup files
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-'));
    const file1 = path.join(tmpDir, 'file1.ts');
    const file2 = path.join(tmpDir, 'file2.ts');
    const file1Content = [
      "// LINT.IfChange('g')",
      '// LINT.ThenChange("file2.ts")'
    ].join('\n');
    const file2Content = ['// dummy file'].join('\n');
    await fs.writeFile(file1, file1Content);
    await fs.writeFile(file2, file2Content);
    // Prepare diff: change file1 line 1
    const diff = [
      `--- a/${file1}`,
      `+++ b/${file1}`,
      '@@ -1,1 +1,1 @@',
      '-// LINT.IfChange(\'g\')',
      '+// LINT.IfChange(\'g\') // modified',
      `--- a/${file2}`,
      `+++ b/${file2}`,
      '@@ -1,0 +1,1 @@',
      '+// dummy file changed'
    ].join('\n');
    const errors: string[] = [];
    jest.spyOn(console, 'log').mockImplementation(msg => errors.push(msg));
    const code = await lintDiff(diff, 1, true);
    expect(code).toBe(0); // file2 changed, no error
    // Now test missing file2 change
    const diff2 = [
      `--- a/${file1}`,
      `+++ b/${file1}`,
      '@@ -1,1 +1,1 @@',
      '-// LINT.IfChange(\'g\')',
      '+// LINT.IfChange(\'g\') // modified'
    ].join('\n');
    errors.length = 0;
    const code2 = await lintDiff(diff2, 1, true);
    expect(code2).toBe(1);
    expect(errors.some(e => e.includes("file1.ts#g:1 -> ThenChange 'file2.ts' (line 2)"))).toBe(true);
  });

  test('no error for labeled change', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-'));
    const file1 = path.join(tmpDir, 'file1.ts');
    const file2 = path.join(tmpDir, 'file2.ts');
    const file1Content = [
      '// LINT.IfChange',
      '// LINT.ThenChange("file2.ts#label1")'
    ].join('\n');
    const file2Content = [
      '// some header',
      '// LINT.Label("label1")',
      'console.log("unchanged");',
      '// LINT.EndLabel',
      '// footer'
    ].join('\n');
    await fs.writeFile(file1, file1Content);
    await fs.writeFile(file2, file2Content);
    const diff = [
      `--- a/${file1}`,
      `+++ b/${file1}`,
      '@@ -1,2 +1,2 @@',
      '-// LINT.IfChange',
      '+// LINT.IfChange // changed',
      ' // LINT.ThenChange("file2.ts#label1")',
      `--- a/${file2}`,
      `+++ b/${file2}`,
      '@@ -1,5 +1,5 @@',
      ' // some header',
      ' // LINT.Label("label1")',
      '-console.log("unchanged");',
      '+console.log("unchanged"); // changed',
      ' // LINT.EndLabel',
      ' // footer'
    ].join('\n');
    const result = await lintDiff(diff, 1, true);
    expect(result).toBe(0);
  });

  test('error when labeled change missing', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-'));
    const file1 = path.join(tmpDir, 'file1.ts');
    const file2 = path.join(tmpDir, 'file2.ts');
    const file1Content = [
      '// LINT.IfChange',
      '// LINT.ThenChange("file2.ts#label1")'
    ].join('\n');
    const file2Content = [
      '// some header',
      '// LINT.Label("label1")',
      'console.log("unchanged");',
      '// LINT.EndLabel',
      '// footer'
    ].join('\n');
    await fs.writeFile(file1, file1Content);
    await fs.writeFile(file2, file2Content);
    const diff = [
      `--- a/${file1}`,
      `+++ b/${file1}`,
      '@@ -1,2 +1,2 @@',
      '-// LINT.IfChange',
      '+// LINT.IfChange // changed',
      ' // LINT.ThenChange("file2.ts#label1")',
      `--- a/${file2}`,
      `+++ b/${file2}`,
      '@@ -1,5 +1,5 @@',
      ' // some header',
      ' // LINT.Label("label1")',
      ' console.log("unchanged");',
      '-// LINT.EndLabel',
      '+// LINT.EndLabel // changed',
      ' // footer'
    ].join('\n');
    const result = await lintDiff(diff, 1);
    expect(result).toBe(1);
  });
});