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
import parseDiff from 'parse-diff';

/**
 * Parses a unified diff text and returns a map from file paths to their changes.
 * Filters out 'diff ' header lines to avoid internal parsing errors in parse-diff.
 * @param diffText - The unified diff text to parse.
 * @returns A Map where each key is a file path and its value contains added and removed line numbers.
 */
export function parseChangedLines(diffText: string): Map<string, FileChanges> {
  // Remove lines starting with 'diff ' to prevent parse-diff from misparsing headers
  const filteredText = diffText
    .split(/\r?\n/)
    .filter(line => !line.startsWith('diff '))
    .join('\n');
  // Delegate to parse-diff
  const files = parseDiff(filteredText);
  const result = new Map<string, FileChanges>();
  for (const file of files) {
    // Determine file path: prefer 'to' unless it's '/dev/null', else use 'from'
    // Determine file path and strip single-character prefixes (e.g., 'a/', 'b/', 'w/', './')
    const rawPath = file.to && file.to !== '/dev/null' ? file.to : file.from;
    // If path begins with a single character and '/', drop the prefix
    const filePath = rawPath.length > 1 && rawPath[1] === '/'
      ? rawPath.slice(2)
      : rawPath;
    const added = new Set<number>();
    const removed = new Set<number>();
    // Iterate over chunks and changes
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

