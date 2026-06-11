import { parseFileDirectives } from '../src/DirectiveParser';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('DirectiveParser file-type support', () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-ft-'));
  });
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('Markdown', () => {
    it('parses directives from HTML comments in .md files', async () => {
      const file = path.join(tmpDir, 'doc.md');
      const content = [
        '# Heading',
        '<!-- LINT.IfChange -->',
        'Some prose describing config.',
        '<!-- LINT.ThenChange("config.py") -->'
      ].join('\n');
      await fs.writeFile(file, content, 'utf-8');
      const directives = await parseFileDirectives(file);
      expect(directives).toEqual([
        { kind: 'IfChange', line: 2 },
        { kind: 'ThenChange', line: 4, target: 'config.py' }
      ]);
    });

    it('parses labeled IfChange and array ThenChange in .markdown files', async () => {
      const file = path.join(tmpDir, 'doc.markdown');
      const content = [
        '<!-- LINT.IfChange("docs") -->',
        'text',
        "<!-- LINT.ThenChange(['a.py', 'b.ts#foo']) -->"
      ].join('\n');
      await fs.writeFile(file, content, 'utf-8');
      const directives = await parseFileDirectives(file);
      expect(directives).toEqual([
        { kind: 'IfChange', line: 1, label: 'docs' },
        { kind: 'ThenChange', line: 3, target: 'a.py' },
        { kind: 'ThenChange', line: 3, target: 'b.ts#foo' }
      ]);
    });

    it('returns no directives for markdown without LINT comments', async () => {
      const file = path.join(tmpDir, 'plain.md');
      await fs.writeFile(file, '# Title\n\nJust prose, no directives.\n', 'utf-8');
      const directives = await parseFileDirectives(file);
      expect(directives).toEqual([]);
    });
  });

  describe('Makefiles', () => {
    const mkContent = [
      '# LINT.IfChange',
      'SOMEVAR = 1',
      '# LINT.ThenChange("config.py")'
    ].join('\n');
    const expected = [
      { kind: 'IfChange', line: 1 },
      { kind: 'ThenChange', line: 3, target: 'config.py' }
    ];

    it.each([
      ['Makefile'],
      ['makefile'],
      ['GNUmakefile'],
      ['build.mk']
    ])('parses # directives in %s', async (name) => {
      const file = path.join(tmpDir, name);
      await fs.writeFile(file, mkContent, 'utf-8');
      const directives = await parseFileDirectives(file);
      expect(directives).toEqual(expected);
    });

    it('parses a multi-line ThenChange array in a Makefile', async () => {
      const file = path.join(tmpDir, 'Makefile');
      const content = [
        '# LINT.IfChange',
        'SOMEVAR = 1',
        '# LINT.ThenChange(',
        "#  ['py_config.py',",
        "#   'ts_config.ts#foo'],",
        '# )'
      ].join('\n');
      await fs.writeFile(file, content, 'utf-8');
      const directives = await parseFileDirectives(file);
      expect(directives).toEqual([
        { kind: 'IfChange', line: 1 },
        { kind: 'ThenChange', line: 3, target: 'py_config.py' },
        { kind: 'ThenChange', line: 3, target: 'ts_config.ts#foo' }
      ]);
    });
  });
});
