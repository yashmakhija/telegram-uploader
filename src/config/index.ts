import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  publicUrl:
    process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`,

  telegram: {
    botToken: process.env.BOT_TOKEN || "",
    uploadChannelId: process.env.UPLOAD_CHANNEL_ID || "",
  },

  security: {
    adminApiKey: process.env.ADMIN_API_KEY || "",
  },

  upload: {
    maxFileSize: 2 * 1024 * 1024 * 1024, // 2GB limit
  },

  database: {
    url: process.env.DATABASE_URL || "",
  },

  environment: process.env.NODE_ENV || "development",

  isProduction: process.env.NODE_ENV === "production",
};
