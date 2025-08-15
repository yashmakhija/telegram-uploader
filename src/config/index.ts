import dotenv from "dotenv";

// Load environment variables
dotenv.config();

export const config = {
  // Server settings
  port: parseInt(process.env.PORT || "3000", 10),
  publicUrl:
    process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`,

  telegram: {
    botToken: process.env.BOT_TOKEN || "",
    uploadChannelId: process.env.UPLOAD_CHANNEL_ID || "",

    mtproto: {
      apiId: parseInt(process.env.TELEGRAM_API_ID || "0", 10),
      apiHash: process.env.TELEGRAM_API_HASH || "",
      phoneNumber: process.env.TELEGRAM_PHONE_NUMBER || "",
      largeMtprotoChannelId: process.env.LARGE_FILE_CHANNEL_ID || "",
      enabled: process.env.ENABLE_MTPROTO === "true",
    },

    // File size thresholds
    fileSizeThresholds: {
      bot: 50 * 1024 * 1024,
      mtproto: 2 * 1024 * 1024 * 1024,
    },
  },

  security: {
    adminApiKey: process.env.ADMIN_API_KEY || "",
    urlSignatureSecret:
      process.env.URL_SIGNATURE_SECRET ||
      "change-me-in-production-this-is-unsafe",
  },

  // Upload settings
  upload: {
    maxFileSize: 2 * 1024 * 1024 * 1024, // 2GB limit
    tempDirectory: process.env.TEMP_DIRECTORY || "./temp",
  },

  // Database settings
  database: {
    url: process.env.DATABASE_URL || "",
  },

  // Environment
  environment: process.env.NODE_ENV || "development",

  // Utility function to check if running in production
  isProduction: process.env.NODE_ENV === "production",
};
