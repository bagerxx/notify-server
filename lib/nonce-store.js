class NonceStore {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async init() {
    await this.prisma.$connect();
  }

  async close() {
    // Prisma client lifecycle is managed by the caller.
  }

  async consumeNonce(appId, nonce, now, expiresAt) {
    const nowDate = new Date(now);
    const expiresDate = new Date(expiresAt);

    await this.prisma.nonce.deleteMany({
      where: {
        expiresAt: { lte: nowDate },
      },
    });

    const result = await this.prisma.nonce.createMany({
      data: [
        {
          appId,
          nonce,
          createdAt: nowDate,
          expiresAt: expiresDate,
        },
      ],
      skipDuplicates: true,
    });

    return result.count > 0;
  }
}

export {
  NonceStore,
};
