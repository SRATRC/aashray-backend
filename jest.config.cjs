module.exports = {
  transform: {
    '^.+\\.jsx?$': 'babel-jest',
  },
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageReporters: ["html"],
  globalSetup: './jest/globalSetup.js',
  globalTeardown: './jest/globalTeardown.js'
};
