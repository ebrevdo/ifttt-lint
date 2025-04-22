import { runScan } from '../src/main';
import { generatePerfFiles } from './utils';
import * as os from 'os';

/**
 * Performance benchmark: test scan mode speed over many files with LINT directives.
 */
// Increase timeout for performance benchmarks
jest.setTimeout(60000);
test('performance benchmark for scan mode', async () => {
  // Generate files with LINT directives
  const { tmpDir, files } = await generatePerfFiles({ prefix: 'scan-' });
  // Determine parallelism (2x CPUs)
  const parallelism = os.cpus().length * 2;
  // Warm-up: verify no errors
  const warm = await runScan(tmpDir, parallelism, true);
  if (warm !== 0) {
    console.error(`Scan setup failed with code ${warm}`);
    process.exit(warm);
  }
  // Measure performance
  const hrStart = process.hrtime();
  const cpuStart = process.cpuUsage();
  await runScan(tmpDir, parallelism, false);
  const hrDiff = process.hrtime(hrStart);
  const cpuDiff = process.cpuUsage(cpuStart);
  const elapsed = hrDiff[0] + hrDiff[1] / 1e9;
  const userMs = cpuDiff.user / 1000;
  const sysMs = cpuDiff.system / 1000;
  console.log(
    `Scanned ${files.length} files in ${elapsed.toFixed(3)}s; ` +
    `CPU user ${userMs.toFixed(1)}ms sys ${sysMs.toFixed(1)}ms`
  );
});