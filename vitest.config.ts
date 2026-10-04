import { defineConfig } from 'vitest/config';

export default defineConfig({
    // The NestJS module uses parameter decorators (the legacy kind), which the transformer must be told about.
    oxc: { decorator: { legacy: true } },
    test: {
        include: ['test/**/*.test.ts'],
        exclude: ['node_modules', 'out']
    }
});
