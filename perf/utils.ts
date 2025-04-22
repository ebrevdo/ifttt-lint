// Utility to generate a temp directory with many files containing LINT directives
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// Supported file extensions and which use hash-style comments
export const langs = [
  'ts', 'js', 'py', 'bzl', 'java', 'c', 'cpp', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'scala', 'sh'
];
export const hashLangs = new Set(['py', 'bzl', 'rb', 'sh']);

/**
 * Generates a temporary directory filled with files containing LINT.IfChange and LINT.ThenChange (self-targeting).
 * @param options.prefix Prefix for mkdtemp (defaults to 'perf-').
 * @param options.totalFiles Number of files to create (defaults to 5000).
 * @returns Object with tmpDir and array of file paths created.
 */
export async function generatePerfFiles(
  options?: { prefix?: string; totalFiles?: number }
): Promise<{ tmpDir: string; files: string[] }> {
  const prefix = options?.prefix ?? 'perf-';
  const totalFiles = options?.totalFiles ?? 5000;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const files: string[] = [];
  for (let i = 0; i < totalFiles; i++) {
    const ext = langs[i % langs.length];
    const prefixComment = hashLangs.has(ext) ? '#' : '//';
    const filename = path.join(tmpDir, `file${i}.${ext}`);
    const base = path.basename(filename);
    // Build file content: one IfChange, 100 filler lines, one ThenChange
    const lines: string[] = [];
    lines.push(`${prefixComment} LINT.IfChange`);
    for (let j = 0; j < 100; j++) {
      lines.push(prefixComment);
    }
    lines.push(`${prefixComment} LINT.ThenChange("${base}")`);
    await fs.writeFile(filename, lines.join('\n'), 'utf-8');
    files.push(filename);
  }
  return { tmpDir, files };
}