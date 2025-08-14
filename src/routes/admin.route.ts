import { Router, Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { StatsResponse } from "../types/index.js";
import { PermissionService } from "../services/permission.service.js";
import logger from "../utils/logger.js";
import { asyncHandler } from "../middleware/error.middleware.js";

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
  private permissionService: PermissionService;

  constructor(prisma: PrismaClient, apiKey: string) {
    this.router = Router();
    this.prisma = prisma;
    this.apiKey = apiKey;
    this.permissionService = new PermissionService(prisma);
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    const auth = authenticateAdmin(this.apiKey);

    // Stats endpoints
    this.router.get("/stats", auth, asyncHandler(this.getStats.bind(this)));
    this.router.get("/users", auth, asyncHandler(this.getUsers.bind(this)));
    this.router.get("/files", auth, asyncHandler(this.getFiles.bind(this)));
    this.router.get(
      "/downloads",
      auth,
      asyncHandler(this.getDownloads.bind(this))
    );

    // Management endpoints
    this.router.delete(
      "/files/:id",
      auth,
      asyncHandler(this.deleteFile.bind(this))
    );
    this.router.put(
      "/users/:id/admin",
      auth,
      asyncHandler(this.setAdminStatus.bind(this))
    );

    // User permission endpoints
    this.router.put(
      "/users/:id/permission",
      auth,
      asyncHandler(this.setUploadPermission.bind(this))
    );
    this.router.get(
      "/users/permissions",
      auth,
      asyncHandler(this.getUsersWithPermission.bind(this))
    );
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
      logger.error("Stats error:", { error });
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
      logger.error("Users fetch error:", { error });
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
      logger.error("Files fetch error:", { error });
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
      logger.error("Downloads fetch error:", { error });
      res.status(500).json({ message: "Error retrieving downloads" });
    }
  }

  private async deleteFile(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({ message: "File ID is required" });
        return;
      }

      // First delete all downloads for this file
      await this.prisma.download.deleteMany({
        where: { fileId: id },
      });

      // Then delete the file
      await this.prisma.uploadFile.delete({
        where: { id },
      });

      res.json({ message: "File deleted successfully" });
    } catch (error) {
      logger.error("File deletion error:", { error });
      res.status(500).json({ message: "Error deleting file" });
    }
  }

  private async setAdminStatus(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { isAdmin } = req.body;

      if (!id) {
        res.status(400).json({ message: "User ID is required" });
        return;
      }

      if (typeof isAdmin !== "boolean") {
        res.status(400).json({ message: "isAdmin must be a boolean value" });
        return;
      }

      const user = await this.prisma.user.update({
        where: { id },
        data: { isAdmin },
      });

      res.json({
        message: `User ${isAdmin ? "promoted to admin" : "demoted from admin"}`,
        user,
      });
    } catch (error) {
      logger.error("Admin status update error:", { error });
      res.status(500).json({ message: "Error updating admin status" });
    }
  }

  private async setUploadPermission(
    req: Request,
    res: Response
  ): Promise<void> {
    try {
      const { id } = req.params;
      const { canUpload } = req.body;

      if (!id) {
        res.status(400).json({ message: "User ID is required" });
        return;
      }

      if (typeof canUpload !== "boolean") {
        res.status(400).json({ message: "canUpload must be a boolean value" });
        return;
      }

      const user = await this.prisma.user.findUnique({
        where: { id },
      });

      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      const updatedUser = await this.prisma.user.update({
        where: { id },
        data: {
          canUpload: canUpload,
        },
      });

      res.json({
        message: `Upload permission ${
          canUpload ? "granted to" : "revoked from"
        } user`,
        user: updatedUser,
      });
    } catch (error) {
      logger.error("Upload permission update error:", { error });
      res.status(500).json({ message: "Error updating upload permission" });
    }
  }

  private async getUsersWithPermission(
    req: Request,
    res: Response
  ): Promise<void> {
    try {
      const users = await this.prisma.user.findMany({
        where: {
          OR: [{ isAdmin: true }, { canUpload: true }],
        },
        orderBy: { name: "asc" },
      });

      res.json({
        users,
        count: users.length,
      });
    } catch (error) {
      logger.error("Error fetching users with permission:", { error });
      res
        .status(500)
        .json({ message: "Error retrieving users with permission" });
    }
  }

  public getRouter(): Router {
    return this.router;
  }
}
