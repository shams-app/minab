import { defineConfig } from 'vitest/config';

export default defineConfig({
    // The NestJS module uses parameter decorators (the legacy kind), which the transformer must be told about.
    oxc: { decorator: { legacy: true } },
    test: {
        include: ['test/**/*.test.ts'],
        exclude: ['node_modules', 'out'],
        // Each language test builds a parser. On a busy CI runner this takes 3-5 s,
        // so the default 5 s limit is too tight.
        testTimeout: 30_000,
        hookTimeout: 30_000
    }
});
