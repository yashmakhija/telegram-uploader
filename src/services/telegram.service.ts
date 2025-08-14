import { Telegraf } from "telegraf";
import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import { BotContext, TelegramFileInfo } from "../types/index.js";
import { PermissionService } from "./permission.service.js";
import logger from "../utils/logger.js";

export class TelegramService {
  private bot: Telegraf;
  private prisma: PrismaClient;
  private permissionService: PermissionService;
  private telegramApiUrl: string = "https://api.telegram.org";
  private channelId: string;
  private publicUrl: string;

  constructor(
    botToken: string,
    channelId: string,
    prisma: PrismaClient,
    publicUrl: string,
    port: number
  ) {
    this.bot = new Telegraf(botToken);
    this.prisma = prisma;
    this.permissionService = new PermissionService(prisma);
    this.channelId = channelId;
    this.publicUrl = publicUrl || `http://localhost:${port}`;

    this.setupBotHandlers();
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
    } catch (error) {
      logger.error("Error in help command:", { error });
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
          `Success! ${userName} now has upload permission.\n\nThey can now upload files to the bot.`
        );
      } else {
        ctx.reply(
          ` ${result.message}\n\nMake sure the user has started the bot with /start first.`
        );
      }
    } catch (error) {
      logger.error("Error in grant command:", { error });
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
    } catch (error) {
      logger.error("Error in revoke command:", { error });
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
    } catch (error) {
      logger.error("Error in list_users command:", { error });
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
          "You don't have permission to upload files. Please contact an administrator for access."
        );
      }

      const user = await this.getUserByTelegramId(telegramId);

      if (!user) {
        return ctx.reply("Please start the bot with /start first");
      }

      const file = ctx.message.document;
      await this.processFile(ctx, user.id, {
        fileId: file.file_id,
        fileName: file.file_name || "document",
        mimeType: file.mime_type || "application/octet-stream",
        fileSize: file.file_size,
      });
    } catch (error) {
      logger.error("Error handling file upload:", { error });
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
          "You don't have permission to upload files. Please contact an administrator for access."
        );
      }

      const user = await this.getUserByTelegramId(telegramId);

      if (!user) {
        return ctx.reply("Please start the bot with /start first");
      }

      // Get the highest quality photo
      const photo = ctx.message.photo[ctx.message.photo.length - 1];

      await this.processFile(ctx, user.id, {
        fileId: photo.file_id,
        fileName: "photo.jpg",
        mimeType: "image/jpeg",
        fileSize: photo.file_size,
      });
    } catch (error) {
      logger.error("Error handling photo upload:", { error });
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
          "You don't have permission to upload files. Please contact an administrator for access."
        );
      }

      const user = await this.getUserByTelegramId(telegramId);

      if (!user) {
        return ctx.reply("Please start the bot with /start first");
      }

      const video = ctx.message.video;

      await this.processFile(ctx, user.id, {
        fileId: video.file_id,
        fileName: video.file_name || "video.mp4",
        mimeType: video.mime_type || "video/mp4",
        fileSize: video.file_size,
      });
    } catch (error) {
      logger.error("Error handling video upload:", { error });
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
          "You don't have permission to upload files. Please contact an administrator for access."
        );
      }

      const user = await this.getUserByTelegramId(telegramId);

      if (!user) {
        return ctx.reply("Please start the bot with /start first");
      }

      const audio = ctx.message.audio;

      await this.processFile(ctx, user.id, {
        fileId: audio.file_id,
        fileName: audio.file_name || "audio.mp3",
        mimeType: audio.mime_type || "audio/mpeg",
        fileSize: audio.file_size,
      });
    } catch (error) {
      logger.error("Error handling audio upload:", { error });
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
      // Get file info from Telegram
      const fileInfo = await ctx.telegram.getFile(fileData.fileId);
      const telegramUrl = `${this.telegramApiUrl}/file/bot${
        (this.bot as any).token
      }/${fileInfo.file_path}`;

      // Forward to channel
      const message = await ctx.telegram.sendDocument(
        this.channelId,
        fileData.fileId,
        {
          caption: `File: ${fileData.fileName}\nSize: ${this.formatFileSize(
            fileData.fileSize
          )}\nType: ${fileData.mimeType}`,
        }
      );

      // Generate public URL
      const publicId = uuidv4();
      const publicUrl = `${this.publicUrl}/download/${publicId}`;

      // Store in database
      const uploadFile = await this.prisma.uploadFile.create({
        data: {
          userId: userId,
          telegramFileId: fileData.fileId,
          telegramUrl: telegramUrl,
          publicUrl: publicUrl,
          fileName: fileData.fileName,
          fileType: fileData.mimeType,
          fileSize: fileData.fileSize,
          channelId: this.channelId,
        },
      });

      ctx.reply(
        `File uploaded successfully!\n\n` +
          `File: ${fileData.fileName}\n` +
          `Size: ${this.formatFileSize(fileData.fileSize)}\n\n` +
          `Download link: ${publicUrl}`
      );
    } catch (error) {
      logger.error("Error processing file:", { error });
      throw error;
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
