const { defaults } = require('jest-config');
//module.exports = defaults;
module.exports = {
  verbose: true,
  moduleFileExtensions: [...defaults.moduleFileExtensions, 'ts', 'tsx'],
  // testPathIgnorePatterns: [
  //   '/node_modules/',
  //   '/scripts'
  // ],
  testMatch: [
    //'<rootDir>/build/tests/**/*.(js)'
    '<rootDir>/src/**/*.test.(ts|tsx)'
  ],
  transform: {
    '.(ts|tsx)': '<rootDir>/node_modules/ts-jest/preprocessor.js'
  },
}
