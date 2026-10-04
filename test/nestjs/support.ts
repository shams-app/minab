import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import type { MinabSchema } from '../../src/language/schema.js';
import { MinabModule, MinabService, type MinabModuleOptions, type ProgramStore, type StoredProgram } from '../../src/nestjs/index.js';
import type { DataPort } from '../../src/runtime/index.js';

const scalar = (base: 'UUID' | 'DECIMAL' | 'TEXT') => ({
    kind: 'scalar' as const,
    type: { kind: 'scalar' as const, base, nullable: false, array: false, arrayNullable: false }
});

export function orderSchema(version: string, extraColumn?: string): MinabSchema & { version: string } {
    return {
        version,
        tables: [
            {
                name: 'Order',
                primaryKey: 'id',
                columns: [
                    { name: 'id', type: scalar('UUID') },
                    { name: 'total', type: scalar('DECIMAL') },
                    ...(extraColumn ? [{ name: extraColumn, type: scalar('TEXT') }] : [])
                ]
            }
        ]
    };
}

export const RULE_CONTEXT = { recordTable: 'Order', isFieldRule: false };

export function memoryStore(programs: StoredProgram[]): ProgramStore & { calls: number } {
    const store = {
        calls: 0,
        async get(id: string, version: string) {
            store.calls++;
            return programs.find(p => p.id === id && p.version === version);
        }
    };
    return store;
}

export function program(id: string, source: string, version = '1'): StoredProgram {
    return { id, version, source, languageVersion: '0.3', ruleContext: RULE_CONTEXT };
}

export function dataPort(rows: Record<string, unknown>[] = [{ value: true }]): DataPort & { calls: { text: string; params: unknown[] }[] } {
    const port = {
        calls: [] as { text: string; params: unknown[] }[],
        async execute(query: { text: string; params: unknown[] }) {
            port.calls.push({ text: query.text, params: query.params });
            return rows;
        }
    };
    return port as DataPort & { calls: { text: string; params: unknown[] }[] };
}

export async function boot(options: Partial<MinabModuleOptions> = {}): Promise<{ module: TestingModule; service: MinabService }> {
    const module = await Test.createTestingModule({
        imports: [MinabModule.forRoot({ schemaLoader: () => orderSchema('v1'), ruleContext: RULE_CONTEXT, ...options })]
    }).compile();
    return { module, service: module.get(MinabService) };
}
