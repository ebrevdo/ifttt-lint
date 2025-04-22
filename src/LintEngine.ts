// file: src/LintEngine.ts
import * as os from 'os';
import { parseChangedLines, LineRange } from './DiffParser';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import Piscina from 'piscina';
import { verboseLog } from './logger';
import { LintDirective, ThenChangeDirective, IfChangeDirective } from './LintPrimitives';
import { validateDirectiveUniqueness } from './DirectiveValidator';

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
  verbose: boolean = false,
  ignoreList: string[] = []
): Promise<number> {
  // Glob matcher: convert simple * and ? patterns into regex
  function matchGlob(pattern: string, text: string): boolean {
    // Escape regex metacharacters in pattern, then translate '*' -> '.*' and '?' -> '.'
    const escapeRegex = (c: string) => c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    let re = '';
    for (const ch of pattern) {
      if (ch === '*') {
        re += '.*';
      } else if (ch === '?') {
        re += '.';
      } else {
        re += escapeRegex(ch);
      }
    }
    const rx = new RegExp('^' + re + '$');
    return rx.test(text);
  }
  // Prepare ignore patterns: entries like "file.ts", "*.json", or "file.ts#label"
  type IgnorePattern = { targetName: string; label?: string };
  const ignorePatterns: IgnorePattern[] = ignoreList.map(item => {
    const parts = item.split('#');
    return { targetName: parts[0], label: parts[1] };
  });
  const shouldIgnore = (target: string): boolean => {
    const [targetName, targetLabel] = target.split('#');
    return ignorePatterns.some(p =>
      matchGlob(p.targetName, targetName) &&
      (!p.label || p.label === targetLabel)
    );
  };
  const changesMap = parseChangedLines(diffText);
  // Only process lint directives in code files, excluding ignored files
  const allChanged = Array.from(changesMap.keys()).filter(isCodeFile);
  // Exclude ignored files based on user patterns
  const changedFiles = allChanged.filter(file => {
    // Ignore file-level patterns (no label), support glob on full path or basename
    const base = path.basename(file);
    const skip = ignorePatterns.some(p =>
      !p.label && (
        matchGlob(p.targetName, base) || matchGlob(p.targetName, file)
      )
    );
    if (skip && verbose) {
      verboseLog(`Skipping lint for ignored file: ${file}`);
    }
    return !skip;
  });
  const pairs: PairDirective[] = [];
  let errors = 0;

  // Step 1: Parse directives, enforce pairing of IfChange/ThenChange
  const workerScript = path.resolve(__dirname, '../dist/parserWorker.js');
  const pool = new Piscina({ filename: workerScript, maxThreads: concurrency });
  const orphanThen: Array<{ file: string; then: ThenChangeDirective }> = [];
  const orphanIf: Array<{ file: string; line: number; label?: string }> = [];
  // Cache parse promises for file directives (changed and target files)
  const directivesCache = new Map<string, Promise<LintDirective[]>>();
  await Promise.all(changedFiles.map(async file => {
    if (verbose) verboseLog(`Processing changed file: ${file}`);
    // Kick off parsing and cache promise for this file
    const parsePromise = pool.runTask(file) as Promise<LintDirective[]>;
    directivesCache.set(file, parsePromise);
    const directives = await parsePromise;
    // Validate duplicate directive labels within this file
    errors += validateDirectiveUniqueness(directives, file, msg => console.log(msg));
    let currentIf: { line: number; label?: string } | null = null;
    let sawThen = false;
    for (const d of directives) {
      if (d.kind === 'IfChange') {
        const ic = d as IfChangeDirective;
        currentIf = { line: ic.line, label: ic.label };
        sawThen = false;
      } else if (d.kind === 'ThenChange') {
        const tc = d as ThenChangeDirective;
        if (!currentIf) {
          orphanThen.push({ file, then: tc });
        } else {
          pairs.push({ file, ifLine: currentIf.line, ifLabel: currentIf.label, thenTarget: tc.target, thenLine: d.line });
          sawThen = true;
        }
      }
    }
    // IfChange without any ThenChange
    if (currentIf && !sawThen) {
      orphanIf.push({ file, line: currentIf.line, label: currentIf.label });
    }
    if (verbose) verboseLog(`Finished processing changed file: ${file}`);
  }));
  // Report orphan ThenChange directives, unless ignored
  for (const o of orphanThen) {
    const target = o.then.target;
    if (shouldIgnore(target)) {
      if (verbose) console.log(
        `[ifttt] Ignoring orphan ThenChange '${target}' in ${o.file}:${o.then.line}`
      );
      continue;
    }
    console.log(
      `[ifttt] ${o.file}:${o.then.line} -> unexpected ThenChange '${target}' without preceding IfChange`
    );
    errors++;
  }
  // Report orphan IfChange directives, unless ignored by file#label patterns
  for (const o of orphanIf) {
    // If this IfChange has a label and matches an ignore pattern, skip it
    if (o.label) {
      const base = path.basename(o.file);
      const skipIf = ignorePatterns.some(pat =>
        matchGlob(pat.targetName, base) && pat.label === o.label
      );
      if (skipIf) {
        if (verbose) verboseLog(
          `[ifttt] Ignoring orphan IfChange '${o.label}' in ${o.file}:${o.line}`
        );
        continue;
      }
    }
    const lbl = o.label ? `('${o.label}')` : '';
    console.log(
      `[ifttt] ${o.file}:${o.line} -> missing ThenChange after IfChange${lbl}`
    );
    errors++;
  }

  // Step 2: Check for orphan ThenChange directives (no preceding IfChange)
  for (const file of changedFiles) {
    // Await parsed directives for this file
    const directivesAll = await directivesCache.get(file)!;
    // Find ThenChange directives not in any pair
    for (const d of directivesAll) {
      if (d.kind === 'ThenChange') {
        const tc = d as ThenChangeDirective;
        const target = tc.target;
        const orphan = !pairs.some(p => p.file === file && p.thenLine === d.line);
        if (orphan) {
          if (shouldIgnore(target)) {
            if (verbose) console.log(
              `[ifttt] Ignoring orphan ThenChange '${target}' in ${file}:${d.line}`
            );
            continue;
          }
          // Resolve target file path
          const [targetName] = target.split('#');
          const targetFile = path.isAbsolute(targetName)
            ? targetName
            : path.join(path.dirname(file), targetName);
          console.log(
            `[ifttt] ${file}:${d.line} -> ThenChange '${target}' (line ${d.line}): ` +
            `target file '${targetFile}' not changed.`
          );
          errors++;
        }
      }
    }
  }
  // Step 3: Parse label ranges for targets
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
    // Ensure directives parsing promise exists for this file
    let parsePromise = directivesCache.get(file) as Promise<LintDirective[]> | undefined;
    if (!parsePromise) {
      parsePromise = pool.runTask(file) as Promise<LintDirective[]>;
      directivesCache.set(file, parsePromise);
    }
    let directives: LintDirective[];
    try {
      directives = await parsePromise;
      // Validate duplicate directive labels within target file
      errors += validateDirectiveUniqueness(directives, file, msg => console.log(msg));
    } catch {
      // Missing target file: report per corresponding ThenChange pragma, unless ignored
      for (const p of pairs) {
        const [targetName] = p.thenTarget.split('#');
        const targetPath = path.isAbsolute(targetName)
          ? targetName
          : path.join(path.dirname(p.file), targetName);
        if (targetPath === file) {
          const skipTarget = shouldIgnore(p.thenTarget);
          const skipLabel = p.ifLabel
            ? ignorePatterns.some(pat =>
                matchGlob(pat.targetName, path.basename(p.file)) && pat.label === p.ifLabel
              )
            : false;
          if (skipTarget || skipLabel) {
            if (verbose) verboseLog(
              `[ifttt] Ignoring ThenChange '${p.thenTarget}' for ${p.file}${p.ifLabel ? `#${p.ifLabel}:${p.ifLine}` : `:${p.ifLine}`}`
            );
            continue;
          }
          const ifContext = p.ifLabel
            ? `${p.file}#${p.ifLabel}:${p.ifLine}`
            : `${p.file}:${p.ifLine}`;
          console.log(
            `[ifttt] ${ifContext} -> ThenChange '${p.thenTarget}' (line ${p.thenLine}): ` +
            `target file '${file}' not found.`
          );
          errors++;
        }
      }
      return;
    }
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
    // Skip scenarios matching ignore patterns for labeled IfChange (file#label)
    if (p.ifLabel) {
      const fileBase = path.basename(p.file);
      const skipIf = ignorePatterns.some(pat =>
        matchGlob(pat.targetName, fileBase) && pat.label === p.ifLabel
      );
      if (skipIf) {
        if (verbose) verboseLog(
          `[ifttt] Ignoring IfChange '${p.ifLabel}' in ${p.file}:${p.ifLine}`
        );
        continue;
      }
    }
    // Skip scenarios matching ignore patterns for ThenChange target (targetName[#label])
    if (shouldIgnore(p.thenTarget)) {
      // ignored by user-specified patterns, skip validation
      continue;
    }
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
      // If the target file does not exist, skip error (already reported)
      let exists = true;
      try {
        await fsPromises.access(targetFile);
      } catch {
        exists = false;
      }
      if (!exists) {
        continue;
      }
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
