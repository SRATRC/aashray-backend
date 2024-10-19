module.exports = {
  transform: {
    '^.+\\.jsx?$': 'babel-jest',
  },
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.js']
};