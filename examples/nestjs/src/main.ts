import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function main(): Promise<void> {
    const app = await NestFactory.create(AppModule);
    await app.listen(Number(process.env.PORT ?? 3000));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
