import { PrismaClient, User } from "@prisma/client";
import logger from "../utils/logger.js";

export class PermissionService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async canUpload(telegramId: string): Promise<boolean> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { telegramId },
      });

      return !!user && (user.canUpload || user.isAdmin);
    } catch (error) {
      logger.error(`Error checking upload permission for user ${telegramId}`, {
        error,
      });
      return false;
    }
  }

  /**
   * Check if a user is an admin
   * @param telegramId The Telegram ID of the user
   * @returns Boolean indicating if the user is an admin
   */
  async isAdmin(telegramId: string): Promise<boolean> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { telegramId },
      });

      return !!user && user.isAdmin;
    } catch (error) {
      logger.error(`Error checking admin status for user ${telegramId}`, {
        error,
      });
      return false;
    }
  }

  /**
   * Grant upload permission to a user (admin only)
   * @param targetTelegramId The user to grant permission to
   * @param adminTelegramId The admin performing the action
   * @returns Result of the operation
   */
  async grantUploadPermission(
    targetTelegramId: string,
    adminTelegramId: string
  ): Promise<{
    success: boolean;
    message: string;
    user?: User;
  }> {
    try {
      // Verify the admin is actually an admin
      const isAdmin = await this.isAdmin(adminTelegramId);
      if (!isAdmin) {
        return { success: false, message: "You don't have admin privileges" };
      }

      // Check if the target user exists
      const targetUser = await this.prisma.user.findUnique({
        where: { telegramId: targetTelegramId },
      });

      if (!targetUser) {
        return {
          success: false,
          message:
            "User not found. They must start the bot before you can grant permissions",
        };
      }

      // Grant upload permission
      const updatedUser = await this.prisma.user.update({
        where: { telegramId: targetTelegramId },
        data: { canUpload: true },
      });

      return {
        success: true,
        message: "Upload permission granted successfully",
        user: updatedUser,
      };
    } catch (error) {
      logger.error(`Error granting upload permission to ${targetTelegramId}`, {
        error,
      });
      return { success: false, message: "Error updating permissions" };
    }
  }

  /**
   * Revoke upload permission from a user (admin only)
   * @param targetTelegramId The user to revoke permission from
   * @param adminTelegramId The admin performing the action
   * @returns Result of the operation
   */
  async revokeUploadPermission(
    targetTelegramId: string,
    adminTelegramId: string
  ): Promise<{
    success: boolean;
    message: string;
    user?: User;
  }> {
    try {
      // Verify the admin is actually an admin
      const isAdmin = await this.isAdmin(adminTelegramId);
      if (!isAdmin) {
        return { success: false, message: "You don't have admin privileges" };
      }

      // Check if the target user exists
      const targetUser = await this.prisma.user.findUnique({
        where: { telegramId: targetTelegramId },
      });

      if (!targetUser) {
        return { success: false, message: "User not found" };
      }

      // Don't allow revoking permissions from other admins
      if (targetUser.isAdmin) {
        return {
          success: false,
          message: "Cannot revoke permissions from an admin",
        };
      }

      // Revoke upload permission
      const updatedUser = await this.prisma.user.update({
        where: { telegramId: targetTelegramId },
        data: { canUpload: false },
      });

      return {
        success: true,
        message: "Upload permission revoked successfully",
        user: updatedUser,
      };
    } catch (error) {
      logger.error(
        `Error revoking upload permission from ${targetTelegramId}`,
        { error }
      );
      return { success: false, message: "Error updating permissions" };
    }
  }

  /**
   * List all users with upload permission
   * @param adminTelegramId The admin performing the action
   * @returns List of users with upload permission
   */
  async listUsersWithUploadPermission(adminTelegramId: string): Promise<{
    success: boolean;
    message: string;
    users?: User[];
  }> {
    try {
      // Verify the admin is actually an admin
      const isAdmin = await this.isAdmin(adminTelegramId);
      if (!isAdmin) {
        return { success: false, message: "You don't have admin privileges" };
      }

      // Get all users with upload permission
      const users = await this.prisma.user.findMany({
        where: {
          OR: [{ canUpload: true }, { isAdmin: true }],
        },
        orderBy: { name: "asc" },
      });

      return {
        success: true,
        message: `Found ${users.length} users with upload permission`,
        users,
      };
    } catch (error) {
      logger.error("Error listing users with upload permission", { error });
      return { success: false, message: "Error retrieving users" };
    }
  }
}
