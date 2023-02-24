module.exports = {
  verbose: true,
  preset: 'ts-jest',
  testEnvironment: 'node',
  // setupFiles: [
  //   '<rootDir>/node_modules/should',
  //   '<rootDir>/node_modules/reflect-metadata',
  //   '<rootDir>/jest.setup.js',
  // ],
  testMatch: [
    "<rootDir>/src/**/?(*.)+(test).ts",
    "<rootDir>/src/**/?(*.)+(ext-test).ts",
  ],
};
