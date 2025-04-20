// file: src/LintPrimitives.ts
/**
 * The kinds of lint directives supported in source files.
 */
export type DirectiveKind = 'IfChange' | 'ThenChange' | 'Label' | 'EndLabel';

/**
 * Base properties for a lint directive.
 */
export interface BaseDirective {
  /** The directive kind. */
  kind: DirectiveKind;
  /** The 1-based line number where the directive appears. */
  line: number;
}

/**
 * Directive marking a line that triggers a conditional lint check.
 */
export interface IfChangeDirective extends BaseDirective {
  kind: 'IfChange';
  /** Optional label name associated with this change directive. */
  label?: string;
}

/**
 * Directive specifying a target file or labeled region that must also change.
 */
export interface ThenChangeDirective extends BaseDirective {
  kind: 'ThenChange';
  /** The target file path, optionally with `#label` to specify a labeled region. */
  target: string;
}

/**
 * Directive marking the start of a labeled region in a file.
 */
export interface LabelDirective extends BaseDirective {
  kind: 'Label';
  /** The name of the label. */
  name: string;
}

/**
 * Directive marking the end of the most recent labeled region.
 */
export interface EndLabelDirective extends BaseDirective {
  kind: 'EndLabel';
}

export type LintDirective =
  | IfChangeDirective
  | ThenChangeDirective
  | LabelDirective
  | EndLabelDirective;
