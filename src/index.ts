import express from "express";
import cors from "cors";
import morgan from "morgan";
import fileUpload from "express-fileupload";
import { TelegramService } from "./services/telegram.service.js";
import { DownloadRoutes } from "./routes/download.route.js";
import { AdminRoutes } from "./routes/admin.route.js";
import {
  errorHandler,
  notFoundHandler,
} from "./middleware/error.middleware.js";
import { performanceMonitor } from "./middleware/performance.middleware.js";
import {
  securityHeaders,
  globalRateLimiter,
  apiRateLimiter,
  adminRateLimiter,
} from "./middleware/security.middleware.js";
import { config } from "./config/index.js";
import { prisma } from "./lib/prisma.js";
import logger from "./utils/logger.js";
import cluster from "cluster";
import os from "os";

// Initialize Express app
const app = express();

// Only log startup message from primary
if (cluster.isPrimary || !config.isProduction) {
  logger.info("Starting server with config:", {
    port: config.port,
    publicUrl: config.publicUrl,
    environment: config.environment,
    isProduction: config.isProduction,
    clustering: config.isProduction,
  });
}

// Production clustering
if (config.isProduction && cluster.isPrimary) {
  const numCPUs = os.cpus().length;

  logger.info(`Primary ${process.pid} is running`);
  logger.info(`Setting up ${numCPUs} workers...`);

  // Fork workers
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker, code, signal) => {
    logger.warn(
      `Worker ${worker.process.pid} died with code ${code} and signal ${signal}`
    );
    logger.info("Starting a new worker");
    cluster.fork();
  });
} else {
  // Worker or development process

  // Security middleware
  app.use(securityHeaders);

  // Performance monitoring
  app.use(performanceMonitor);

  // Basic middleware
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));
  app.use(cors());

  // Use winston logger instead of morgan in production
  if (config.isProduction) {
    app.use((req, res, next) => {
      logger.http(`${req.method} ${req.url}`, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });
      next();
    });
  } else {
    app.use(morgan("dev"));
  }

  // Rate limiting
  app.use(globalRateLimiter);

  // File upload middleware with size limits
  app.use(
    fileUpload({
      limits: { fileSize: config.upload.maxFileSize },
      abortOnLimit: true,
      useTempFiles: config.isProduction,
      tempFileDir: "/tmp/",
    })
  );

  // Health check endpoint - adding this first to ensure basic functionality
  app.get("/health", (req, res) => {
    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      environment: config.environment,
      pid: process.pid,
    });
  });

  // Setup API routes with rate limiting
  const downloadRouter = new DownloadRoutes(prisma).getRouter();
  const adminRouter = new AdminRoutes(
    prisma,
    config.security.adminApiKey
  ).getRouter();

  app.use("/download", apiRateLimiter, downloadRouter);
  app.use("/admin", adminRateLimiter, adminRouter);

  // Error handling middleware
  app.use(notFoundHandler);
  app.use(errorHandler);

  // Start server
  async function startServer() {
    try {
      // Start Express server
      const server = app.listen(config.port, () => {
        logger.info(
          `Server running on port ${config.port} in ${config.environment} mode`,
          {
            pid: process.pid,
            publicUrl: config.publicUrl,
          }
        );
      });

      // Add proper shutdown handling for HTTP server
      const gracefulShutdown = async (signal: string) => {
        logger.info(`${signal} received - shutting down gracefully`);

        server.close(() => {
          logger.info("HTTP server closed");
        });

        // Close database connections
        await prisma.$disconnect();

        // Force exit after timeout
        setTimeout(() => {
          logger.warn("Forcing shutdown after timeout");
          process.exit(1);
        }, 10000).unref();
      };

      // Initialize Telegram bot service (after server is already running)
      try {
        logger.info("Initializing Telegram service");

        const telegramService = new TelegramService(
          config.telegram.botToken,
          config.telegram.uploadChannelId,
          prisma,
          config.publicUrl,
          config.port
        );

        logger.info("Starting Telegram bot");
        await telegramService.start();
        logger.info("Telegram bot started successfully");

        // Add telegram to shutdown process
        ["SIGINT", "SIGTERM"].forEach((signal) => {
          process.once(signal, async () => {
            telegramService.stop(signal);
            await gracefulShutdown(signal);
          });
        });
      } catch (telegramError) {
        logger.error("Error starting Telegram bot", { error: telegramError });
        logger.info(
          "Server will continue running without Telegram bot functionality"
        );

        // Still set up graceful shutdown
        ["SIGINT", "SIGTERM"].forEach((signal) => {
          process.once(signal, async () => await gracefulShutdown(signal));
        });
      }
    } catch (error) {
      logger.error("Fatal startup error", { error });
      process.exit(1);
    }
  }

  startServer();
}
