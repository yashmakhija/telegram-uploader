import { Router, Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { StatsResponse } from "../types/index.js";

// Admin authentication middleware
const authenticateAdmin = (apiKey: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestApiKey = req.headers["x-api-key"];

    if (requestApiKey !== apiKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    next();
  };
};

export class AdminRoutes {
  private router: Router;
  private prisma: PrismaClient;
  private apiKey: string;

  constructor(prisma: PrismaClient, apiKey: string) {
    this.router = Router();
    this.prisma = prisma;
    this.apiKey = apiKey;
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    const auth = authenticateAdmin(this.apiKey);

    // Stats endpoints
    this.router.get("/stats", auth, this.getStats.bind(this));
    this.router.get("/users", auth, this.getUsers.bind(this));
    this.router.get("/files", auth, this.getFiles.bind(this));
    this.router.get("/downloads", auth, this.getDownloads.bind(this));

    // Management endpoints
    this.router.delete("/files/:id", auth, this.deleteFile.bind(this));
    this.router.put("/users/:id/admin", auth, this.setAdminStatus.bind(this));
  }

  private async getStats(req: Request, res: Response): Promise<void> {
    try {
      const totalUsers = await this.prisma.user.count();
      const totalFiles = await this.prisma.uploadFile.count();
      const totalDownloads = await this.prisma.download.count();

      const recentUploads = await this.prisma.uploadFile.findMany({
        take: 10,
        orderBy: { createdAt: "desc" },
        include: { user: true },
      });

      const response: StatsResponse = {
        stats: {
          totalUsers,
          totalFiles,
          totalDownloads,
        },
        recentUploads,
      };

      res.json(response);
    } catch (error) {
      console.error("Stats error:", error);
      res.status(500).json({ message: "Error retrieving stats" });
    }
  }

  private async getUsers(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const users = await this.prisma.user.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          _count: {
            select: {
              files: true,
              downloads: true,
            },
          },
        },
      });

      const total = await this.prisma.user.count();

      res.json({
        users,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error("Users fetch error:", error);
      res.status(500).json({ message: "Error retrieving users" });
    }
  }

  private async getFiles(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const files = await this.prisma.uploadFile.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: true,
          _count: {
            select: {
              downloads: true,
            },
          },
        },
      });

      const total = await this.prisma.uploadFile.count();

      res.json({
        files,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error("Files fetch error:", error);
      res.status(500).json({ message: "Error retrieving files" });
    }
  }

  private async getDownloads(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const downloads = await this.prisma.download.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          file: {
            include: {
              user: true,
            },
          },
        },
      });

      const total = await this.prisma.download.count();

      res.json({
        downloads,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error("Downloads fetch error:", error);
      res.status(500).json({ message: "Error retrieving downloads" });
    }
  }

  private async deleteFile(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      // First delete all downloads for this file
      await this.prisma.download.deleteMany({
        where: { fileId: id || "" },
      });

      // Then delete the file
      await this.prisma.uploadFile.delete({
        where: { id: id || "" },
      });

      res.json({ message: "File deleted successfully" });
    } catch (error) {
      console.error("File deletion error:", error);
      res.status(500).json({ message: "Error deleting file" });
    }
  }

  private async setAdminStatus(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { isAdmin } = req.body;

      if (typeof isAdmin !== "boolean") {
        res.status(400).json({ message: "isAdmin must be a boolean value" });
        return;
      }

      const user = await this.prisma.user.update({
        where: { id: id || "" },
        data: { isAdmin },
      });

      res.json({
        message: `User ${isAdmin ? "promoted to admin" : "demoted from admin"}`,
        user,
      });
    } catch (error) {
      console.error("Admin status update error:", error);
      res.status(500).json({ message: "Error updating admin status" });
    }
  }

  public getRouter(): Router {
    return this.router;
  }
}
