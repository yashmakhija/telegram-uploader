import { Telegraf } from "telegraf";
import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import { BotContext, TelegramFileInfo } from "../types/index.js";

export class TelegramService {
  private bot: Telegraf;
  private prisma: PrismaClient;
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

    // Help command
    this.bot.command("help", (ctx) => {
      ctx.reply(
        "Welcome to File Uploader Bot!\n\n" +
          "Commands:\n" +
          "/start - Register and start using the bot\n" +
          "/help - Show this help message\n\n" +
          "Simply send me any file, photo, video, or audio to upload it."
      );
    });

    // Unknown command handler
    this.bot.on("text", (ctx) => {
      ctx.reply("Please send me a file to upload. Type /help for assistance.");
    });
  }

  public async start(): Promise<void> {
    try {
      await this.bot.launch();
      console.log("Telegram bot started successfully");
    } catch (error) {
      console.error("Failed to start Telegram bot:", error);
      throw error;
    }
  }

  public stop(reason?: string): void {
    this.bot.stop(reason);
    console.log(`Telegram bot stopped: ${reason || "No reason provided"}`);
  }

  private async handleStart(ctx: any): Promise<void> {
    try {
      const telegramId = ctx.from.id.toString();
      const name = `${ctx.from.first_name} ${ctx.from.last_name || ""}`.trim();
      const username = ctx.from.username;
      const isBot = ctx.from.is_bot;

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

      ctx.reply(
        `Welcome to File Uploader Bot, ${name}!\n\n` +
          "Send me any file, photo, video, or audio to upload it.\n" +
          "I will provide you with a download link that you can share."
      );
    } catch (error) {
      console.error("Error in start command:", error);
      ctx.reply("An error occurred. Please try again later.");
    }
  }

  private async handleFileUpload(ctx: any): Promise<void> {
    try {
      const telegramId = ctx.from.id.toString();
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
      console.error("Error handling file upload:", error);
      ctx.reply(
        "An error occurred while uploading your file. Please try again later."
      );
    }
  }

  private async handlePhotoUpload(ctx: any): Promise<void> {
    try {
      const telegramId = ctx.from.id.toString();
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
      console.error("Error handling photo upload:", error);
      ctx.reply(
        "An error occurred while uploading your photo. Please try again later."
      );
    }
  }

  private async handleVideoUpload(ctx: any): Promise<void> {
    try {
      const telegramId = ctx.from.id.toString();
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
      console.error("Error handling video upload:", error);
      ctx.reply(
        "An error occurred while uploading your video. Please try again later."
      );
    }
  }

  private async handleAudioUpload(ctx: any): Promise<void> {
    try {
      const telegramId = ctx.from.id.toString();
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
      console.error("Error handling audio upload:", error);
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
      console.error("Error processing file:", error);
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
