import { parseFileDirectives } from './DirectiveParser';

/**
 * Worker task: parse lint directives from a file.
 * @param filePath Path to the source file.
 * @returns Array of parsed directives.
 */
export default async function parserWorker(filePath: string) {
  return await parseFileDirectives(filePath);
}