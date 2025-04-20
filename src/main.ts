#!/usr/bin/env node
// file: src/main.ts
import * as os from 'os';
import * as fs from 'fs/promises';
import { lintDiff } from './LintEngine';
import { parseChangedLines } from './DiffParser';
import { verboseLog } from './logger';

/**
 * Runs linting on a diff input and returns an exit code.
 *
 * @param diffInput - Object specifying diff input: filePath to read from, diffText directly, or stdin stream.
 * @param concurrency - Maximum number of concurrent tasks to use.
 * @returns Promise resolving to exit code: 0 if no lint errors, 1 if lint errors found.
 */
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
  verbose: boolean = false
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
    // Input text provided but no diff files detected
    const snippet = diffText.slice(0, 100).replace(/\r?\n/g, '\\n');
    throw new Error(`Invalid diff input: no file changes detected (snippet: "${snippet}...")`);
  }
  // Log parallelism to stderr for verbose output only
  if (verbose) {
    verboseLog(`Parallelism: ${parallelism}`);
  }
  const code = await lintDiff(diffText, parallelism, verbose);
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
  diffFile?: string;
  error?: string;
} {
  let warnMode = false;
  let showHelp = false;
  let verbose = false;
  let parallelism = -1;
  const positional: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--warn' || arg === '-w') {
      warnMode = true;
    } else if (arg === '--help' || arg === '-h') {
      showHelp = true;
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--parallelism' || arg === '-p') {
      const val = rawArgs[i+1];
      if (val === undefined) {
        return { warnMode, showHelp, verbose, parallelism, error: 'Missing value for --parallelism' };
      }
      const num = Number(val);
      if (!Number.isInteger(num) || num < 0) {
        return { warnMode, showHelp, verbose, parallelism, error: `Invalid parallelism value: ${val}` };
      }
      parallelism = num;
      i++;
    } else if (arg.startsWith('--parallelism=')) {
      const val = arg.split('=',2)[1];
      const num = Number(val);
      if (!Number.isInteger(num) || num < 0) {
        return { warnMode, showHelp, verbose, parallelism, error: `Invalid parallelism value: ${val}` };
      }
      parallelism = num;
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 1) {
    return { warnMode, showHelp, verbose, parallelism, error: 'Too many arguments' };
  }
  return { warnMode, showHelp, verbose, parallelism, diffFile: positional[0] };
}
// Execute when run as a CLI script
if (require.main === module) {
  // Parse CLI arguments
  const rawArgs = process.argv.slice(2);
  const { warnMode, showHelp, verbose, parallelism, diffFile, error } = parseCliArgs(rawArgs);
  const usage = [
    'Usage: ifttt-lint [options] [diffFile]',
    '',
    'Options:',
    '  -h, --help       Show this help message and exit',
    '  -w, --warn       Warn on lint errors but exit with code 0',
    '  -v, --verbose    Show verbose logging (files being processed)',
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
  // Determine default parallelism (number of CPU cores)
  const defaultParallelism = os.cpus().length;
  runLint(
    { filePath: diffFile, stdin: process.stdin },
    parallelism >= 0 ? parallelism : defaultParallelism,
    verbose
  )
    .then(code => {
      if (warnMode && code === 1) {
        // In warn mode, do not exit with error
        process.exit(0);
      }
      process.exit(code);
    })
    .catch(err => {
      // On real errors (e.g., filesystem issues), print full stack trace
      console.error(err.stack || err);
      process.exit(2);
    });
}
