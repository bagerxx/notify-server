import { PrismaClient } from '@prisma/client';

const globalKey = '__notifyPrismaClient';
const globalStore = globalThis;

const prisma = globalStore[globalKey] || new PrismaClient();
if (!globalStore[globalKey]) {
  globalStore[globalKey] = prisma;
}

export { prisma };
