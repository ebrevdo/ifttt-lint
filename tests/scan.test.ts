import { runScan } from '../src/main';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('--scan mode validation', () => {
  const tmpPrefix = path.join(os.tmpdir(), 'ifttt-scan-');
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(tmpPrefix);
  });
  afterEach(async () => {
    // Remove temp directory and its contents
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('detects duplicate IfChange labels in a file', async () => {
    const file = path.join(dir, 'dup-if.ts');
    const content = [
      '// LINT.IfChange("foo")',
      '// LINT.IfChange("bar")',
      '// LINT.IfChange("foo")',
    ].join('\n');
    await fs.writeFile(file, content, 'utf-8');
    // Use parallelism of 2
    const code = await runScan(dir, 2, true);
    expect(code).toBe(1);
  });

  it('detects duplicate Label directives in a file', async () => {
    const file = path.join(dir, 'dup-label.ts');
    const content = [
      '// LINT.Label("lbl")',
      '/* LINT.EndLabel */',
      '// LINT.Label("lbl")',
      '/* LINT.EndLabel */',
    ].join('\n');
    await fs.writeFile(file, content, 'utf-8');
    const code = await runScan(dir, 2, true);
    expect(code).toBe(1);
  });

  it('passes when directives are unique', async () => {
    const file = path.join(dir, 'unique.ts');
    const content = [
      '// LINT.IfChange("a")',
      '// LINT.IfChange("b")',
      '// LINT.Label("x")',
      '/* LINT.EndLabel */',
      '// LINT.Label("y")',
      '/* LINT.EndLabel */',
    ].join('\n');
    await fs.writeFile(file, content, 'utf-8');
    const code = await runScan(dir, 2, true);
    expect(code).toBe(0);
  });
});