import express from "express";
import { PrismaClient } from "@prisma/client";
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
import { config } from "./config/index.js";

// Initialize Express app
const app = express();

console.log("Starting server with config:", {
  port: config.port,
  publicUrl: config.publicUrl,
  environment: config.environment,
});

// Initialize Prisma client
console.log("Initializing Prisma client...");
const prisma = new PrismaClient();

// Middleware
app.use(express.json());
app.use(cors());
app.use(morgan("dev"));
app.use(
  fileUpload({
    limits: { fileSize: config.upload.maxFileSize },
  })
);

// Health check endpoint - adding this first to ensure basic functionality
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Start server without requiring Telegram bot (safer startup)
async function startServer() {
  try {
    console.log("Setting up routes...");

    // Routes
    app.use("/download", new DownloadRoutes(prisma).getRouter());
    app.use(
      "/admin",
      new AdminRoutes(prisma, config.security.adminApiKey).getRouter()
    );

    // Error handling middleware
    app.use(notFoundHandler);
    app.use(errorHandler);

    // Start Express server
    app.listen(config.port, () => {
      console.log(
        `Server running on port ${config.port} in ${config.environment} mode`
      );
      console.log(`Public URL: ${config.publicUrl}`);
    });

    // Initialize Telegram bot service (after server is already running)
    try {
      console.log("Initializing Telegram service with:", {
        botToken: config.telegram.botToken ? "********" : "NOT SET",
        channelId: config.telegram.uploadChannelId,
      });

      const telegramService = new TelegramService(
        config.telegram.botToken,
        config.telegram.uploadChannelId,
        prisma,
        config.publicUrl,
        config.port
      );

      console.log("Starting Telegram bot...");
      await telegramService.start();
      console.log("Telegram bot started successfully");

      // Handle graceful shutdown
      process.once("SIGINT", () => {
        telegramService.stop("SIGINT");
        prisma.$disconnect();
        process.exit(0);
      });

      process.once("SIGTERM", () => {
        telegramService.stop("SIGTERM");
        prisma.$disconnect();
        process.exit(0);
      });
    } catch (telegramError) {
      console.error("Error starting Telegram bot:", telegramError);
      console.log(
        "Server will continue running without Telegram bot functionality"
      );
    }
  } catch (error) {
    console.error("Startup error:", error);
    process.exit(1);
  }
}

startServer();
