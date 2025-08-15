import express from "express";
import cors from "cors";
import morgan from "morgan";
import fileUpload from "express-fileupload";
import { TelegramService } from "./services/telegram.service.js";
import { DownloadRoutes } from "./routes/download.route.js";
import { AdminRoutes } from "./routes/admin.route.js";
import { MTProtoAuthRoutes } from "./routes/mtproto-auth.route.js";
import {
  errorHandler,
  notFoundHandler,
} from "./middleware/error.middleware.js";
import { config } from "./config/index.js";
import { prisma } from "./lib/prisma.js";
import logger from "./utils/logger.js";
import cluster from "cluster";
import os from "os";
import fs from "fs-extra";
import path from "path";
import { TelegramMTProtoService } from "./services/telegram-mtproto.service.js";
import {
  securityHeaders,
  globalRateLimiter,
  apiRateLimiter,
  adminRateLimiter,
} from "./middleware/security.middleware.js";
import { performanceMonitor } from "./middleware/performance.middleware.js";
import { PermissionService } from "./services/permission.service.js";

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
    mtprotoEnabled: config.telegram.mtproto.enabled,
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

  // Ensure temp directory exists
  fs.ensureDirSync(path.resolve(process.cwd(), config.upload.tempDirectory));

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
      tempFileDir: config.upload.tempDirectory,
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

  // Start server
  async function startServer() {
    try {
      // Create services
      const prismaClient = prisma;
      const permissionService = new PermissionService(prismaClient);

      // Initialize Telegram service for file uploads
      let telegramService: TelegramService | null = null;
      try {
        logger.info("Initializing Telegram service");
        telegramService = new TelegramService(
          config.telegram.botToken,
          config.telegram.uploadChannelId,
          prismaClient,
          config.publicUrl,
          permissionService
        );

        // Store the bot instance in the Express app
        const bot = telegramService.getBot();
        app.set("telegramBot", bot);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`Error initializing Telegram service: ${errorMessage}`, {
          error,
        });
        process.exit(1);
      }

      let mtprotoService: TelegramMTProtoService | null = null;

      // Initialize MTProto service if enabled
      if (config.telegram.mtproto.enabled) {
        try {
          logger.info("Initializing MTProto service for large file uploads");
          mtprotoService = new TelegramMTProtoService(
            config.telegram.mtproto.apiId,
            config.telegram.mtproto.apiHash,
            config.telegram.mtproto.phoneNumber,
            config.telegram.mtproto.largeMtprotoChannelId,
            prismaClient,
            config.publicUrl
          );

          // Store MTProto service in Express app
          app.set("mtprotoService", mtprotoService);

          // Try to initialize MTProto, but don't fail if authentication is needed
          try {
            await mtprotoService.init();
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            logger.warn(
              `MTProto initialization failed: ${errorMessage}. Large file uploads will be disabled.`,
              { error }
            );
            // Don't set mtprotoService to null, we still need it for authentication
          }
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error creating MTProto service: ${errorMessage}`, {
            error,
          });
          mtprotoService = null;
          logger.warn(
            "Large file uploads will be disabled due to MTProto service creation failure"
          );
        }
      } else {
        logger.info(
          "MTProto service is disabled. Large file uploads will not be available."
        );
      }

      // Setup API routes with rate limiting
      const downloadRouter = new DownloadRoutes(prismaClient).getRouter();
      const adminRouter = new AdminRoutes(
        prismaClient,
        config.security.adminApiKey
      ).getRouter();

      app.use("/download", apiRateLimiter, downloadRouter);
      app.use("/admin", adminRateLimiter, adminRouter);

      // Debug registered routes - simpler logging to avoid Express typing complexity
      logger.info("Registered routes:", {
        paths: [
          { path: "/download/*", type: "Download routes" },
          { path: "/admin/*", type: "Admin routes" },
        ],
      });

      // Add MTProto auth routes if MTProto service is available (even if not authenticated)
      if (mtprotoService) {
        try {
          // Add MTProto auth routes (admin only)
          const mtprotoAuthRouter = new MTProtoAuthRoutes(
            mtprotoService,
            permissionService
          ).getRouter();

          app.use("/mtproto-auth", mtprotoAuthRouter);
          logger.info("MTProto auth routes registered at /mtproto-auth");

          // Set MTProto service in Telegram service
          if (telegramService) {
            telegramService.setMTProtoService(mtprotoService);
            logger.info("MTProto service connected to Telegram service");
          }
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          logger.warn(`MTProto routes setup failed: ${errorMessage}`, {
            error,
          });
        }
      }

      // Start Express server first
      const server = app.listen(config.port, () => {
        logger.info(
          `Server running on port ${config.port} in ${config.environment} mode`,
          {
            pid: process.pid,
            publicUrl: config.publicUrl,
            largeFileUploadsEnabled: !!mtprotoService,
          }
        );
      });

      // Then try to start Telegram bot, but continue if it fails
      try {
        // Start Telegram bot
        logger.info("Starting Telegram bot");
        await telegramService.start();
        logger.info("Telegram bot started successfully");

        // Store bot instance in app for download routes
        app.set("telegramBot", telegramService.getBot());
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`Failed to start Telegram bot: ${errorMessage}`, {
          error,
        });
        logger.warn(
          "Continuing without Telegram bot. API endpoints will still work, but bot functionality will be unavailable."
        );
      }

      // Error handling middleware
      app.use(notFoundHandler);
      app.use(errorHandler);

      // Add proper shutdown handling for HTTP server
      const gracefulShutdown = async (signal: string) => {
        logger.info(`${signal} received - shutting down gracefully`);

        server.close(() => {
          logger.info("HTTP server closed");
        });

        // Stop services
        telegramService.stop(signal);

        if (mtprotoService) {
          await mtprotoService.stop();
        }

        // Close database connections
        await prismaClient.$disconnect();

        // Force exit after timeout
        setTimeout(() => {
          logger.warn("Forcing shutdown after timeout");
          process.exit(1);
        }, 10000).unref();
      };

      // Set up graceful shutdown
      ["SIGINT", "SIGTERM"].forEach((signal) => {
        process.once(signal, async () => await gracefulShutdown(signal));
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Fatal startup error: ${errorMessage}`, { error });
      process.exit(1);
    }
  }

  startServer();
}
