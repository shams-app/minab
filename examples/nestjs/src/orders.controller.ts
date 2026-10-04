import { BadRequestException, Body, Controller, HttpCode, Inject, Post, UnprocessableEntityException, UseFilters } from '@nestjs/common';
import { MinabException, MinabExceptionFilter, MinabService } from '@shamsine/minab/nestjs';
import { queryFunctionDataPort } from '@shamsine/minab/node';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

export const RULE_ID = 'order-limit';
/** The version of the stored rule to use. A new rule is a new version: set it here when you roll one out. */
export const RULE_VERSION_ENV = 'ORDER_LIMIT_VERSION';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOREIGN_KEY_VIOLATION = '23503';

interface NewOrder {
    customerId: string;
    total: string;
    status: string;
}

function parseOrder(body: unknown): NewOrder {
    const input = (body ?? {}) as Record<string, unknown>;
    if (typeof input.customerId !== 'string' || !UUID.test(input.customerId)) throw new BadRequestException('customerId must be a UUID');
    const total = typeof input.total === 'number' || typeof input.total === 'string' ? String(input.total) : '';
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(total)) throw new BadRequestException('total must be a positive amount with at most two decimals');
    const status = input.status === undefined ? 'open' : input.status;
    if (status !== 'open' && status !== 'closed' && status !== 'cancelled') throw new BadRequestException('status must be open, closed or cancelled');
    return { customerId: input.customerId, total, status };
}

@Controller('orders')
@UseFilters(MinabExceptionFilter)
export class OrdersController {
    private readonly ruleVersion = process.env[RULE_VERSION_ENV] ?? '1';

    constructor(
        @Inject(DataSource) private readonly dataSource: DataSource,
        @Inject(MinabService) private readonly minab: MinabService
    ) {}

    /**
     * Insert the order, then ask the stored rule if it is allowed, in the same transaction.
     * The rule reads the rows that this transaction wrote, so it counts the new order too.
     * `true`: commit. `false`: roll back, answer 422 with the rule id. A failed program also rolls back.
     */
    @Post('validate')
    @HttpCode(201)
    async validate(@Body() body: unknown): Promise<{ id: string; ok: true }> {
        const order = parseOrder(body);
        const id = randomUUID();
        const version = this.ruleVersion;
        const runner = this.dataSource.createQueryRunner();
        await runner.connect();
        await runner.startTransaction();
        try {
            try {
                await runner.query(`INSERT INTO "Order" (id, customer_id, status, total) VALUES ($1, $2, $3, $4)`, [id, order.customerId, order.status, order.total]);
            } catch (error) {
                if ((error as { code?: string }).code === FOREIGN_KEY_VIOLATION) throw new BadRequestException('unknown customer');
                throw error;
            }
            const data = queryFunctionDataPort((text, params) => runner.query(text, params));
            const record = { id, customer: order.customerId, status: order.status, total: order.total };
            const result = await this.minab.runStored(RULE_ID, version, { record }, { data });
            if (!result.ok) throw new MinabException(result.error);
            if (result.value !== true) {
                throw new UnprocessableEntityException({ ok: false, rule: { id: RULE_ID, version } });
            }
            await runner.commitTransaction();
            return { id, ok: true };
        } catch (error) {
            await runner.rollbackTransaction();
            throw error;
        } finally {
            await runner.release();
        }
    }
}
