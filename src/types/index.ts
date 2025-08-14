import type { User, UploadFile } from "@prisma/client";

/**
 * Extended context for Telegraf bot
 */
export interface BotContext {
  from: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    is_bot: boolean;
  };
  message: {
    document?: {
      file_id: string;
      file_name?: string;
      mime_type?: string;
      file_size: number;
    };
    photo?: Array<{
      file_id: string;
      file_size: number;
      width: number;
      height: number;
    }>;
    video?: {
      file_id: string;
      file_name?: string;
      mime_type?: string;
      file_size: number;
      width: number;
      height: number;
      duration: number;
    };
    audio?: {
      file_id: string;
      file_name?: string;
      mime_type?: string;
      file_size: number;
      duration: number;
    };
  };
}

/**
 * File information returned from Telegram
 */
export interface TelegramFileInfo {
  file_id: string;
  file_unique_id: string;
  file_size: number;
  file_path: string;
}

/**
 * Stats response for admin dashboard
 */
export interface StatsResponse {
  stats: {
    totalUsers: number;
    totalFiles: number;
    totalDownloads: number;
  };
  recentUploads: Array<UploadFile & { user: User }>;
}

/**
 * Download request metadata
 */
export interface DownloadMetadata {
  fileId: string;
  userId?: string;
  ip?: string;
  userAgent?: string;
  referer?: string;
}
