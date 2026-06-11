// file: src/DirectiveParser.ts
import * as fs from 'fs/promises';
// @ts-expect-error: no type definitions for multilang-extract-comments
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

type CommentsMap = Record<string, { content?: string }>;

// The comment extractor selects syntax by filename/extension. Rather than rely on
// every extension being recognized, we normalize unrecognized files to a small set
// of representative filenames whose comment syntax is known to be supported:
//   x.py   -> hash comments (#)
//   x.js   -> slash comments (//, /* */)
//   x.html -> HTML comments (<!-- -->)
const REP_HASH = 'x.py';
const REP_SLASH = 'x.js';
const REP_HTML = 'x.html';

/**
 * Maps a file path to a representative filename with a known comment syntax,
 * used when the extractor cannot recognize the file directly. Returns null when
 * we have no sensible default.
 */
function representativeFilename(filePath: string): string | null {
  const base = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  // Makefile family and other hash-comment files
  if (/^(gnu)?makefile$/i.test(base) || ext === '.mk' || ext === '.bzl') {
    return REP_HASH;
  }
  // Default to slash-comment syntax (preserves prior behavior for unknown types)
  return REP_SLASH;
}

/**
 * Runs the comment extractor for the given representative filename, returning
 * null instead of throwing when the content has no extractable comments.
 */
function tryExtract(content: string, filename: string): CommentsMap | null {
  try {
    return extractComments(content, { filename }) as CommentsMap;
  } catch {
    return null;
  }
}

/**
 * Parses lint directives from comments in the specified file.
 * Uses the extract-comments library to find comment blocks and line comments,
 * then scans each comment line for LINT directives.
 */
export async function parseFileDirectives(
  filePath: string
): Promise<LintDirective[]> {
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    // If path is a directory, skip without error
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === 'EISDIR'
    ) {
      return [];
    }
    // Propagate other errors (e.g., permission issues)
    throw err;
  }
  const ext = path.extname(filePath).toLowerCase();
  // Markdown uses HTML comment syntax (<!-- LINT.IfChange -->), which the
  // extractor doesn't recognize from the .md extension, so normalize it.
  if (ext === '.md' || ext === '.markdown') {
    const mdMap = tryExtract(content, REP_HTML);
    return mdMap ? directivesFromCommentsMap(mdMap, filePath) : [];
  }

  // Use multi-language comment extractor to find all comments in source.
  // Try the path as-is first (recognizes Makefile, *.py, *.html, etc.); if the
  // extractor can't determine the syntax, retry with a representative filename.
  let commentsMap = tryExtract(content, filePath);
  if (commentsMap === null) {
    const rep = representativeFilename(filePath);
    commentsMap = rep ? tryExtract(content, rep) : null;
  }
  if (commentsMap === null) {
    // Could not extract comments (e.g., JSON or unsupported extensions): ignore silently
    return [];
  }
  return directivesFromCommentsMap(commentsMap, filePath);
}

/**
 * Walks an extracted comment map and returns the LINT directives within it.
 */
function directivesFromCommentsMap(
  commentsMap: CommentsMap,
  filePath: string
): LintDirective[] {
  // commentsMap maps starting line numbers (as strings) to comment objects
  const directives: LintDirective[] = [];
  for (const [beginStr, comment] of Object.entries(commentsMap)) {
    const startLine = Number(beginStr);
    const lines = (comment.content ?? '').split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
      const text = lines[i];
      const lineNum = startLine + i;
      // Handle ThenChange directives, including multi-line array literals
      if (/^\s*LINT\.ThenChange\b/.test(text)) {
        // Collect directive lines until closing parenthesis
        let j = i;
        const directiveLines = [text];
        let hasClosing = text.includes(')');
        while (j + 1 < lines.length && !hasClosing) {
          j++;
          directiveLines.push(lines[j]);
          if (lines[j].includes(')')) {
            hasClosing = true;
          }
        }
        const directiveContent = directiveLines.join(' ');
        // Try parsing array literal: LINT.ThenChange([...])
        const arrayMatch = /\(\s*\[([^\]]*?)\]\s*,?\s*\)/.exec(directiveContent);
        if (arrayMatch) {
          const items = arrayMatch[1]
            .split(',')
            .map(s => s.trim())
            .filter(s => s.length > 0);
          for (const item of items) {
            const tgt = item.replace(/^['"]|['"]$/g, '');
            directives.push({ kind: 'ThenChange', line: lineNum, target: tgt } as ThenChangeDirective);
          }
        } else {
          // Fallback to single target literal: LINT.ThenChange('target')
          const singleMatch = /LINT\.ThenChange\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(directiveContent);
          if (singleMatch) {
            directives.push({ kind: 'ThenChange', line: lineNum, target: singleMatch[1] } as ThenChangeDirective);
          }
        }
        i = j + 1;
        continue;
      }
      // Default: parse any other directives (IfChange, Label, etc.)
      extractDirectives(text, lineNum, directives, filePath);
      i++;
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
  out: LintDirective[],
  filePath: string
) {
  let m: RegExpExecArray | null;
  let matched = false;
  // IfChange with optional label
  if ((m = ifChangeWithLabelRegex.exec(text))) {
    matched = true;
    out.push({ kind: 'IfChange', line: lineNum, label: m[1] } as IfChangeDirective);
  } else if (ifChangeRegex.test(text)) {
    matched = true;
    out.push({ kind: 'IfChange', line: lineNum } as IfChangeDirective);
  }
  // ThenChange with list of targets, e.g., LINT.ThenChange(['f1', 'f2#label'])
  let lm: RegExpExecArray | null;
  if ((lm = /^\s*LINT\.ThenChange\s*\(\s*\[([^\]]*)\]\s*\)/.exec(text))) {
    matched = true;
    const items = lm[1].split(',').map(s => s.trim()).filter(s => s.length > 0);
    for (const item of items) {
      const tgt = item.replace(/^['"]|['"]$/g, '');
      out.push({ kind: 'ThenChange', line: lineNum, target: tgt } as ThenChangeDirective);
    }
  }
  // ThenChange (strict match single target)
  else if ((m = thenChangeRegex.exec(text))) {
    matched = true;
    out.push({ kind: 'ThenChange', line: lineNum, target: m[1] } as ThenChangeDirective);
  }
  // Fallback: any LINT.ThenChange(...) with malformed quotes or other forms
  else if (/^\s*LINT\.ThenChange\(/.test(text)) {
    const mm = /LINT\.ThenChange\(([^)]*)\)/.exec(text);
    if (mm) {
      matched = true;
      let raw = mm[1].trim();
      raw = raw.replace(/^['"]|['"]$/g, '');
      out.push({ kind: 'ThenChange', line: lineNum, target: raw } as ThenChangeDirective);
    }
  }
  // Label
  if ((m = labelRegex.exec(text))) {
    matched = true;
    out.push({ kind: 'Label', line: lineNum, name: m[1] } as LabelDirective);
  }
  // EndLabel
  if (endLabelRegex.test(text)) {
    matched = true;
    out.push({ kind: 'EndLabel', line: lineNum } as EndLabelDirective);
  }
  // Handle malformed or unknown LINT.* directives
  if (!matched && /^\s*LINT\./.test(text)) {
    const trimmed = text.trim();
    if (/^\s*LINT\.ThenChange/.test(text)) {
      throw new Error(
        `Malformed LINT.ThenChange directive at ${filePath}:${lineNum}: expected LINT.ThenChange("target"), saw '${trimmed}'`
      );
    }
    if (/^\s*LINT\.IfChange/.test(text)) {
      throw new Error(
        `Malformed LINT.IfChange directive at ${filePath}:${lineNum}: expected LINT.IfChange or LINT.IfChange("label"), saw '${trimmed}'`
      );
    }
    if (/^\s*LINT\.Label/.test(text)) {
      throw new Error(
        `Malformed LINT.Label directive at ${filePath}:${lineNum}: expected LINT.Label("name"), saw '${trimmed}'`
      );
    }
    // Unrecognized directive
    const m2 = /^\s*LINT\.([A-Za-z0-9_]+)/.exec(text);
    const name = m2 ? m2[1] : 'LINT';
    throw new Error(
      `Unknown LINT directive '${name}' at ${filePath}:${lineNum}: '${text.trim()}'`
    );
  }
}
