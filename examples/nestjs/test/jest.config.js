module.exports = {
    rootDir: '..',
    testRegex: 'test/.*\\.e2e\\.ts$',
    transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
    testEnvironment: 'node',
    setupFiles: ['<rootDir>/test/env.ts'],
    testTimeout: 30000
};
