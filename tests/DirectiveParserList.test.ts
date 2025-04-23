import { parseFileDirectives } from '../src/DirectiveParser';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('DirectiveParser ThenChange array literal', () => {
  it('parses multiple targets with single-quoted array', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-'));
    const file = path.join(tmpDir, 'test1.ts');
    const content = [
      '// LINT.ThenChange([\'file1.ts\', \'file2.ts#lbl\'])'
    ].join('\n');
    await fs.writeFile(file, content, 'utf-8');
    const directives = await parseFileDirectives(file);
    expect(directives).toEqual([
      { kind: 'ThenChange', line: 1, target: 'file1.ts' },
      { kind: 'ThenChange', line: 1, target: 'file2.ts#lbl' }
    ]);
  });

  it('parses multiple targets with double-quoted array and spaces', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-'));
    const file = path.join(tmpDir, 'test2.ts');
    const content = [
      '// LINT.ThenChange(["foo.ts",  "bar.ts#region" ])'
    ].join('\n');
    await fs.writeFile(file, content, 'utf-8');
    const directives = await parseFileDirectives(file);
    expect(directives).toEqual([
      { kind: 'ThenChange', line: 1, target: 'foo.ts' },
      { kind: 'ThenChange', line: 1, target: 'bar.ts#region' }
    ]);
  });
  
  it('parses multi-line array literal', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-'));
    const file = path.join(tmpDir, 'test3.ts');
    const content = [
      '// LINT.ThenChange(',
      '//   ["file1.ts",',
      '//    "file2.ts#lbl"],',
      '// )'
    ].join('\n');
    await fs.writeFile(file, content, 'utf-8');
    const directives = await parseFileDirectives(file);
    expect(directives).toEqual([
      { kind: 'ThenChange', line: 1, target: 'file1.ts' },
      { kind: 'ThenChange', line: 1, target: 'file2.ts#lbl' }
    ]);
  });
  describe('parseFileDirectives on directories', () => {
    it('returns empty directive list for directory paths', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-dir-'));
      const directives = await parseFileDirectives(tmpDir);
      expect(directives).toEqual([]);
    });
  });
});