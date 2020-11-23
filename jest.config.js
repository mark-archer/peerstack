// module.exports = {
//   verbose: true,
//   preset: 'jest-puppeteer',
//   testEnvironment: 'node',
//   setupFiles: [
//     '<rootDir>/node_modules/should',
//     '<rootDir>/node_modules/reflect-metadata',
//     '<rootDir>/jest.setup.js',
//   ],
//   testMatch: [
//     "<rootDir>/src/**/?(*.)+(test).ts",
//     "<rootDir>/src/**/?(*.)+(ext-test).ts",
//   ],
// };

// module.exports = {
//   // preset: 'jest-puppeteer',
//   preset: 'ts-jest-puppeteer',
// 	testMatch: ["**/?(*.)+(spec|test).[t]s"],
// 	testPathIgnorePatterns: ['/node_modules/', 'dist'], // 
// 	setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
// 	// transform: {
// 	// 	"^.+\\.ts?$": "ts-jest"
// 	// },
// 	// globalSetup: './jest.global-setup.ts', // will be called once before all tests are executed
// 	// globalTeardown: './jest.global-teardown.ts' // will be called once after all tests are executed
// };

module.exports = {
  testEnvironment: 'node',
  preset: './jest-preset.js',
	testMatch: ["**/?(*.)+(spec|test).[t]s"],
	testPathIgnorePatterns: ['/node_modules/', 'dist'], // 
	setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
	// transform: {
	// 	"^.+\\.ts?$": "ts-jest"
	// },
	// globalSetup: './jest.global-setup.ts', // will be called once before all tests are executed
	// globalTeardown: './jest.global-teardown.ts' // will be called once after all tests are executed
};
