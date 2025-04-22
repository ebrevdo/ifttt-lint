import { runLint } from '../src/main';
import * as os from 'os';
import * as path from 'path';
import { generatePerfFiles, hashLangs } from './utils';

/**
 * Performance benchmark: generate many files in various languages with LINT directives
 * and measure runtime and CPU usage.
 */
// Increase timeout for performance benchmarks
jest.setTimeout(60000);
test('performance benchmark for multi-language linting', async () => {
  // Generate a directory of files with LINT directives
  const { files } = await generatePerfFiles({ prefix: 'perf-' });
  // Build a unified diff changing each file's IfChange line
  const diffLines: string[] = [];
  for (const file of files) {
    const ext = path.extname(file).slice(1);
    const prefix = hashLangs.has(ext) ? '#' : '//';
    const base = path.basename(file);
    diffLines.push(`--- a/${file}`);
    diffLines.push(`+++ b/${file}`);
    diffLines.push('@@ -1,2 +1,2 @@');
    diffLines.push(`-${prefix} LINT.IfChange`);
    diffLines.push(`+${prefix} LINT.IfChange // changed`);
    diffLines.push(`${prefix} LINT.ThenChange("${base}")`);
  }
  const diffText = diffLines.join('\n');
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
  console.log(
    `Processed ${files.length} files in ${elapsedSec.toFixed(3)}s; ` +
    `CPU user ${userMs.toFixed(1)}ms sys ${sysMs.toFixed(1)}ms`
  );
});
