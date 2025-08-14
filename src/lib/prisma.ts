import { PrismaClient } from "@prisma/client";
import { config } from "../config/index.js";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: config.isProduction ? ["error"] : ["query", "error", "warn"],
  });

if (config.environment !== "production") globalForPrisma.prisma = prisma;

const handleShutdown = () => {
  console.log("Closing database connections...");
  prisma
    .$disconnect()
    .catch((e) =>
      console.error("Error during Prisma Client disconnection:", e)
    );
};

process.on("beforeExit", handleShutdown);
