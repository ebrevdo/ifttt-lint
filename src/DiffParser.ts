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

// Use external parse-diff library, sanitizing input to avoid header parsing errors
import parseDiff from 'parse-diff';

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
  // Sanitize diff input: drop git diff headers and spurious '--- ' or '+++ ' lines not indicating actual file paths
  const filtered = diffText
    .split(/\r?\n/)
    .filter(line => {
      // drop main diff header lines
      if (line.startsWith('diff ')) return false;
      // drop spurious file-header-like lines: raw '--- ' not followed by a valid file path (e.g., prefix/ or /dev/null)
      if (/^--- /.test(line) && !/^--- [^ ]+\//.test(line)) return false;
      // drop spurious new-file-header-like lines: raw '+++ ' not followed by a valid file path (e.g., prefix/ or /dev/null)
      if (/^\+\+\+ /.test(line) && !/^\+\+\+ [^ ]+\//.test(line)) return false;
      return true;
    })
    .join('\n');
  const files = parseDiff(filtered);
  const result = new Map<string, FileChanges>();
  for (const file of files) {
    // Skip deleted files (diff to /dev/null)
    if (file.to === '/dev/null') {
      continue;
    }
    // Determine file path: prefer 'to' unless it's '/dev/null', else use 'from'
    let raw = file.to && file.to !== '/dev/null' ? file.to : file.from;
    // Skip binary files or files without valid paths
    if (!raw) {
      continue;
    }
    raw = raw.trim();
    // Strip surrounding quotes if present
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1);
    }
    // Decode C-style octal escapes (e.g., \360) to actual UTF-8 characters
    raw = ((): string => {
      const bytes: number[] = [];
      let i = 0;
      while (i < raw.length) {
        if (raw[i] === '\\') {
          let j = i + 1;
          let oct = '';
          // collect up to 3 octal digits
          while (j < raw.length && oct.length < 3 && /[0-7]/.test(raw[j])) {
            oct += raw[j];
            j++;
          }
          if (oct.length > 0) {
            bytes.push(parseInt(oct, 8));
            i = j;
            continue;
          }
          // not an octal escape, treat literal '\'
          bytes.push(raw.charCodeAt(i));
          i++;
        } else {
          // normal character: encode as UTF-8 bytes
          const buf = Buffer.from(raw[i], 'utf-8');
          for (const b of buf) bytes.push(b);
          i++;
        }
      }
      return Buffer.from(bytes).toString('utf-8');
    })();
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
