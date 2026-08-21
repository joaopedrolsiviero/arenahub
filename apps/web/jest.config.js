const nextJest = require('next/jest.js');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/'],
  // Also excludes .next/ from Jest's haste module crawl (distinct from
  // testPathIgnorePatterns above, which only filters test files). Without
  // this, running `test` concurrently with `build` can flake: Next rewrites
  // .next/ mid-build while Jest is crawling it.
  modulePathIgnorePatterns: ['<rootDir>/.next/'],
};

module.exports = createJestConfig(config);
