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
  // Use multi-language comment extractor to find all comments in source
  // Pass filename so extractor can choose comment syntax by extension
  let commentsMap: Record<string, { content?: string }>;
  // Try extracting comments by file extension; if unsupported, fall back or warn
  try {
    commentsMap = extractComments(content, { filename: filePath });
  } catch {
    const ext = path.extname(filePath).toLowerCase();
    let fallback: string;
    if (ext === '.bzl') {
      // Treat Bazel/Starlark files as Python for comment syntax (#)
      fallback = filePath.replace(/\.bzl$/i, '.py');
    } else {
      // Default to JavaScript
      fallback = filePath.replace(path.extname(filePath), '.js');
    }
    try {
      commentsMap = extractComments(content, { filename: fallback });
    } catch {
      // Could not extract comments (e.g., JSON or unsupported extensions): ignore silently
      return [];
    }
  }
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
