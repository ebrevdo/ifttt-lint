/**
 * Jest configuration for performance benchmarks
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/perf'],
  testMatch: ['**/*.bench.ts'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
  detectOpenHandles: true,
};
