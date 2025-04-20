// file: src/DirectiveParser.ts
import * as fs from 'fs/promises';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: no type definitions for multilang-extract-comments
import extractComments from 'multilang-extract-comments';
import * as path from 'path';
import {
  LintDirective,
  IfChangeDirective,
  ThenChangeDirective,
  LabelDirective,
  EndLabelDirective
} from './LintPrimitives';

// Matches LINT.IfChange('label') or LINT.IfChange("label"), with optional whitespace
const ifChangeWithLabelRegex = /LINT\.IfChange\s*\(\s*['"]([^'"]+)['"]\s*\)/;
// Matches bare LINT.IfChange (no arguments), skipping labeled variants
const ifChangeRegex = /LINT\.IfChange\b(?!\s*\()/;
const thenChangeRegex = /LINT\.ThenChange\(['"]([^'"]+)['"]\)/;
const labelRegex = /LINT\.Label\(['"]([^'"]+)['"]\)/;
const endLabelRegex = /LINT\.EndLabel/;

/**
 * Parses lint directives from the specified file.
 *
 * @param filePath - Path to the file to parse directives from.
 * @returns Array of LintDirective objects found in the file.
 */
/**
 * Parses lint directives from comments in the specified file.
 * Only comment text (line comments, hash comments, or block comments) is scanned.
 */
/**
 * Parses lint directives from comments in the specified file.
 * Uses the extract-comments library to find comment blocks and line comments,
 * then scans each comment line for LINT directives.
 */
export async function parseFileDirectives(
  filePath: string
): Promise<LintDirective[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  // Use multi-language comment extractor to find all comments in source
  // Pass filename so extractor can choose comment syntax by extension
  let commentsMap: Record<string, { content?: string }>;
  try {
    commentsMap = extractComments(content, { filename: filePath });
  } catch {
    // Fallback for unsupported extensions (e.g., .bzl): remap to Python or JS
    const ext = path.extname(filePath).toLowerCase();
    let fallback: string;
    if (ext === '.bzl') {
      // Treat Bazel/Starlark files as Python for comment syntax (#)
      fallback = filePath.replace(/\.bzl$/i, '.py');
    } else {
      // Default to JavaScript
      fallback = filePath.replace(path.extname(filePath), '.js');
    }
    commentsMap = extractComments(content, { filename: fallback });
  }
  // commentsMap maps starting line numbers (as strings) to comment objects
  const directives: LintDirective[] = [];
  for (const [beginStr, comment] of Object.entries(commentsMap)) {
    const startLine = Number(beginStr);
    // comment.content is the inner text of the comment, possibly multi-line
    const lines = (comment.content ?? '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i];
      const lineNum = startLine + i;
      extractDirectives(text, lineNum, directives);
    }
  }
  return directives;
}

/**
 * Helper to test a comment text for any LINT directives and append to directives.
 */
function extractDirectives(
  text: string,
  lineNum: number,
  out: LintDirective[]
) {
  let m: RegExpExecArray | null;
  // IfChange with optional label
  if ((m = ifChangeWithLabelRegex.exec(text))) {
    out.push({ kind: 'IfChange', line: lineNum, label: m[1] } as IfChangeDirective);
  } else if (ifChangeRegex.test(text)) {
    out.push({ kind: 'IfChange', line: lineNum } as IfChangeDirective);
  }
  // ThenChange
  if ((m = thenChangeRegex.exec(text))) {
    out.push({ kind: 'ThenChange', line: lineNum, target: m[1] } as ThenChangeDirective);
  }
  // Label
  if ((m = labelRegex.exec(text))) {
    out.push({ kind: 'Label', line: lineNum, name: m[1] } as LabelDirective);
  }
  // EndLabel
  if (endLabelRegex.test(text)) {
    out.push({ kind: 'EndLabel', line: lineNum } as EndLabelDirective);
  }
}
