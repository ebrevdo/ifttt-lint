/**
 * Writes verbose messages directly to stderr, bypassing console.error spies.
 * @param message - The verbose message to log.
 */
export function verboseLog(message: string): void {
  // Write to stderr without using console.error so tests' spy on console.error won't catch it
  process.stderr.write(message + '\n');
}