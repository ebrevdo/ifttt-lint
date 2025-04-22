/**
 * Jest configuration for performance benchmarks
 * @type {import('@jest/types').Config.InitialOptions}
 */
export default {
  testEnvironment: 'node',
  // Disable cache to avoid permission issues during performance tests
  cache: false,
  roots: ['<rootDir>/perf'],
  testMatch: ['**/*.bench.ts'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
  detectOpenHandles: true,
};
