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
});
afterAll(() => {
  (console.log as jest.Mock).mockRestore();
});

describe('parseChangedLines', () => {
  test('empty diff returns empty map', () => {
    const result = parseChangedLines('');
    expect(result.size).toBe(0);
  });

  test('rename entries map to new file path', () => {
    const diff = `
rename from old.txt
rename to new.txt
--- a/old.txt
+++ b/new.txt
@@ -1,1 +1,1 @@
-old content
+new content
`.trim();
    const map = parseChangedLines(diff);
    expect(map.has('new.txt')).toBe(true);
    const changes = map.get('new.txt')!;
    expect(changes.addedLines.has(1)).toBe(true);
    expect(changes.removedLines.has(1)).toBe(true);
    expect(map.has('old.txt')).toBe(false);
  });

  test('deleted file entries are skipped', () => {
    const diff = `
--- a/foo.txt
+++ /dev/null
@@ -1,1 +0,0 @@
-deleted line
`.trim();
    const map = parseChangedLines(diff);
    expect(map.has('foo.txt')).toBe(false);
    expect(map.size).toBe(0);
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

  test('error when labeled change missing in same file', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-'));
    const file1 = path.join(tmpDir, 'file1.ts');
    const file1Content = [
      '// LINT.Label("label1")',
      'console.log("unchanged");',
      '// LINT.EndLabel',
      '// LINT.IfChange',
      '// LINT.ThenChange("#label1")',
    ].join('\n');
    await fs.writeFile(file1, file1Content);
    const diff = [
      `--- a/${file1}`,
      `+++ b/${file1}`,
      '@@ -4,4 +4,4 @@',
      '-// LINT.IfChange',
      '+// LINT.IfChange // changed',
    ].join('\n');

    const errors: string[] = [];
    jest.spyOn(console, 'log').mockImplementation(msg => errors.push(msg));
    const result = await lintDiff(diff, 1);
    expect(result).toBe(1);
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/-> ThenChange '#label1' \(line 5\): expected changes in '.+file1\.ts#label1' \(2-2\), but none found/);
  });

  test('allows ThenChange to reference IfChange label in another file', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-iflabel-'));
    const file1 = path.join(tmpDir, 'file1.py');
    const file2 = path.join(tmpDir, 'file2.py');
    const file1Content = [
      '# LINT.IfChange("label")',
      'value = 1',
      '# LINT.ThenChange("file2.py#other")'
    ].join('\n');
    const file2Content = [
      '# LINT.IfChange("other")',
      'value = 1',
      '# LINT.ThenChange("file1.py#label")'
    ].join('\n');
    await fs.writeFile(file1, file1Content, 'utf-8');
    await fs.writeFile(file2, file2Content, 'utf-8');
    const diff = [
      `--- a/${file1}`,
      `+++ b/${file1}`,
      '@@ -1,3 +1,3 @@',
      ' # LINT.IfChange("label")',
      '-value = 1',
      '+value = 2',
      ' # LINT.ThenChange("file2.py#other")',
      `--- a/${file2}`,
      `+++ b/${file2}`,
      '@@ -1,3 +1,3 @@',
      ' # LINT.IfChange("other")',
      '-value = 1',
      '+value = 2',
      ' # LINT.ThenChange("file1.py#label")'
    ].join('\n');
    const code = await lintDiff(diff, 1);
    expect(code).toBe(0);
  });

  test('reports missing changes for referenced IfChange label', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-iflabel-missing-'));
    const file1 = path.join(tmpDir, 'file1.py');
    const file2 = path.join(tmpDir, 'file2.py');
    const file1Content = [
      '# LINT.IfChange("label")',
      'value = 1',
      '# LINT.ThenChange("file2.py#other")'
    ].join('\n');
    const file2Content = [
      '# LINT.IfChange("other")',
      'value = 1',
      '# LINT.ThenChange("file1.py#label")'
    ].join('\n');
    await fs.writeFile(file1, file1Content, 'utf-8');
    await fs.writeFile(file2, file2Content, 'utf-8');
    const diff = [
      `--- a/${file1}`,
      `+++ b/${file1}`,
      '@@ -1,3 +1,3 @@',
      ' # LINT.IfChange("label")',
      '-value = 1',
      '+value = 2',
      ' # LINT.ThenChange("file2.py#other")'
    ].join('\n');
    const errors: string[] = [];
    (console.log as jest.Mock).mockImplementation(msg => errors.push(msg));
    const code = await lintDiff(diff, 1);
    expect(code).toBe(1);
    expect(errors.some(e => e.includes(`target file '${file2}' not changed.`))).toBe(true);
    expect(errors.some(e => e.includes("label 'other' not found"))).toBe(false);
    (console.log as jest.Mock).mockImplementation(() => {});
  });

  test('errors on ThenChange without preceding IfChange', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-'));
    const file1 = path.join(tmpDir, 'file1.ts');
    const content = ['// LINT.ThenChange("foo.ts")'].join('\n');
    await fs.writeFile(file1, content, 'utf-8');
    const diff = [
      `--- a/${file1}`,
      `+++ b/${file1}`,
      '@@ -1 +1 @@',
      '-// LINT.ThenChange("foo.ts")',
      '+// LINT.ThenChange("foo.ts") // changed'
    ].join('\n');
    const logs: string[] = [];
    jest.spyOn(console, 'log').mockImplementation(msg => logs.push(msg));
    const code = await lintDiff(diff, 1);
    expect(code).toBe(1);
    expect(logs.some(l => l.includes("unexpected ThenChange 'foo.ts' without preceding IfChange"))).toBe(true);
    (console.log as jest.Mock).mockRestore();
  });

  test('errors on IfChange without following ThenChange', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-'));
    const file1 = path.join(tmpDir, 'file1.ts');
    const content = ['// LINT.IfChange'].join('\n');
    await fs.writeFile(file1, content, 'utf-8');
    const diff = [
      `--- a/${file1}`,
      `+++ b/${file1}`,
      '@@ -1 +1 @@',
      '-// LINT.IfChange',
      '+// LINT.IfChange // changed'
    ].join('\n');
    const logs: string[] = [];
    jest.spyOn(console, 'log').mockImplementation(msg => logs.push(msg));
    const code = await lintDiff(diff, 1);
    expect(code).toBe(1);
    expect(logs.some(l => l.match(/missing ThenChange after IfChange\b/))).toBe(true);
    (console.log as jest.Mock).mockRestore();
  });
  test('ignores orphan ThenChange when matching ignoreList', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-ignore-'));
    const file1 = path.join(tmpDir, 'file1.ts');
    const content = ['// LINT.ThenChange("foo.ts")'].join('\n');
    await fs.writeFile(file1, content, 'utf-8');
    const diff = [
      `--- a/${file1}`,
      `+++ b/${file1}`,
      '@@ -1 +1 @@',
      '-// LINT.ThenChange("foo.ts")',
      '+// LINT.ThenChange("foo.ts") // changed'
    ].join('\n');
    // Without ignoreList: should error
    const code1 = await lintDiff(diff, 1, true);
    expect(code1).toBe(1);
    // With ignoreList: should ignore error
    const code2 = await lintDiff(diff, 1, true, ['foo.ts']);
    expect(code2).toBe(0);
  });

  test('ignores orphan IfChange when matching ignoreList for file#label', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-ignore-if-'));
    const file1 = path.join(tmpDir, 'file1.ts');
    // Only an IfChange with label, no ThenChange
    await fs.writeFile(file1, ['// LINT.IfChange("lblonly")'].join('\n'), 'utf-8');
    const diff = [
      `--- a/${file1}`,
      `+++ b/${file1}`,
      '@@ -1 +1 @@',
      '-// LINT.IfChange("lblonly")',
      '+// LINT.IfChange("lblonly") // changed'
    ].join('\n');
    // Without ignore: should error
    const code1 = await lintDiff(diff, 1, true);
    expect(code1).toBe(1);
    // With ignoreList for file#lblonly: should ignore error
    const code2 = await lintDiff(diff, 1, true, ['file1.ts#lblonly']);
    expect(code2).toBe(0);
  });

  test('file-level glob ignore skips matching files', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-glob-'));
    const fileJson = path.join(tmpDir, 'file.json');
    const target = path.join(tmpDir, 'nochange.ts');
    // Directive in JSON file: will error without ignore
    await fs.writeFile(fileJson,
      ['// LINT.IfChange', '// LINT.ThenChange("nochange.ts")'].join('\n'), 'utf-8'
    );
    await fs.writeFile(target, ['// dummy'].join('\n'), 'utf-8');
    const diff = [
      `--- a/${fileJson}`,
      `+++ b/${fileJson}`,
      '@@ -1,2 +1,2 @@',
      '-// LINT.IfChange',
      '+// LINT.IfChange // changed',
      ' // LINT.ThenChange("nochange.ts")'
    ].join('\n');
    // Without ignore: should error because target file not changed
    const code1 = await lintDiff(diff, 1, true);
    expect(code1).toBe(1);
    // With glob ignore '*.json': should skip file.json and error is suppressed
    const code2 = await lintDiff(diff, 1, true, ['*.json']);
    expect(code2).toBe(0);
  });

  test('ignores specific labeled scenario via file#label', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-label-'));
    const fileTs = path.join(tmpDir, 'tsconfig.json');
    const target = path.join(tmpDir, 'noop.ts');
    // Labeled directive in tsconfig.json
    await fs.writeFile(fileTs,
      ['// LINT.IfChange("blah")', '// LINT.ThenChange("noop.ts")'].join('\n'), 'utf-8'
    );
    await fs.writeFile(target, ['// dummy'].join('\n'), 'utf-8');
    const diff = [
      `--- a/${fileTs}`,
      `+++ b/${fileTs}`,
      '@@ -1,2 +1,2 @@',
      '-// LINT.IfChange("blah")',
      '+// LINT.IfChange("blah") // changed',
      ' // LINT.ThenChange("noop.ts")'
    ].join('\n');
    // Without ignore: should error because target not changed
    const code1 = await lintDiff(diff, 1, true);
    expect(code1).toBe(1);
    // With ignore pattern tsconfig.json#blah: should skip this labeled scenario
    const code2 = await lintDiff(diff, 1, true, ['tsconfig.json#blah']);
    expect(code2).toBe(0);
  });

  test('ignores specific ThenChange target label via ignoreList', async () => {
    // Set up a scenario where the ThenChange target has a label
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-target-label-'));
    const file1 = path.join(tmpDir, 'file1.ts');
    const file2 = path.join(tmpDir, 'file2.ts');
    // file1 has an unlabeled IfChange and a labeled ThenChange on file2#lbl
    await fs.writeFile(file1, [
      '// LINT.IfChange',
      '// LINT.ThenChange("file2.ts#lbl")'
    ].join('\n'), 'utf-8');
    // file2 contains the label region
    await fs.writeFile(file2, [
      '// LINT.Label("lbl")',
      'console.log("no change");',
      '// LINT.EndLabel'
    ].join('\n'), 'utf-8');
    // Diff changes only file1 IfChange line
    const diff = [
      `--- a/${file1}`,
      `+++ b/${file1}`,
      '@@ -1,2 +1,2 @@',
      '-// LINT.IfChange',
      '+// LINT.IfChange // changed',
      ' // LINT.ThenChange("file2.ts#lbl")'
    ].join('\n');
    // Without ignore: should report missing change in file2#lbl
    const code1 = await lintDiff(diff, 1, true);
    expect(code1).toBe(1);
    // With ignoreList for target label: should ignore that ThenChange
    const code2 = await lintDiff(diff, 1, true, ['file2.ts#lbl']);
    expect(code2).toBe(0);
  });

  test('ignores missing target file for labeled scenario via file#label', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-missing-label-'));
    const file1 = path.join(tmpDir, 'fileA.ts');
    // file1 has an IfChange and a ThenChange with label
    await fs.writeFile(file1, [
      '// LINT.IfChange("lblX")',
      '// LINT.ThenChange("fileB.ts#lblX")'
    ].join('\n'), 'utf-8');
    // Do NOT create fileB.ts, so target file is missing
    const diff = [
      `--- a/${file1}`,
      `+++ b/${file1}`,
      '@@ -1,2 +1,2 @@',
      '-// LINT.IfChange("lblX")',
      '+// LINT.IfChange("lblX") // changed',
      ' // LINT.ThenChange("fileB.ts#lblX")'
    ].join('\n');
    // Without ignore: should error on missing target file
    const errors: string[] = [];
    jest.spyOn(console, 'log').mockImplementation(msg => errors.push(msg));
    const code1 = await lintDiff(diff, 1, true);
    expect(code1).toBe(1);
    expect(errors.some(e => e.includes("missing target file") || e.includes("not found"))).toBe(true);
    // With ignoreList for fileA.ts#lblX: should ignore missing target error
    errors.length = 0;
    const code2 = await lintDiff(diff, 1, true, ['fileA.ts#lblX']);
    expect(code2).toBe(0);
  });

  test('error when code between IfChange and ThenChange is modified but target not changed', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-between-'));
    const file1 = path.join(tmpDir, 'file1.ts');
    const file2 = path.join(tmpDir, 'file2.ts');
    const file1Content = [
      '// LINT.IfChange',
      'const value = 1;',
      '// LINT.ThenChange("file2.ts")'
    ].join('\n');
    const file2Content = ['const value = 1;'].join('\n');
    await fs.writeFile(file1, file1Content);
    await fs.writeFile(file2, file2Content);
    // Modify the code between IfChange and ThenChange, but not the pragmas themselves
    const diff = [
      `--- a/${file1}`,
      `+++ b/${file1}`,
      '@@ -1,3 +1,3 @@',
      ' // LINT.IfChange',
      '-const value = 1;',
      '+const value = 2;',
      ' // LINT.ThenChange("file2.ts")'
    ].join('\n');
    const result = await lintDiff(diff, 1, true);
    expect(result).toBe(1);
  });

  test('no error when code between IfChange and ThenChange is modified and target is changed', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-between-ok-'));
    const file1 = path.join(tmpDir, 'file1.ts');
    const file2 = path.join(tmpDir, 'file2.ts');
    const file1Content = [
      '// LINT.IfChange',
      'const value = 1;',
      '// LINT.ThenChange("file2.ts")'
    ].join('\n');
    const file2Content = ['const value = 1;'].join('\n');
    await fs.writeFile(file1, file1Content);
    await fs.writeFile(file2, file2Content);
    // Modify the code between IfChange and ThenChange, and also modify target
    const diff = [
      `--- a/${file1}`,
      `+++ b/${file1}`,
      '@@ -1,3 +1,3 @@',
      ' // LINT.IfChange',
      '-const value = 1;',
      '+const value = 2;',
      ' // LINT.ThenChange("file2.ts")',
      `--- a/${file2}`,
      `+++ b/${file2}`,
      '@@ -1,1 +1,1 @@',
      '-const value = 1;',
      '+const value = 2;'
    ].join('\n');
    const result = await lintDiff(diff, 1, true);
    expect(result).toBe(0);
  });

  test('no error when only code outside IfChange/ThenChange block is modified', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-outside-'));
    const file1 = path.join(tmpDir, 'file1.ts');
    const file2 = path.join(tmpDir, 'file2.ts');
    const file1Content = [
      'const other = 0;',
      '// LINT.IfChange',
      'const value = 1;',
      '// LINT.ThenChange("file2.ts")',
      'const another = 2;'
    ].join('\n');
    const file2Content = ['const value = 1;'].join('\n');
    await fs.writeFile(file1, file1Content);
    await fs.writeFile(file2, file2Content);
    // Modify code outside the IfChange/ThenChange block
    const diff = [
      `--- a/${file1}`,
      `+++ b/${file1}`,
      '@@ -1,5 +1,5 @@',
      '-const other = 0;',
      '+const other = 99;',
      ' // LINT.IfChange',
      ' const value = 1;',
      ' // LINT.ThenChange("file2.ts")',
      ' const another = 2;'
    ].join('\n');
    const result = await lintDiff(diff, 1, true);
    expect(result).toBe(0);
  });
});
