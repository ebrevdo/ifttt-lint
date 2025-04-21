import { runLint } from '../src/main';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

/**
 * Performance benchmark: generate many files in various languages with LINT directives
 * and measure runtime and CPU usage.
 */
// Increase timeout for performance benchmarks
jest.setTimeout(60000);
test('performance benchmark for multi-language linting', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'perf-'));
  const langs = ['ts', 'js', 'py', 'bzl', 'java', 'c', 'cpp', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'scala', 'sh'];
  const hashLangs = new Set(['py', 'bzl', 'rb', 'sh']);
  const totalFiles = 5000;
  const files: string[] = [];
  // Create files with LINT.IfChange/ThenChange pointing to itself
  for (let i = 0; i < totalFiles; i++) {
    const ext = langs[i % langs.length];
    const prefix = hashLangs.has(ext) ? '#' : '//';
    const filename = path.join(tmpDir, `file${i}.${ext}`);
    const base = path.basename(filename);
    const content_prefix = `${prefix} LINT.IfChange`;
    const interior_lines_100 = Array(100).fill(prefix);
    const content_suffix = `${prefix} LINT.ThenChange("${base}")`;
    const content = `${content_prefix}\n${interior_lines_100.join('\n')}\n${content_suffix}`;
    await fs.writeFile(filename, content);
    files.push(filename);
  }
  // Build a unified diff that changes each file's IfChange line
  const diffs: string[] = [];
  for (const file of files) {
    const ext = path.extname(file).slice(1);
    const prefix = hashLangs.has(ext) ? '#' : '//';
    const base = path.basename(file);
    diffs.push(`--- a/${file}`);
    diffs.push(`+++ b/${file}`);
    diffs.push('@@ -1,2 +1,2 @@');
    diffs.push(`-${prefix} LINT.IfChange`);
    diffs.push(`+${prefix} LINT.IfChange // changed`);
    diffs.push(`${prefix} LINT.ThenChange("${base}")`);
  }
  const diffText = diffs.join('\n');
  const concurrency = os.cpus().length * 10;
  // First, verify correctness
  const code = await runLint({ diffText }, concurrency, true);
  if (code !== 0) {
    console.error(`Benchmark lint failed with code ${code}`);
    process.exit(code);
  }
  // Measure performance
  const hrStart = process.hrtime();
  const cpuStart = process.cpuUsage();
  await runLint({ diffText }, concurrency);
  const hrDiff = process.hrtime(hrStart);
  const cpuDiff = process.cpuUsage(cpuStart);
  const elapsedSec = hrDiff[0] + hrDiff[1] / 1e9;
  const userMs = cpuDiff.user / 1000;
  const sysMs = cpuDiff.system / 1000;
  console.log(`Processed ${totalFiles} files in ${elapsedSec.toFixed(3)}s; CPU user ${userMs.toFixed(1)}ms sys ${sysMs.toFixed(1)}ms`);
});
