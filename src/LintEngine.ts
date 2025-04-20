// file: src/LintEngine.ts
import * as os from 'os';
import { parseChangedLines, LineRange } from './DiffParser';
import * as path from 'path';
import Piscina from 'piscina';
import { verboseLog } from './logger';
import { LintDirective, ThenChangeDirective, IfChangeDirective } from './LintPrimitives';

interface PairDirective {
  file: string;
  ifLine: number;
  /** Optional label from the IfChange directive */
  ifLabel?: string;
  thenTarget: string;
  thenLine: number;
}

/**
 * Lints a unified diff against file directives and returns an exit code.
 *
 * @param diffText - The unified diff text to process.
 * @param concurrency - Maximum number of concurrent parsing tasks.
 * @returns Promise resolving to 0 if no lint errors, or 1 if errors were found.
 */
// File extensions to ignore when scanning for lint directives
const IGNORED_EXTENSIONS = new Set<string>(['.md', '.markdown']);
/**
 * Determine whether the given file path should be treated as a code file for lint directives.
 */
function isCodeFile(file: string): boolean {
  const ext = path.extname(file).toLowerCase();
  return !IGNORED_EXTENSIONS.has(ext);
}
/**
 * Lints a unified diff against file directives and returns an exit code.
 *
 * @param diffText - The unified diff text to process.
 * @param concurrency - Maximum number of concurrent parsing tasks.
 * @returns Promise resolving to 0 if no lint errors, or 1 if errors were found.
 */
export async function lintDiff(
  diffText: string,
  concurrency: number = os.cpus().length,
  verbose: boolean = false
): Promise<number> {
  const changesMap = parseChangedLines(diffText);
  // Only process lint directives in code files
  const changedFiles = Array.from(changesMap.keys()).filter(isCodeFile);
  const pairs: PairDirective[] = [];
  let errors = 0;

  // Step 1: Parse directives and build pairs using worker threads
  // Initialize a Piscina worker pool for parsing directives in parallel
  const workerScript = path.resolve(__dirname, '../dist/parserWorker.js');
  const pool = new Piscina({ filename: workerScript, maxThreads: concurrency });
  await Promise.all(changedFiles.map(async file => {
    if (verbose) verboseLog(`Processing changed file: ${file}`);
    const directives = (await pool.runTask(file)) as LintDirective[];
    const pendingIf: Array<{ line: number; label?: string }> = [];
    for (const d of directives) {
      if (d.kind === 'IfChange') {
        const ic = d as IfChangeDirective;
        pendingIf.push({ line: ic.line, label: ic.label });
      } else if (d.kind === 'ThenChange') {
        const pending = pendingIf.shift();
        if (pending) {
          const t = d as ThenChangeDirective;
          pairs.push({ file, ifLine: pending.line, ifLabel: pending.label, thenTarget: t.target, thenLine: d.line });
        }
      }
    }
    if (verbose) verboseLog(`Finished processing changed file: ${file}`);
  }));

  // Step 2: Parse label ranges for targets
  const labelRanges = new Map<string, Map<string, LineRange>>();
  // Determine unique target file paths (resolved relative to source file)
  const targetFiles = new Set<string>();
  pairs.forEach(p => {
    const [targetName] = p.thenTarget.split('#');
    const targetPath = path.isAbsolute(targetName)
      ? targetName
      : path.join(path.dirname(p.file), targetName);
    targetFiles.add(targetPath);
  });

  // Only parse label directives in code files
  const codeTargetFiles = Array.from(targetFiles).filter(isCodeFile);
  // Step 2: Parse label ranges for targets using the same Piscina pool
  await Promise.all(codeTargetFiles.map(async file => {
    if (verbose) verboseLog(`Processing target file: ${file}`);
    const directives = (await pool.runTask(file)) as LintDirective[];
    const ranges = new Map<string, LineRange>();
    const pending: { name: string; start: number }[] = [];
    directives.forEach(d => {
      if (d.kind === 'Label') {
        const labelDirective = d as import('./LintPrimitives').LabelDirective;
        pending.push({ name: labelDirective.name, start: d.line + 1 });
      } else if (d.kind === 'EndLabel') {
        const last = pending.pop();
        if (last) ranges.set(last.name, { startLine: last.start, endLine: d.line - 1 });
      }
    });
    labelRanges.set(file, ranges);
    if (verbose) verboseLog(`Finished processing target file: ${file}`);
  }));
  // Clean up the worker pool
  await pool.destroy();

  // Step 3: Validate pairs
  for (const p of pairs) {
    const changes = changesMap.get(p.file);
    if (!changes) continue;

    const triggered = changes.addedLines.has(p.ifLine) || changes.removedLines.has(p.ifLine);
    if (!triggered) continue;

    const parts = p.thenTarget.split('#');
    const targetName = parts[0];
    const label = parts[1];
    const targetFile = path.isAbsolute(targetName)
      ? targetName
      : path.join(path.dirname(p.file), targetName);
    const targetChanges = changesMap.get(targetFile);

    // Build context for error messages including optional IfChange label
    const ifContext = p.ifLabel
      ? `${p.file}#${p.ifLabel}:${p.ifLine}`
      : `${p.file}:${p.ifLine}`;
    if (!targetChanges) {
      console.log(
        `[ifttt] ${ifContext} -> ThenChange '${p.thenTarget}' (line ${p.thenLine}): ` +
        `target file '${targetFile}' not changed.`
      );
      errors++;
      continue;
    }

    if (label) {
      const ranges = labelRanges.get(targetFile);
      const availableLabels = ranges ? Array.from(ranges.keys()).join(', ') || 'none' : 'none';
      const range = ranges?.get(label);
      if (!range) {
        console.log(
          `[ifttt] ${ifContext} -> ThenChange '${p.thenTarget}' (line ${p.thenLine}): ` +
          `label '${label}' not found in '${targetFile}'. Available labels: ${availableLabels}`
        );
        errors++;
        continue;
      }
      // Check for changes within the labeled region
      const changesInRange = [
        ...Array.from(targetChanges.addedLines),
        ...Array.from(targetChanges.removedLines)
      ].filter(l => l >= range.startLine && l <= range.endLine);
      if (changesInRange.length === 0) {
        const allChanges = [...targetChanges.addedLines, ...targetChanges.removedLines].sort((a, b) => a - b);
        console.log(
          `[ifttt] ${ifContext} -> ThenChange '${p.thenTarget}' (line ${p.thenLine}): ` +
          `expected changes in '${targetFile}#${label}' (${range.startLine}-${range.endLine}), but none found. ` +
          `Actual changes in file: [${allChanges.join(', ')}]`
        );
        errors++;
      }
    } else {
      // Check for any changes in the target file
      const allChanges = [...targetChanges.addedLines, ...targetChanges.removedLines].sort((a, b) => a - b);
      if (allChanges.length === 0) {
        console.log(
          `[ifttt] ${ifContext} -> ThenChange '${p.thenTarget}' (line ${p.thenLine}): ` +
          `expected changes in '${targetFile}', but none found.`
        );
        errors++;
      }
    }
  }

  return errors > 0 ? 1 : 0;
}
