import { Router, type Request, type Response } from "express";
import { PrismaClient } from "@prisma/client";
import axios from "axios";
import { DownloadMetadata } from "../types/index.js";

export class DownloadRoutes {
  private router: Router;
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.router = Router();
    this.prisma = prisma;
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    // Get file download
    this.router.get("/:id", this.downloadFile.bind(this));

    // Get file info without downloading
    this.router.get("/:id/info", this.getFileInfo.bind(this));
  }

  private async downloadFile(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      // Find file by UUID in public URL
      const file = await this.prisma.uploadFile.findFirst({
        where: {
          publicUrl: { contains: id || "" },
        },
      });

      if (!file) {
        res.status(404).send("File not found");
        return;
      }

      // Log download
      await this.logDownload(file.id, req);

      // Proxy the request to Telegram
      const response = await axios({
        method: "get",
        url: file.telegramUrl,
        responseType: "stream",
      });

      // Set headers
      res.setHeader("Content-Type", file.fileType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${file.fileName}"`
      );
      res.setHeader("Content-Length", file.fileSize);

      // Pipe the file data
      response.data.pipe(res);
    } catch (error) {
      console.error("Download error:", error);
      res.status(500).send("An error occurred while downloading the file");
    }
  }

  private async getFileInfo(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      // Find file by UUID in public URL
      const file = await this.prisma.uploadFile.findFirst({
        where: {
          publicUrl: { contains: id || "" },
        },
        include: {
          downloads: {
            select: {
              id: true,
              createdAt: true,
            },
          },
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
      console.error("File info error:", error);
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
      console.error("Error logging download:", error);
      // Don't throw, just log the error
    }
  }

  public getRouter(): Router {
    return this.router;
  }
}
