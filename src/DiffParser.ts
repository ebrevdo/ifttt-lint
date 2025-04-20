// file: src/DiffParser.ts
import parseDiff, { File as DiffFile } from 'parse-diff';

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
export function parseChangedLines(
  diffText: string
): Map<string, FileChanges> {
  const files: DiffFile[] = parseDiff(diffText);
  const result = new Map<string, FileChanges>();

  for (const file of files) {
    // Determine file path: prefer "to" unless it's a deletion (/dev/null), ensure non-null strings
    const filePath = (file.to && file.to !== '/dev/null')
      ? file.to
      : file.from!;
    const added = new Set<number>();
    const removed = new Set<number>();

    for (const chunk of file.chunks) {
      let oldLine = chunk.oldStart;
      let newLine = chunk.newStart;

      for (const change of chunk.changes) {
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
