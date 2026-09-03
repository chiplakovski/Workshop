import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Thin infrastructure wrapper around the generated Prisma Client. No business logic lives
 * here — see Phase 0A scope item D. Business modules inject this service and call the
 * generated model delegates directly.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set. Copy backend/.env.example to backend/.env and fill it in.');
    }
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to the database.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
