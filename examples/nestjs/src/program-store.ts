import { Inject, Injectable } from '@nestjs/common';
import type { ProgramStore, StoredProgram } from '@shamsine/minab/nestjs';
import { DataSource } from 'typeorm';

interface ProgramRow {
    id: string;
    version: string;
    source: string;
    language_version: string;
}

/** Reads stored programs from the table `minab_program`. The module caches the prepared programs by id and version. */
@Injectable()
export class DatabaseProgramStore implements ProgramStore {
    constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

    async get(id: string, version: string): Promise<StoredProgram | undefined> {
        const rows: ProgramRow[] = await this.dataSource.query(`SELECT id, version, source, language_version FROM minab_program WHERE id = $1 AND version = $2`, [id, version]);
        const row = rows[0];
        return row && { id: row.id, version: row.version, source: row.source, languageVersion: row.language_version };
    }
}
