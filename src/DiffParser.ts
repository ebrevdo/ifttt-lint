// file: src/DiffParser.ts
// Parses unified diffs via the external parse-diff library (with header sanitization)

/**
 * Represents the added and removed line numbers for a file in a diff.
 */
export interface FileChanges {
  /** The file path for the changes. */
  file: string;
  /** Set of line numbers that were added in the diff. */
  addedLines: Set<number>;
  /** Set of line numbers that were removed in the diff. */
  removedLines: Set<number>;
}

/**
 * Inclusive range of line numbers in a target file label region.
 */
export interface LineRange {
  /** First line number of the range. */
  startLine: number;
  /** Last line number of the range. */
  endLine: number;
}

/**
 * Parses a unified diff text and returns a map from file paths to their changes.
 *
 * @param diffText - The unified diff text to parse.
 * @returns A Map where each key is a file path and its value contains added and removed lines.
 */
/**
 * Parses a unified diff text and returns a map from file paths to their changes.
 * Supports diffs with arbitrary src/dst prefixes (not just a/ and b/).
 * @param diffText - The unified diff text to parse.
 * @returns A Map where each key is a file path and its value contains added and removed line numbers.
 */
// Use external parse-diff library, sanitizing input to avoid header parsing errors
// Use CommonJS require for parse-diff to avoid TS import issues
 
const parseDiff = require('parse-diff');

/**
 * Parses a unified diff text and returns a map from file paths to their changes.
 * Filters out 'diff ' header lines to avoid internal parsing errors in parse-diff.
 * @param diffText - The unified diff text to parse.
 * @returns A Map where each key is a file path and its value contains added and removed line numbers.
 */
/**
 * Parses a unified diff text and returns a map from file paths to their changes.
 * Supports diffs with arbitrary src/dst prefixes (e.g., a/, b/).
 * @param diffText - The unified diff text to parse.
 * @returns A Map where each key is a file path and its value contains added and removed line numbers.
 */
export function parseChangedLines(diffText: string): Map<string, FileChanges> {
  // Remove 'diff ' headers to avoid parse-diff header misparsing
  const filtered = diffText
    .split(/\r?\n/)
    .filter(line => !line.startsWith('diff '))
    .join('\n');
  const files = parseDiff(filtered);
  const result = new Map<string, FileChanges>();
  for (const file of files) {
    // Skip deleted files (diff to /dev/null)
    if (file.to === '/dev/null') {
      continue;
    }
    // Determine file path: prefer 'to' unless it's '/dev/null', else use 'from'
    const raw = file.to && file.to !== '/dev/null' ? file.to : file.from;
    // Strip single-character prefix (e.g., 'a/', 'b/')
    const filePath = raw.length > 1 && raw[1] === '/' ? raw.slice(2) : raw;
    const added = new Set<number>();
    const removed = new Set<number>();
    // Iterate through hunks
    for (const chunk of file.chunks || []) {
      let oldLine = chunk.oldStart;
      let newLine = chunk.newStart;
      for (const change of chunk.changes || []) {
        if (change.type === 'add') {
          added.add(newLine++);
        } else if (change.type === 'del') {
          removed.add(oldLine++);
        } else {
          oldLine++;
          newLine++;
        }
      }
    }
    result.set(filePath, { file: filePath, addedLines: added, removedLines: removed });
  }
  return result;
}

