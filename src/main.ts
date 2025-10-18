#!/usr/bin/env node
// file: src/main.ts
import * as os from 'os';
import * as fs from 'fs/promises';
import { lintDiff } from './LintEngine';
import { parseChangedLines } from './DiffParser';
import { verboseLog } from './logger';
import { Command, InvalidOptionArgumentError } from 'commander';
import { spawn } from 'child_process';
import { rgPath } from '@vscode/ripgrep';
import Piscina from 'piscina';
import * as path from 'path';
import { validateDirectiveUniqueness } from './DirectiveValidator';
import { LintDirective } from './LintPrimitives';

/**
 * Runs linting on a diff input and returns an exit code.
 *
 * @param diffInput - Object specifying diff input: filePath to read from, diffText directly, or stdin stream.
 * @param parallelism - Number of parallel tasks to use (>=1), or -1 to default to CPU cores.
 * @returns Promise resolving to exit code: 0 if no lint errors, 1 if lint errors found.
 */
export async function runLint(
  diffInput: { filePath?: string; diffText?: string; stdin?: NodeJS.ReadableStream },
  parallelism: number,
  verbose: boolean = false,
  /** Optional list of ignore patterns: file paths or file#label */
  ignoreList: string[] = []
): Promise<number> {
  let diffText: string;
  if (diffInput.filePath && diffInput.filePath !== '-') {
    diffText = await fs.readFile(diffInput.filePath, 'utf-8');
  } else if (diffInput.diffText !== undefined) {
    diffText = diffInput.diffText;
  } else if (diffInput.stdin) {
    diffText = await new Promise<string>((resolve, reject) => {
      let data = '';
      diffInput.stdin!.setEncoding('utf-8');
      diffInput.stdin!.on('data', (chunk: string) => { data += chunk; });
      diffInput.stdin!.on('end', () => resolve(data));
      diffInput.stdin!.on('error', err => reject(err));
    });
  } else {
    // No input provided in any form
    const details = `filePath=${diffInput.filePath ?? 'undefined'}, diffTextProvided=${diffInput.diffText !== undefined}, stdinProvided=${!!diffInput.stdin}`;
    throw new Error(`No diff input provided (${details})`);
  }

  // Validate diff input: non-empty text must yield at least one file change
  const changesMap = parseChangedLines(diffText);
  if (diffText.trim().length > 0 && changesMap.size === 0) {
    // Check if the diff contains any valid file operations (including deletions)
    // Look for diff headers that indicate file operations
    const hasValidFileOps = /^(---|diff --git|index [0-9a-f]+\.\.[0-9a-f]+)/m.test(diffText);
    if (!hasValidFileOps) {
      // Input text provided but no diff files detected
      const snippet = diffText.slice(0, 100).replace(/\r?\n/g, '\\n');
      throw new Error(`Invalid diff input: no file changes detected (snippet: "${snippet}...")`);
    }
  }
  // Log parallelism to stderr for verbose output only
  if (verbose) {
    verboseLog(`Parallelism: ${parallelism}`);
  }
  const code = await lintDiff(diffText, parallelism, verbose, ignoreList);
  return code;
}

/**
 * Parses CLI arguments for the tool.
 * @param rawArgs - Array of arguments (excluding node and script path)
 * @returns Parsed options and any error message.
 */
export function parseCliArgs(rawArgs: string[]): {
  warnMode: boolean;
  showHelp: boolean;
  verbose: boolean;
  parallelism: number;
  /** Optional ignore patterns (repeatable) */
  ignoreList: string[];
  diffFile?: string;
  scanDir?: string;
  error?: string;
} {
  // Default values
  let warnMode = false;
  let showHelp = false;
  let verbose = false;
  let parallelism = -1;
  const ignoreList: string[] = [];
  let diffFile: string | undefined;
  let scanDir: string | undefined;

  // Manual checks for missing values to match legacy behavior
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if ((arg === '--parallelism' || arg === '-p') && rawArgs[i + 1] === undefined) {
      return { warnMode, showHelp, verbose, parallelism, ignoreList, error: 'Missing value for --parallelism' };
    }
    if ((arg === '--ignore' || arg === '-i') && rawArgs[i + 1] === undefined) {
      return { warnMode, showHelp, verbose, parallelism, ignoreList, error: 'Missing value for --ignore' };
    }
    if ((arg === '--scan' || arg === '-s') && rawArgs[i + 1] === undefined) {
      return { warnMode, showHelp, verbose, parallelism, ignoreList, error: 'Missing value for --scan' };
    }
  }

  // Use commander to parse arguments
  const program = new Command();
  program
    .helpOption(false)
    .exitOverride();

  program
    .option('-w, --warn', 'Warn on lint errors but exit with code 0')
    .option('-h, --help', 'Show this help message and exit')
    .option('-v, --verbose', 'Show verbose logging (files being processed)')
    .option(
      '-p, --parallelism <number>',
      'Number of parallel tasks to use (>=0), or -1 to default to CPU cores',
      (val: string) => {
        const num = Number(val);
        if (!Number.isInteger(num) || num < 0) {
          throw new InvalidOptionArgumentError(`Invalid parallelism value: ${val}`);
        }
        return num;
      },
      -1
    )
    .option(
      '-i, --ignore <pattern>',
      'Ignore specified file or file#label during linting (repeatable)',
      (val: string, prev: string[]) => {
        prev.push(val);
        return prev;
      },
      [] as string[]
    )
    .option('-s, --scan <dir>', 'Scan given directory for LINT pragmas and perform validation')
    .argument('[diffFile]', "Diff file (or '-' or omitted to read from stdin)");

  let opts;
  try {
    program.parse(rawArgs, { from: 'user' });
    opts = program.opts();
  } catch (err: unknown) {
    if (err instanceof InvalidOptionArgumentError) {
      return { warnMode, showHelp, verbose, parallelism, ignoreList, error: err.message };
    }
    if (err instanceof Error) {
      return { warnMode, showHelp, verbose, parallelism, ignoreList, error: err.message };
    }
    return { warnMode, showHelp, verbose, parallelism, ignoreList, error: String(err) };
  }

  // Check for too many positional arguments
  const args = program.args;
  if (args.length > 1) {
    return { warnMode, showHelp, verbose, parallelism, ignoreList, error: 'Too many arguments' };
  }
  // Extract parsed values
  warnMode = !!opts.warn;
  showHelp = !!opts.help;
  verbose = !!opts.verbose;
  parallelism = opts.parallelism;
  ignoreList.push(...opts.ignore);
  diffFile = args[0];
  scanDir = opts.scan;

  return { warnMode, showHelp, verbose, parallelism, ignoreList, diffFile, scanDir };
}
/**
 * Scans a directory for files containing "LINT." and validates directive formatting in parallel.
 * Detects duplicate IfChange labels or Label names within a single file.
 * @param dir Directory path to scan.
 * @param parallelism Number of worker threads to use for parsing.
 * @param verbose Whether to enable verbose logging.
 * @returns Promise resolving to exit code: 0 if no errors, 1 if validation errors found.
 */
export async function runScan(dir: string, parallelism: number, verbose: boolean): Promise<number> {
  // Use ripgrep to find files containing any "LINT." pragmas
  // Use ripgrep binary from vscode-ripgrep package
  const rg = spawn(rgPath, ['--files-with-matches', 'LINT\\.', dir]);
  let stdout = '';
  let stderr = '';
  rg.stdout.on('data', data => { stdout += data.toString(); });
  rg.stderr.on('data', data => { stderr += data.toString(); });
  await new Promise<void>((resolve, reject) => {
    rg.on('error', err => reject(err));
    rg.on('close', code => {
      if (code !== 0 && code !== 1) {
        return reject(new Error(`ripgrep failed with code ${code}: ${stderr}`));
      }
      resolve();
    });
  });
  const files = stdout.split('\n').filter(f => f);
  if (files.length === 0) {
    if (verbose) verboseLog(`No files containing 'LINT.' found in ${dir}`);
    return 0;
  }
  // Create worker pool for parallel directive parsing
  const workerScript = path.resolve(__dirname, '../dist/parserWorker.js');
  const pool = new Piscina({ filename: workerScript, maxThreads: parallelism, recordTiming: false });
  let errors = 0;
  // Dispatch validation tasks in parallel
  const tasks = files.map(async file => {
    if (verbose) verboseLog(`Validating file: ${file}`);
    try {
      const directives = (await pool.runTask(file)) as LintDirective[];
      errors += validateDirectiveUniqueness(directives, file, msg => console.error(msg));
    } catch (err: unknown) {
      console.error(err instanceof Error ? err.message : err);
      errors++;
    }
  });
  await Promise.all(tasks);
  await pool.destroy();
  return errors > 0 ? 1 : 0;
}
// Execute when run as a CLI script
if (require.main === module) {
  // Parse CLI arguments
  const rawArgs = process.argv.slice(2);
  // Parse CLI arguments, including optional ignore patterns
  const { warnMode, showHelp, verbose, parallelism, ignoreList, diffFile, scanDir, error } = parseCliArgs(rawArgs);
  const usage = [
    'Usage: ifttt-lint [options] [diffFile]',
    '',
    'Options:',
    '  -h, --help       Show this help message and exit',
    '  -w, --warn       Warn on lint errors but exit with code 0',
    '  -v, --verbose    Show verbose logging (files being processed)',
    '  -i, --ignore     Ignore specified file or file#label during linting (repeatable)',
    '  -s, --scan <dir>  Scan given directory for LINT pragmas and perform validation',
    '',
    "If diffFile is '-' or omitted, input is read from stdin"
  ].join('\n');
  if (showHelp) {
    console.log(usage);
    process.exit(0);
  }
  if (error) {
    console.error(error);
    console.log(usage);
    process.exit(2);
  }
  if (scanDir) {
    // Determine parallelism for scan mode
    const scanParallelism = parallelism >= 0 ? parallelism : Math.max(os.cpus().length, 1);
    runScan(scanDir, scanParallelism, verbose)
      .then(code => process.exit(code))
      .catch(err => {
        console.error(err.stack || err);
        process.exit(2);
      });
  } else {
    // Determine default parallelism (number of CPU cores)
    const defaultParallelism = Math.max(os.cpus().length, 1);
    // Execute lint, passing through ignore patterns
    runLint(
      { filePath: diffFile, stdin: process.stdin },
      parallelism >= 0 ? parallelism : defaultParallelism,
      verbose,
      ignoreList
    )
      .then(code => {
        if (warnMode && code === 1) {
          process.exit(0);
        }
        process.exit(code);
      })
      .catch(err => {
        console.error(err.stack || err);
        process.exit(2);
      });
  }
}
