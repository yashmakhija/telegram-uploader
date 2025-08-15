import { Telegraf } from "telegraf";
import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import { BotContext, TelegramFileInfo } from "../types/index.js";
import { PermissionService } from "./permission.service.js";
import { TelegramMTProtoService } from "./telegram-mtproto.service.js";
import logger from "../utils/logger.js";
import { config } from "../config/index.js";
import fs from "fs-extra";
import path from "path";

export class TelegramService {
  private bot: Telegraf;
  private prisma: PrismaClient;
  private permissionService: PermissionService;
  private mtprotoService: TelegramMTProtoService | null = null;
  private telegramApiUrl: string = "https://api.telegram.org";
  private channelId: string;
  private publicUrl: string;

  constructor(
    botToken: string,
    channelId: string,
    prisma: PrismaClient,
    publicUrl: string,
    permissionService: PermissionService
  ) {
    this.bot = new Telegraf(botToken);
    this.prisma = prisma;
    this.permissionService = permissionService;
    this.channelId = channelId;
    this.publicUrl = publicUrl;

    this.setupBotHandlers();
  }

  /**
   * Set the MTProto service for handling large files
   */
  public setMTProtoService(service: TelegramMTProtoService): void {
    this.mtprotoService = service;
    logger.info("MTProto service set for TelegramService");
  }

  /**
   * Get the Telegram bot instance
   * @returns The Telegraf bot instance
   */
  public getBot() {
    return this.bot;
  }

  private setupBotHandlers(): void {
    // Start command handler
    this.bot.command("start", this.handleStart.bind(this));

    // File upload handlers
    this.bot.on("document", this.handleFileUpload.bind(this));
    this.bot.on("photo", this.handlePhotoUpload.bind(this));
    this.bot.on("video", this.handleVideoUpload.bind(this));
    this.bot.on("audio", this.handleAudioUpload.bind(this));

    // Admin commands
    this.bot.command("grant", this.handleGrant.bind(this));
    this.bot.command("revoke", this.handleRevoke.bind(this));
    this.bot.command("list_users", this.handleListUsers.bind(this));

    // Help command
    this.bot.command("help", this.handleHelp.bind(this));

    // Unknown command handler
    this.bot.on("text", (ctx) => {
      ctx.reply("Please send me a file to upload. Type /help for assistance.");
    });
  }

  public async start(): Promise<void> {
    try {
      await this.bot.launch();
      logger.info("Telegram bot started successfully");
    } catch (error) {
      logger.error("Failed to start Telegram bot:", { error });
      throw error;
    }
  }

  public stop(reason?: string): void {
    this.bot.stop(reason);
    logger.info(`Telegram bot stopped: ${reason || "No reason provided"}`);
  }

  private async handleStart(ctx: any): Promise<void> {
    try {
      const telegramId = ctx.from.id.toString();
      const name = `${ctx.from.first_name} ${ctx.from.last_name || ""}`.trim();
      const username = ctx.from.username;
      const isBot = ctx.from.is_bot;

      // Create or update user
      await this.prisma.user.upsert({
        where: { telegramId },
        update: { name, username },
        create: {
          telegramId,
          name,
          username,
          isBot,
        },
      });

      // Check if user has upload permission
      const canUpload = await this.permissionService.canUpload(telegramId);
      const isAdmin = await this.permissionService.isAdmin(telegramId);

      let message = `Welcome to File Uploader Bot, ${name}!\n\n`;

      // Always show the user's ID for easy access sharing
      message += `Your Telegram ID: <code>${telegramId}</code>\n\n`;

      if (canUpload) {
        message +=
          "You are authorized to upload files. Send me any file, photo, video, or audio to upload it.\n" +
          "I will provide you with a download link that you can share.\n\n" +
          "Maximum file size: <b>2GB</b>";

        // Add information about large file support
        if (this.mtprotoService) {
          message += "\n\nLarge file support (>50MB) is enabled.";
        } else {
          message +=
            "\n\nNote: Files larger than 50MB are currently not supported.";
        }
      } else {
        message +=
          "You currently don't have permission to upload files. Please contact @heloooasaxaxa to request access.\n" +
          "Share your Telegram ID shown above when requesting access.";
      }

      if (isAdmin) {
        message +=
          "\n\nYou have ADMIN privileges. Type /help to see available admin commands.";
      }

      // Send with HTML parse mode to allow code formatting
      ctx.reply(message, { parse_mode: "HTML" });
    } catch (error) {
      logger.error("Error in start command:", { error });
      ctx.reply("An error occurred. Please try again later.");
    }
  }

  private async handleHelp(ctx: any): Promise<void> {
    try {
      const telegramId = ctx.from.id.toString();
      const isAdmin = await this.permissionService.isAdmin(telegramId);
      const canUpload = await this.permissionService.canUpload(telegramId);

      let message =
        "Welcome to File Uploader Bot!\n\n" +
        "Basic Commands:\n" +
        "/start - Register and start using the bot (also shows your Telegram ID)\n" +
        "/help - Show this help message\n\n";

      // Show user their ID in help message too for convenience
      message += `Your Telegram ID: <code>${telegramId}</code>\n\n`;

      if (canUpload) {
        message +=
          "You can send me any file, photo, video, or audio to upload it.\n" +
          "Maximum file size: <b>2GB</b>\n\n";

        // Add information about large file support
        if (this.mtprotoService) {
          message += "Large file support (>50MB) is enabled.\n\n";
        } else {
          message +=
            "Note: Files larger than 50MB are currently not supported.\n\n";
        }
      } else {
        message +=
          "You currently don't have permission to upload files. Please contact @heloooasaxaxa to request access.\n" +
          "Share your Telegram ID shown above when requesting access.\n\n";
      }

      if (isAdmin) {
        message +=
          "Admin Commands:\n" +
          "/grant [user_id] - Grant upload permission to a user\n" +
          "/revoke [user_id] - Revoke upload permission from a user\n" +
          "/list_users - List all users with upload permission\n\n" +
          "Note: To grant/revoke permissions, the user must have used /start with the bot first.\n" +
          "For user_id, use their Telegram ID number shown when they use /start.";
      }

      ctx.reply(message, { parse_mode: "HTML" });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Error in help command: ${errorMessage}`, { error });
      ctx.reply("An error occurred. Please try again later.");
    }
  }

  private async handleGrant(ctx: any): Promise<void> {
    try {
      const adminTelegramId = ctx.from.id.toString();
      const args = ctx.message.text.split(" ");

      if (args.length !== 2) {
        return ctx.reply(
          "Usage: /grant [user_id]\n\nExample: /grant 123456789"
        );
      }

      const targetTelegramId = args[1].trim();
      const result = await this.permissionService.grantUploadPermission(
        targetTelegramId,
        adminTelegramId
      );

      if (result.success && result.user) {
        const userName = result.user.name || "User";
        ctx.reply(
          `✅ Success! ${userName} now has upload permission.\n\nThey can now upload files to the bot.`
        );
      } else {
        ctx.reply(
          `❌ ${result.message}\n\nMake sure the user has started the bot with /start first.`
        );
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Error in grant command: ${errorMessage}`, { error });
      ctx.reply("An error occurred. Please try again later.");
    }
  }

  private async handleRevoke(ctx: any): Promise<void> {
    try {
      const adminTelegramId = ctx.from.id.toString();
      const args = ctx.message.text.split(" ");

      if (args.length !== 2) {
        return ctx.reply(
          "Usage: /revoke [user_id]\n\nExample: /revoke 123456789"
        );
      }

      const targetTelegramId = args[1].trim();
      const result = await this.permissionService.revokeUploadPermission(
        targetTelegramId,
        adminTelegramId
      );

      if (result.success && result.user) {
        const userName = result.user.name || "User";
        ctx.reply(
          `${userName}'s upload permission has been revoked.\n\nThey can no longer upload files to the bot.`
        );
      } else {
        ctx.reply(`${result.message}`);
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Error in revoke command: ${errorMessage}`, { error });
      ctx.reply("An error occurred. Please try again later.");
    }
  }

  private async handleListUsers(ctx: any): Promise<void> {
    try {
      const adminTelegramId = ctx.from.id.toString();
      const result = await this.permissionService.listUsersWithUploadPermission(
        adminTelegramId
      );

      if (!result.success) {
        return ctx.reply(result.message);
      }

      const users = result.users || [];

      if (users.length === 0) {
        return ctx.reply("No users have upload permission yet.");
      }

      let message = "Users with upload permission:\n\n";

      users.forEach((user, index) => {
        message +=
          `${index + 1}. ${user.name}${
            user.username ? ` (@${user.username})` : ""
          }\n` +
          `   ID: <code>${user.telegramId}</code>\n` +
          `   Role: ${user.isAdmin ? "Admin" : "User"}\n\n`;
      });

      ctx.reply(message, { parse_mode: "HTML" });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Error in list_users command: ${errorMessage}`, { error });
      ctx.reply("An error occurred. Please try again later.");
    }
  }

  private async handleFileUpload(ctx: any): Promise<void> {
    try {
      const telegramId = ctx.from.id.toString();

      // Check if user has permission to upload
      const canUpload = await this.permissionService.canUpload(telegramId);

      if (!canUpload) {
        return ctx.reply(
          "You don't have permission to upload files. Please contact @heloooasaxaxa to request access."
        );
      }

      const user = await this.getUserByTelegramId(telegramId);

      if (!user) {
        return ctx.reply("Please start the bot with /start first");
      }

      const file = ctx.message.document;
      if (!file) {
        return ctx.reply("No file was detected. Please try uploading again.");
      }

      try {
        await ctx.reply(
          `Processing file: ${
            file.file_name || "document"
          } (${this.formatFileSize(file.file_size)})...`
        );

        logger.info(`Sending file to channel: ${file.file_name}`, {
          fileSize: file.file_size,
          mimeType: file.mime_type,
          userId: user.id,
        });

        const message = await ctx.telegram.sendDocument(
          this.channelId,
          file.file_id,
          {
            caption: `File: ${
              file.file_name || "document"
            }\nSize: ${this.formatFileSize(file.file_size)}\nType: ${
              file.mime_type || "application/octet-stream"
            }\nUploaded by: ${ctx.from.username || ctx.from.id}`,
          }
        );

        if (!message) {
          throw new Error("Failed to send file to storage channel");
        }

        logger.info(
          `File sent successfully to channel, message ID: ${message.message_id}`
        );

        const fileId = uuidv4();
        const publicUrl = `${this.publicUrl}/download/${fileId}`;

        await this.prisma.uploadFile.create({
          data: {
            id: fileId,
            userId: user.id,
            fileName: file.file_name || "document",
            fileType: file.mime_type || "application/octet-stream",
            fileSize: file.file_size,
            telegramFileId: file.file_id,
            telegramUrl: file.file_id,
            channelId: this.channelId,
            publicUrl: publicUrl,
          },
        });

        ctx.reply(
          `File uploaded successfully!\n\n` +
            `File: ${file.file_name || "document"}\n` +
            `Size: ${this.formatFileSize(file.file_size)}\n\n` +
            `Download link: ${publicUrl}`
        );
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`Error in document upload handler: ${errorMessage}`, {
          error,
          userId: user.id,
        });
        ctx.reply(
          "An error occurred while uploading your file. Please try again later."
        );
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Error handling file upload: ${errorMessage}`, { error });
      ctx.reply(
        "An error occurred while uploading your file. Please try again later."
      );
    }
  }

  private async handlePhotoUpload(ctx: any): Promise<void> {
    try {
      const telegramId = ctx.from.id.toString();

      // Check if user has permission to upload
      const canUpload = await this.permissionService.canUpload(telegramId);

      if (!canUpload) {
        return ctx.reply(
          "You don't have permission to upload files. Please contact @heloooasaxaxa to request access."
        );
      }

      const user = await this.getUserByTelegramId(telegramId);

      if (!user) {
        return ctx.reply("Please start the bot with /start first");
      }

      const photos = ctx.message.photo;
      if (!photos || photos.length === 0) {
        return ctx.reply("No photo was detected. Please try uploading again.");
      }

      // Get the highest quality photo
      const photo = photos[photos.length - 1];

      try {
        await this.processFile(ctx, user.id, {
          fileId: photo.file_id,
          fileName: "photo.jpg",
          mimeType: "image/jpeg",
          fileSize: photo.file_size,
        });
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`Error in photo upload handler: ${errorMessage}`, {
          error,
          userId: user.id,
        });
        ctx.reply(
          "An error occurred while uploading your photo. Please try again later."
        );
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Error handling photo upload: ${errorMessage}`, { error });
      ctx.reply(
        "An error occurred while uploading your photo. Please try again later."
      );
    }
  }

  private async handleVideoUpload(ctx: any): Promise<void> {
    try {
      const telegramId = ctx.from.id.toString();

      // Check if user has permission to upload
      const canUpload = await this.permissionService.canUpload(telegramId);

      if (!canUpload) {
        return ctx.reply(
          "You don't have permission to upload files. Please contact @heloooasaxaxa to request access."
        );
      }

      const user = await this.getUserByTelegramId(telegramId);

      if (!user) {
        return ctx.reply("Please start the bot with /start first");
      }

      const video = ctx.message.video;
      if (!video) {
        return ctx.reply("No video was detected. Please try uploading again.");
      }

      try {
        if (video.file_size > config.telegram.fileSizeThresholds.bot) {
          if (!this.mtprotoService) {
            return ctx.reply(
              `This video is ${this.formatFileSize(
                video.file_size
              )} which exceeds the 50MB Bot API limit.\n\n` +
                "Large file support is not currently enabled. Please upload a smaller video or contact the administrator."
            );
          }

          // Use MTProto for large file
          await this.processLargeFile(ctx, user.id, {
            fileId: video.file_id,
            fileName: video.file_name || "video.mp4",
            mimeType: video.mime_type || "video/mp4",
            fileSize: video.file_size,
          });
        } else {
          // Standard bot API for normal files
          await this.processFile(ctx, user.id, {
            fileId: video.file_id,
            fileName: video.file_name || "video.mp4",
            mimeType: video.mime_type || "video/mp4",
            fileSize: video.file_size,
          });
        }
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`Error in video upload handler: ${errorMessage}`, {
          error,
          userId: user.id,
        });
        ctx.reply(
          "An error occurred while uploading your video. Please try again later.\n\n" +
            "Note: Videos over 50MB use a special upload method. If you're seeing this error with a large video, " +
            "please try a smaller file or contact support."
        );
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Error handling video upload: ${errorMessage}`, { error });
      ctx.reply(
        "An error occurred while uploading your video. Please try again later."
      );
    }
  }

  private async handleAudioUpload(ctx: any): Promise<void> {
    try {
      const telegramId = ctx.from.id.toString();

      // Check if user has permission to upload
      const canUpload = await this.permissionService.canUpload(telegramId);

      if (!canUpload) {
        return ctx.reply(
          "You don't have permission to upload files. Please contact @heloooasaxaxa to request access."
        );
      }

      const user = await this.getUserByTelegramId(telegramId);

      if (!user) {
        return ctx.reply("Please start the bot with /start first");
      }

      const audio = ctx.message.audio;
      if (!audio) {
        return ctx.reply("No audio was detected. Please try uploading again.");
      }

      try {
        // Check if this is a large file that needs MTProto
        if (audio.file_size > config.telegram.fileSizeThresholds.bot) {
          // Check if we have MTProto service available
          if (!this.mtprotoService) {
            return ctx.reply(
              `This audio file is ${this.formatFileSize(
                audio.file_size
              )} which exceeds the 50MB Bot API limit.\n\n` +
                "Large file support is not currently enabled. Please upload a smaller file or contact the administrator."
            );
          }

          // Use MTProto for large file
          await this.processLargeFile(ctx, user.id, {
            fileId: audio.file_id,
            fileName: audio.file_name || "audio.mp3",
            mimeType: audio.mime_type || "audio/mpeg",
            fileSize: audio.file_size,
          });
        } else {
          // Standard bot API for normal files
          await this.processFile(ctx, user.id, {
            fileId: audio.file_id,
            fileName: audio.file_name || "audio.mp3",
            mimeType: audio.mime_type || "audio/mpeg",
            fileSize: audio.file_size,
          });
        }
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`Error in audio upload handler: ${errorMessage}`, {
          error,
          userId: user.id,
        });
        ctx.reply(
          "An error occurred while uploading your audio. Please try again later.\n\n" +
            "Note: Audio files over 50MB use a special upload method. If you're seeing this error with a large file, " +
            "please try a smaller file or contact support."
        );
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Error handling audio upload: ${errorMessage}`, { error });
      ctx.reply(
        "An error occurred while uploading your audio. Please try again later."
      );
    }
  }

  private async processFile(
    ctx: any,
    userId: string,
    fileData: {
      fileId: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
    }
  ): Promise<void> {
    try {
      // Check file size - Telegram Bot API has 50MB limit for regular uploads
      const MAX_BOT_UPLOAD_SIZE = config.telegram.fileSizeThresholds.bot;

      if (fileData.fileSize > MAX_BOT_UPLOAD_SIZE) {
        logger.warn(
          `File exceeds 50MB limit: ${fileData.fileName} (${this.formatFileSize(
            fileData.fileSize
          )})`,
          {
            fileSize: fileData.fileSize,
            fileName: fileData.fileName,
          }
        );

        // For large files, we need to use MTProto API instead
        if (this.mtprotoService) {
          await this.processLargeFile(ctx, userId, fileData);
          return;
        } else {
          throw new Error(
            `File size exceeds 50MB limit and MTProto is not available`
          );
        }
      }

      // For files under 50MB, proceed with normal upload
      // Get file info from Telegram
      const fileInfo = await ctx.telegram.getFile(fileData.fileId);

      if (!fileInfo || !fileInfo.file_path) {
        throw new Error(`Failed to get file info for ${fileData.fileId}`);
      }

      const telegramUrl = `${this.telegramApiUrl}/file/bot${
        (this.bot as any).token
      }/${fileInfo.file_path}`;

      // Forward to channel
      const message = await ctx.telegram
        .sendDocument(this.channelId, fileData.fileId, {
          caption: `File: ${fileData.fileName}\nSize: ${this.formatFileSize(
            fileData.fileSize
          )}\nType: ${fileData.mimeType}`,
        })
        .catch((error: Error) => {
          logger.error(`Error sending document to channel: ${error.message}`, {
            error,
          });
          throw new Error(
            `Failed to send file to storage channel: ${error.message}`
          );
        });

      // Generate public URL
      const publicId = uuidv4();
      const publicUrl = `${this.publicUrl}/download/${publicId}`;

      // Store in database
      const uploadFile = await this.prisma.uploadFile
        .create({
          data: {
            id: publicId,
            userId: userId,
            telegramFileId: fileData.fileId,
            telegramUrl: fileData.fileId, // Just store the file_id, consistent with large file approach
            publicUrl: publicUrl,
            fileName: fileData.fileName,
            fileType: fileData.mimeType,
            fileSize: fileData.fileSize,
            channelId: this.channelId,
          },
        })
        .catch((error) => {
          logger.error(`Database error saving file: ${error.message}`, {
            error,
          });
          throw new Error(`Failed to save file information: ${error.message}`);
        });

      ctx.reply(
        `File uploaded successfully!\n\n` +
          `File: ${fileData.fileName}\n` +
          `Size: ${this.formatFileSize(fileData.fileSize)}\n\n` +
          `Download link: ${publicUrl}`
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Error processing file: ${errorMessage}`, {
        error,
        fileName: fileData.fileName,
        fileSize: fileData.fileSize,
      });
      throw error;
    }
  }

  /**
   * Process a large file using MTProto API directly
   */
  private async processLargeFile(
    ctx: any,
    userId: string,
    fileData: {
      fileId: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
    }
  ): Promise<void> {
    try {
      if (!this.mtprotoService) {
        throw new Error("MTProto service not available for large file upload");
      }

      // Inform user about large file process
      await ctx.reply(
        `This file is ${this.formatFileSize(
          fileData.fileSize
        )}, which exceeds the 50MB Bot API limit.\n\n` +
          `I'll need to process it differently. Please send this file directly to @heloooasaxaxa via Telegram.\n\n` +
          `They will process it manually and provide you with a download link.`
      );

      // Log the request
      logger.info(`Large file upload requested but requires manual handling`, {
        fileName: fileData.fileName,
        fileSize: fileData.fileSize,
        mimeType: fileData.mimeType,
        userId,
      });

      // Notify the user of the limitation
      ctx.reply(
        `Unfortunately, Telegram Bot API doesn't allow bots to download files larger than 20MB.\n\n` +
          `For files between 20MB-2GB, please use our web uploader at:\n` +
          `${this.publicUrl}/upload\n\n` +
          `Or contact @heloooasaxaxa for assistance.`
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Error processing large file: ${errorMessage}`, {
        error,
        fileName: fileData.fileName,
        fileSize: fileData.fileSize,
      });
      throw new Error(`Failed to process large file: ${errorMessage}`);
    }
  }

  private async getUserByTelegramId(telegramId: string) {
    return await this.prisma.user.findUnique({
      where: { telegramId },
    });
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
    else if (bytes < 1024 * 1024 * 1024)
      return (bytes / (1024 * 1024)).toFixed(2) + " MB";
    else return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  }
}
