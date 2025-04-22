/**
 * Jest configuration for tests
 * @type {import('@jest/types').Config.InitialOptions}
 */
export default {
  // Enable verbose test reporting and ensure console output is visible
  verbose: true,
  silent: false,
  cache: false,
  // Use ts-jest to transform TypeScript files
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  }
};