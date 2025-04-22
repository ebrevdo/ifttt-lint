// file: src/DirectiveValidator.ts
import { LintDirective, IfChangeDirective, LabelDirective } from './LintPrimitives';
/**
 * Validates that within a single file, all named directives (IfChange labels and Label names)
 * are unique when considered in a single namespace.
 * @param directives Array of parsed directives from a file.
 * @param filePath Path to the file (used for error messages).
 * @param report Function to call for each validation error message.
 * @returns Number of validation errors found.
 */
export function validateDirectiveUniqueness(
  directives: LintDirective[],
  filePath: string,
  report: (msg: string) => void
): number {
  const seen = new Set<string>();
  let errors = 0;
  for (const d of directives) {
    if (d.kind === 'IfChange') {
      const ic = d as IfChangeDirective;
      if (ic.label) {
        if (seen.has(ic.label)) {
          report(
            `[ifttt] ${filePath}:${d.line} -> duplicate directive label '${ic.label}'`
          );
          errors++;
        } else {
          seen.add(ic.label);
        }
      }
    } else if (d.kind === 'Label') {
      const ld = d as LabelDirective;
      const name = ld.name;
      if (seen.has(name)) {
        report(
          `[ifttt] ${filePath}:${d.line} -> duplicate directive label '${name}'`
        );
        errors++;
      } else {
        seen.add(name);
      }
    }
  }
  return errors;
}