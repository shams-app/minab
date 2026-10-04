import { Controller, Get, Inject, UseFilters } from '@nestjs/common';
import { MinabException, MinabExceptionFilter, MinabService } from '@shamsine/minab/nestjs';
import { queryFunctionDataPort } from '@shamsine/minab/node';
import { DataSource } from 'typeorm';

@Controller('reports')
@UseFilters(MinabExceptionFilter)
export class ReportsController {
    constructor(
        @Inject(DataSource) private readonly dataSource: DataSource,
        @Inject(MinabService) private readonly minab: MinabService
    ) {}

    /** Runs the stored query `top-customers` v1. A query has no transaction of its own: it reads with the connection pool. */
    @Get('top-customers')
    async topCustomers(): Promise<unknown> {
        const data = queryFunctionDataPort((text, params) => this.dataSource.query(text, params));
        const result = await this.minab.runStored('top-customers', '1', {}, { data });
        if (!result.ok) throw new MinabException(result.error);
        return result.value;
    }
}
