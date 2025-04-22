// Type declarations for parse-diff
// Provides minimal typing to satisfy TypeScript import
declare module 'parse-diff' {
  /**
   * Parsed change chunk in a diff file.
   */
  interface Change {
    /** Type of change: 'add' for additions, 'del' for deletions, other for context. */
    type: string;
    /** Content of the line, including prefix. */
    content: string;
  }
  /**
   * Parsed hunk (chunk) in a diff file.
   */
  interface Chunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    changes: Change[];
  }
  /**
   * Parsed file entry in a diff.
   */
  interface DiffFile {
    from: string;
    to: string;
    chunks: Chunk[];
  }
  /**
   * Parse a unified diff string into structured file changes.
   * @param input Unified diff text
   * @returns Array of parsed diff files
   */
  function parse(input: string): DiffFile[];
  export default parse;
}