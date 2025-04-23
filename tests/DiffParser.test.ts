import { parseChangedLines } from '../src/DiffParser';

describe('parseChangedLines spurious header filtering', () => {
  it('ignores comment lines starting with --- without valid path', () => {
    const diff = [
      'diff --git a/file.sql b/file.sql',
      'index abc..def 100644',
      '--- a/file.sql',
      '+++ b/file.sql',
      '@@ -1,6 +1,6 @@',
      ' SELECT *',
      '+SELECT hello',
      ' --- This is a comment, not a file header',
      '-OLD LINE',
      '+NEW LINE'
    ].join('\n');
    const result = parseChangedLines(diff);
    // Only one file should be parsed
    expect(result.size).toBe(1);
    expect(result.has('file.sql')).toBe(true);
    const changes = result.get('file.sql')!;
    // Added lines at newLine positions 2 and 4
    expect(changes.addedLines.has(2)).toBe(true);
    expect(changes.addedLines.has(4)).toBe(true);
    // Removed line at oldLine position 3
    expect(changes.removedLines.has(3)).toBe(true);
  });

  it('retains real file header lines starting with --- a/ or +++ b/', () => {
    const diff = [
      'diff --git a/foo.js b/foo.js',
      'index 123..456 100644',
      '--- a/foo.js',
      '+++ b/foo.js',
      '@@ -0,0 +1,1 @@',
      '+console.log("hi");'
    ].join('\n');
    const result = parseChangedLines(diff);
    expect(result.size).toBe(1);
    expect(Array.from(result.keys())).toEqual(['foo.js']);
    const changes = result.get('foo.js')!;
    expect(changes.addedLines.has(1)).toBe(true);
  });
  it('accepts file headers with arbitrary prefixes (e.g., c/ and w/)', () => {
    const diff = [
      'diff --git c/path/file.txt w/path/file.txt',
      'index 123..456 100644',
      '--- c/path/file.txt',
      '+++ w/path/file.txt',
      '@@ -1 +1 @@',
      '-old line',
      '+new line'
    ].join('\n');
    const result = parseChangedLines(diff);
    expect(result.size).toBe(1);
    expect(result.has('path/file.txt')).toBe(true);
    const changes = result.get('path/file.txt')!;
    expect(changes.removedLines.has(1)).toBe(true);
    expect(changes.addedLines.has(1)).toBe(true);
  });
});