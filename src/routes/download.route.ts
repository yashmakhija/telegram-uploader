import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import axios from "axios";
import { DownloadMetadata } from "../types/index.js";
import {
  generateSignedUrl,
  validateSignedUrl,
  createSignedRedirectUrl,
} from "../utils/signature.js";
import logger from "../utils/logger.js";
import { config } from "../config/index.js";
import { asyncHandler } from "../middleware/error.middleware.js";
import fs from "fs-extra";
import path from "path";

// Get the environment configuration
const tempDirectory = process.env.TEMP_DIRECTORY || "./temp";
const isProduction = process.env.NODE_ENV === "production";

export class DownloadRoutes {
  private router: Router;
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.router = Router();
    this.prisma = prisma;
    this.initializeRoutes();
  }

  public getRouter(): Router {
    return this.router;
  }

  private initializeRoutes(): void {
    // Legacy direct download (proxied through server)
    this.router.get("/:id/stream", asyncHandler(this.streamFile.bind(this)));

    // New direct download with redirect to Telegram CDN (recommended)
    this.router.get("/:id", asyncHandler(this.downloadFile.bind(this)));

    // Redirect endpoint that validates signatures and redirects to Telegram
    this.router.get(
      "/redirect/:fileId",
      asyncHandler(this.handleRedirect.bind(this))
    );

    // Direct Telegram file ID endpoint for convenience
    this.router.get(
      "/direct/:fileId",
      asyncHandler(this.directDownload.bind(this))
    );

    // MTProto download for large files
    this.router.get(
      "/mtproto/:id",
      asyncHandler(this.mtprotoDownload.bind(this))
    );

    // Get file info without downloading
    this.router.get("/:id/info", asyncHandler(this.getFileInfo.bind(this)));
  }

  /**
   * Handle file download with direct streaming
   */
  private async downloadFile(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    if (!id) {
      res.status(400).send("File ID is required");
      return;
    }

    // We'll use the streamFile method directly instead of redirecting
    return this.streamFile(req, res);
  }

  /**
   * Handle redirect to Telegram with signature validation
   */
  private async handleRedirect(req: Request, res: Response): Promise<void> {
    const { fileId } = req.params;
    const { expires, signature } = req.query;

    if (!fileId) {
      res.status(400).send("Missing file ID");
      return;
    }

    // If this is a direct Telegram file ID (starts with BQA, AAD, etc.)
    // Handle it directly without requiring signature
    if (
      fileId.startsWith("BQA") ||
      fileId.startsWith("AAD") ||
      fileId.startsWith("CQA")
    ) {
      try {
        // Get bot token from environment
        const botToken =
          (req.app.get("telegramBot") as any)?.token ||
          process.env.BOT_TOKEN ||
          config.telegram.botToken;

        if (!botToken) {
          res.status(500).send("Bot token not available");
          return;
        }

        // Get file info from Telegram
        const response = await axios.get(
          `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
        );

        if (response.data?.ok && response.data.result?.file_path) {
          const fileUrl = `https://api.telegram.org/file/bot${botToken}/${response.data.result.file_path}`;
          // Redirect directly to Telegram CDN
          res.redirect(fileUrl);
          return;
        } else {
          res.status(404).send("Telegram file not found or not accessible");
          return;
        }
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`Error handling direct file ID: ${errorMessage}`, {
          error,
        });
        res.status(500).send("Error retrieving file from Telegram");
        return;
      }
    }

    // Regular flow with signature validation
    if (!expires || !signature) {
      res.status(400).send("Missing required parameters");
      return;
    }

    // Ensure expires is a number
    const expiresNum = parseInt(expires as string, 10);
    if (isNaN(expiresNum)) {
      res.status(400).send("Invalid expires parameter");
      return;
    }

    // Get client IP for validation (only in production)
    const clientIp = isProduction ? req.ip || "" : undefined;

    // Simplified signature validation - no longer using URL
    const isValid = validateSignedUrl(
      fileId,
      expiresNum,
      signature as string,
      clientIp
    );

    if (!isValid) {
      res.status(403).send("Invalid or expired signature");
      return;
    }

    // Find the file in the database
    const file = await this.prisma.uploadFile.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      res.status(404).send("File not found");
      return;
    }

    try {
      // Get bot token from environment
      const botToken =
        (req.app.get("telegramBot") as any)?.token ||
        process.env.BOT_TOKEN ||
        config.telegram.botToken;

      if (!botToken) {
        res.status(500).send("Bot token not available");
        return;
      }

      // Get file path from Telegram
      const response = await axios.get(
        `https://api.telegram.org/bot${botToken}/getFile?file_id=${file.telegramFileId}`
      );

      if (response.data?.ok && response.data.result?.file_path) {
        // Create the file URL
        const fileUrl = `https://api.telegram.org/file/bot${botToken}/${response.data.result.file_path}`;

        // Set content disposition header
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${file.fileName}"`
        );

        // Redirect to the actual file
        res.redirect(fileUrl);
        return;
      } else {
        // Fallback to the stream endpoint
        res.redirect(`/download/${fileId}/stream`);
        return;
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Error processing redirect: ${errorMessage}`, {
        error,
        fileId,
      });
      res.status(500).send("Error retrieving file");
    }
  }

  /**
   * Direct download by Telegram file ID
   */
  private async directDownload(req: Request, res: Response): Promise<void> {
    const { fileId } = req.params;

    if (!fileId) {
      res.status(400).send("File ID is required");
      return;
    }

    try {
      // Get bot token from environment variables
      const botToken = process.env.BOT_TOKEN || config.telegram.botToken;

      if (!botToken) {
        logger.error("Bot token not available");
        res.status(500).send("Bot token not available");
        return;
      }

      logger.info(`Retrieving file by direct ID: ${fileId}`);

      try {
        // Get file info from Telegram
        const response = await axios.get(
          `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
        );

        if (response.data?.ok && response.data.result?.file_path) {
          const filePath = response.data.result.file_path;
          const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

          // Set reasonable default filename
          const fileName =
            response.data.result.file_path.split("/").pop() || "download";

          // Stream the file
          const fileStream = await axios({
            method: "get",
            url: fileUrl,
            responseType: "stream",
          });

          // Set headers
          res.setHeader("Content-Type", "application/octet-stream");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${fileName}"`
          );

          if (fileStream.headers["content-length"]) {
            res.setHeader(
              "Content-Length",
              fileStream.headers["content-length"]
            );
          }

          // Pipe the file data directly
          fileStream.data.pipe(res);
        } else {
          logger.error(
            `Failed to get direct file info: ${JSON.stringify(response.data)}`
          );
          res.status(404).send("Telegram file not found or not accessible");
        }
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`Failed to get direct file: ${errorMessage}`);
        res.status(404).send("Telegram file not found or not accessible");
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Error handling direct download: ${errorMessage}`, {
        error,
      });
      res.status(500).send("Error retrieving file from Telegram");
    }
  }

  /**
   * Legacy direct download (proxied through server)
   */
  private async streamFile(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).send("File ID is required");
        return;
      }

      // Try to find file by ID first, then by UUID in public URL if not found
      let file = await this.prisma.uploadFile.findUnique({
        where: { id },
      });

      if (!file) {
        // Try to find by UUID in public URL
        file = await this.prisma.uploadFile.findFirst({
          where: {
            publicUrl: { contains: id },
          },
        });
      }

      if (!file) {
        res.status(404).send("File not found");
        return;
      }

      await this.logDownload(file.id, req);

      // Check file size to determine download method
      // Telegram Bot API has a limit of approximately 20MB for downloads
      const MAX_BOT_DOWNLOAD_SIZE = 20 * 1024 * 1024; // 20MB

      if (file.fileSize > MAX_BOT_DOWNLOAD_SIZE) {
        // For large files, use the direct download URL approach
        // This uses the actual file path in the redirect
        logger.info(
          `File ${file.fileName} is large (${file.fileSize} bytes), using direct download approach`
        );

        // Get bot token from environment
        const botToken = process.env.BOT_TOKEN || config.telegram.botToken;

        if (!botToken) {
          logger.error("Bot token not available");
          res.status(500).send("Bot token not available");
          return;
        }

        try {
          // Set content disposition header
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${file.fileName}"`
          );

          // Set content type
          res.setHeader("Content-Type", file.fileType);

          // Include the file size if available
          if (file.fileSize) {
            res.setHeader("Content-Length", file.fileSize);
          }

          // Create a URL with instructions for the user
          res.write(`
            <html>
            <head>
              <title>Large File Download</title>
              <style>
                body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
                .container { max-width: 600px; margin: 0 auto; }
                h1 { color: #333; }
                .download-btn { 
                  display: inline-block;
                  background: #4CAF50;
                  color: white;
                  padding: 10px 20px;
                  text-decoration: none;
                  border-radius: 5px;
                  margin-top: 20px;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>Large File Download</h1>
                <p>The file "${
                  file.fileName
                }" is very large (${this.formatFileSize(
            file.fileSize
          )}) and cannot be downloaded through the bot API directly.</p>
                <p>Please use the Telegram app to download this file:</p>
                <ol>
                  <li>Open the Telegram app on your device</li>
                  <li>Visit the storage channel where files are uploaded</li>
                  <li>Find and download the file directly in Telegram</li>
                </ol>
                <p>Channel ID: ${file.channelId}</p>
                <p>File ID: ${file.telegramFileId}</p>
                <p>If you have admin access, you can try the MTProto download endpoint: <a href="/download/mtproto/${
                  file.id
                }" class="download-btn">Download with MTProto</a></p>
              </div>
            </body>
            </html>
          `);
          res.end();
          return;
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          logger.error(
            `Error generating large file instructions: ${errorMessage}`,
            { error }
          );
          res.status(500).send("Error preparing large file download");
          return;
        }
      }

      // For small files, continue with direct Bot API download
      logger.info(
        `File ${file.fileName} is small enough for Bot API download (${file.fileSize} bytes)`
      );

      // Get bot token from environment variables
      const botToken = process.env.BOT_TOKEN || config.telegram.botToken;

      if (!botToken) {
        logger.error("Bot token not available");
        res.status(500).send("Bot token not available");
        return;
      }

      try {
        logger.info(
          `Retrieving file ${file.fileName} with telegram file ID: ${file.telegramFileId}`,
          { fileId: file.id }
        );

        // First get file path using the direct API
        const fileInfoResponse = await axios.get(
          `https://api.telegram.org/bot${botToken}/getFile?file_id=${file.telegramFileId}`
        );

        if (
          !fileInfoResponse.data?.ok ||
          !fileInfoResponse.data?.result?.file_path
        ) {
          logger.error(
            `Failed to get file info: ${JSON.stringify(fileInfoResponse.data)}`,
            { fileId: file.id }
          );
          res.status(404).send("File not found on Telegram servers");
          return;
        }

        const filePath = fileInfoResponse.data.result.file_path;
        const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

        logger.info(`Streaming file ${file.fileName} from URL: ${fileUrl}`, {
          fileId: file.id,
        });

        // Stream the file
        const response = await axios({
          method: "get",
          url: fileUrl,
          responseType: "stream",
        });

        // Set headers
        res.setHeader("Content-Type", file.fileType);
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${file.fileName}"`
        );

        if (response.headers["content-length"]) {
          res.setHeader("Content-Length", response.headers["content-length"]);
        } else {
          res.setHeader("Content-Length", file.fileSize);
        }

        // Pipe the file data directly to the response
        response.data.pipe(res);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`Telegram API error: ${errorMessage}`, {
          error,
          fileId: file.id,
        });
        res.status(500).send("Error retrieving file from Telegram");
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Download error: ${errorMessage}`, { error });
      res.status(500).send("An error occurred while downloading the file");
    }
  }

  /**
   * Download large files via MTProto
   */
  private async mtprotoDownload(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).send("File ID is required");
        return;
      }

      // Try to find file by ID first, then by UUID in public URL if not found
      let file = await this.prisma.uploadFile.findUnique({
        where: { id },
      });

      if (!file) {
        // Try to find by UUID in public URL
        file = await this.prisma.uploadFile.findFirst({
          where: {
            publicUrl: { contains: id },
          },
        });
      }

      if (!file) {
        res.status(404).send("File not found");
        return;
      }

      await this.logDownload(file.id, req);

      // Get the MTProto service from Express app
      const mtprotoService = req.app.get("mtprotoService");

      if (!mtprotoService) {
        logger.error("MTProto service not available");
        res
          .status(500)
          .send("MTProto service not available for large file downloads");
        return;
      }

      try {
        // Set content disposition header
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${file.fileName}"`
        );

        // Set content type
        res.setHeader("Content-Type", file.fileType);

        // For large files, we'll display a message with instructions
        res.write(`
          <html>
          <head>
            <title>MTProto Large File Download</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
              .container { max-width: 600px; margin: 0 auto; }
              h1 { color: #333; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>MTProto Large File Download</h1>
              <p>We're preparing to download "${
                file.fileName
              }" (${this.formatFileSize(file.fileSize)}) via MTProto.</p>
              <p>To protect your Telegram account security, this feature is only available to admins.</p>
              <p>Please check the server logs for MTProto authentication status.</p>
              <p>File ID: ${file.telegramFileId}</p>
            </div>
          </body>
          </html>
        `);
        res.end();
        return;
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`Error handling MTProto download: ${errorMessage}`, {
          error,
        });
        res.status(500).send("Error with MTProto download service");
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`MTProto download error: ${errorMessage}`, { error });
      res.status(500).send("An error occurred with MTProto download");
    }
  }

  /**
   * Format file size in human-readable format
   */
  private formatFileSize(bytes: number): string {
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    if (bytes === 0) return "0 Byte";
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
  }

  private async getFileInfo(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).send("File ID is required");
        return;
      }

      // Find file by UUID in public URL
      const file = await this.prisma.uploadFile.findFirst({
        where: {
          publicUrl: { contains: id },
        },
        include: {
          downloads: true,
        },
      });

      if (!file) {
        res.status(404).send("File not found");
        return;
      }

      // Return file info
      res.json({
        fileName: file.fileName,
        fileType: file.fileType,
        fileSize: file.fileSize,
        downloadCount: file.downloads.length,
        uploadedAt: file.createdAt,
      });
    } catch (error) {
      logger.error("File info error:", { error });
      res
        .status(500)
        .send("An error occurred while retrieving file information");
    }
  }

  private async logDownload(fileId: string, req: Request): Promise<void> {
    try {
      const downloadData: DownloadMetadata = {
        fileId,
        ip: req.ip || "",
        userAgent: req.get("user-agent") || "",
        referer: req.get("referer") || "",
      };

      await this.prisma.download.create({
        data: downloadData,
      });
    } catch (error) {
      logger.error("Error logging download:", { error });
      // Don't throw, just log the error
    }
  }
}
