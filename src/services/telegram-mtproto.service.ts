// Import for node environment as specified in the docs with explicit file path
// https://mtproto-core.js.org/docs/
import MTProtoModule from "@mtproto/core/envs/node/index.js";
import fs from "fs-extra";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { PrismaClient } from "@prisma/client";
import { config } from "../config/index.js";
import logger from "../utils/logger.js";

/**
 * Authentication status type
 */
interface AuthStatus {
  authorized: boolean;
  user?: {
    id: number;
    first_name?: string;
    username?: string;
    phone?: string;
  };
  phoneCodeHash?: string;
  phoneCodeRequired?: boolean;
  phoneNumber?: string;
}

/**
 * Service for handling Telegram MTProto API operations
 * Used for large file uploads that exceed the Bot API limits
 */
export class TelegramMTProtoService {
  private mtproto: any; // Using 'any' type for MTProto instance
  private channelId: string;
  private prisma: PrismaClient;
  private publicUrl: string;
  private initialized: boolean = false;
  private sessionFilePath: string;
  private authStatus: AuthStatus = { authorized: false };
  private authRequestId: string | null = null;

  /**
   * Create a new MTProto service instance
   *
   * @param apiId The Telegram API ID for the application
   * @param apiHash The Telegram API Hash for the application
   * @param phoneNumber The phone number of the Telegram account to use
   * @param channelId The channel ID where files will be stored
   * @param prisma Prisma client for database operations
   * @param publicUrl The public URL of the application
   */
  constructor(
    private apiId: number,
    private apiHash: string,
    private phoneNumber: string,
    channelId: string,
    prisma: PrismaClient,
    publicUrl: string
  ) {
    this.channelId = channelId;
    this.prisma = prisma;
    this.publicUrl = publicUrl;

    // Ensure session directory exists
    const sessionDir = path.resolve(process.cwd(), "secure-sessions");
    fs.ensureDirSync(sessionDir);

    this.sessionFilePath = path.join(
      sessionDir,
      `${phoneNumber.replace(/[^0-9]/g, "")}.json`
    );

    // Initialize MTProto client according to docs
    // https://mtproto-core.js.org/docs/
    this.mtproto = new MTProtoModule({
      api_id: this.apiId,
      api_hash: this.apiHash,
      storageOptions: {
        path: this.sessionFilePath,
      },
      customDc: 5, // Use DC5 based on phone number requirements
    });

    // Set up update handlers
    this.mtproto.updates.on(
      "updatesTooLong",
      this.handleUpdatesTooLong.bind(this)
    );
    this.mtproto.updates.on(
      "updateShortMessage",
      this.handleUpdateShortMessage.bind(this)
    );
    this.mtproto.updates.on(
      "updateShortChatMessage",
      this.handleUpdateShortChatMessage.bind(this)
    );
    this.mtproto.updates.on("updateShort", this.handleUpdateShort.bind(this));
    this.mtproto.updates.on("updates", this.handleUpdates.bind(this));

    logger.info("TelegramMTProtoService created", {
      channelId,
      phoneNumber: `${phoneNumber.substring(0, 4)}****${phoneNumber.substring(
        phoneNumber.length - 2
      )}`,
    });
  }

  /**
   * Initialize the service and check authentication
   */
  public async init(): Promise<void> {
    try {
      // Check if already authenticated
      const authStatus = await this.checkAuth();
      this.authStatus = authStatus;

      if (authStatus.authorized) {
        logger.info("MTProto already authorized", {
          userId: authStatus.user?.id,
          firstName: authStatus.user?.first_name,
          username: authStatus.user?.username,
        });
        this.initialized = true;
      } else {
        logger.info("Need to authenticate with Telegram MTProto");
        throw new Error(
          "Authentication required. Please implement authentication flow."
        );
      }
    } catch (error: any) {
      logger.error(`Failed to initialize MTProto service: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if we're already authenticated with Telegram
   */
  private async checkAuth(): Promise<AuthStatus> {
    try {
      const user = await this.mtproto.call(
        "users.getFullUser",
        {
          id: {
            _: "inputUserSelf",
          },
        },
        {
          dcId: 5, // Use DC5 explicitly
        }
      );

      return {
        authorized: true,
        user: user.users[0],
      };
    } catch (error: any) {
      return {
        authorized: false,
      };
    }
  }

  /**
   * Get detailed status of the MTProto client
   * This is helpful for debugging connection issues
   */
  public async getDetailedStatus(): Promise<any> {
    try {
      // Check if storage file exists
      const storageExists = await fs.pathExists(this.sessionFilePath);

      // Get MTProto details
      let config = null;
      try {
        config = await this.mtproto.call(
          "help.getConfig",
          {},
          {
            noErrorBox: true,
          }
        );
      } catch (e) {
        logger.error("Failed to get config", { error: e });
      }

      return {
        authorized: this.authStatus.authorized,
        user: this.authStatus.user,
        phoneNumber: this.phoneNumber
          ? `${this.phoneNumber.substring(
              0,
              4
            )}****${this.phoneNumber.substring(this.phoneNumber.length - 2)}`
          : null,
        apiIdProvided: !!this.apiId,
        apiHashProvided: !!this.apiHash,
        storageFileExists: storageExists,
        storageFilePath: this.sessionFilePath,
        telegramConfigAvailable: !!config,
        dcOptions: config?.dc_options ? config.dc_options.length : 0,
      };
    } catch (error: unknown) {
      logger.error("Error getting detailed status", { error });
      return {
        error: error instanceof Error ? error.message : String(error),
        authorized: this.authStatus.authorized,
      };
    }
  }

  /**
   * Send authentication code to the phone number
   */
  public async sendAuthCode(): Promise<{ phoneCodeHash: string }> {
    try {
      // Generate a unique request ID
      this.authRequestId = uuidv4();

      // Get detailed status for debugging
      const status = await this.getDetailedStatus();
      logger.info("MTProto detailed status before sending code", status);

      // Debug the API call
      logger.info("Sending auth code to phone number", {
        phoneNumber: `${this.phoneNumber.substring(
          0,
          4
        )}****${this.phoneNumber.substring(this.phoneNumber.length - 2)}`,
        apiId: this.apiId,
      });

      // Format phone number - ensure it doesn't start with +
      const formattedPhone = this.phoneNumber.replace(/^\+/, "");

      // Send auth code with DC5 explicitly specified
      try {
        const result = await this.mtproto.call(
          "auth.sendCode",
          {
            phone_number: formattedPhone,
            api_id: this.apiId,
            api_hash: this.apiHash,
            settings: {
              _: "codeSettings",
              allow_flashcall: false,
              current_number: true,
            },
          },
          {
            dcId: 5, // Use DC5 explicitly
          }
        );

        // Debug the response
        logger.info("Auth code response received", {
          type: result.type,
          nextType: result.next_type,
          timeout: result.timeout,
        });

        this.authStatus = {
          ...this.authStatus,
          phoneCodeHash: result.phone_code_hash,
          phoneCodeRequired: true,
          phoneNumber: this.phoneNumber,
        };

        logger.info("Auth code sent successfully", {
          phoneNumber: `${this.phoneNumber.substring(
            0,
            4
          )}****${this.phoneNumber.substring(this.phoneNumber.length - 2)}`,
          phoneCodeHash: result.phone_code_hash,
        });

        return {
          phoneCodeHash: result.phone_code_hash,
        };
      } catch (error: any) {
        logger.error("Failed to send auth code", {
          error: error?.message || "Unknown error",
          errorCode: error?.error_code,
          errorMessage: error?.error_message,
        });
        throw new Error(
          `Failed to send auth code: ${error?.message || "Unknown error"}`
        );
      }
    } catch (error: any) {
      const errorMessage = error?.message || "Unknown error";

      logger.error(`Failed to send auth code: ${errorMessage}`, {
        error,
        stack: error?.stack,
        phoneNumber: `${this.phoneNumber.substring(
          0,
          4
        )}****${this.phoneNumber.substring(this.phoneNumber.length - 2)}`,
        apiId: this.apiId,
      });

      throw new Error(`Failed to send auth code: ${errorMessage}`);
    }
  }

  /**
   * Sign in with the verification code
   */
  public async signIn(code: string): Promise<{ success: boolean; user?: any }> {
    try {
      if (!this.authStatus.phoneCodeHash) {
        throw new Error(
          "Phone code hash not available. Please request code first."
        );
      }

      const signInResult = await this.mtproto.call(
        "auth.signIn",
        {
          phone_number: this.phoneNumber.replace(/^\+/, ""),
          phone_code_hash: this.authStatus.phoneCodeHash,
          phone_code: code,
        },
        {
          dcId: 5, // Use DC5 explicitly
        }
      );

      this.authStatus = {
        authorized: true,
        user: signInResult.user,
      };

      this.initialized = true;

      logger.info("Successfully authenticated with Telegram MTProto", {
        userId: signInResult.user.id,
        firstName: signInResult.user.first_name,
        username: signInResult.user.username,
      });

      return {
        success: true,
        user: signInResult.user,
      };
    } catch (error: any) {
      if (error.error_message === "SESSION_PASSWORD_NEEDED") {
        logger.error(
          "Two-factor authentication required. This is not supported currently."
        );
        throw new Error(
          "Two-factor authentication is required but not supported by this application."
        );
      }

      logger.error(`Failed to sign in: ${error.message}`, { error });
      throw error;
    }
  }

  /**
   * Get current authentication status
   */
  public getAuthStatus(): AuthStatus {
    return this.authStatus;
  }

  /**
   * Upload a large file to Telegram via MTProto API
   * Supports files up to 2GB in size
   *
   * @param fileBuffer File buffer to upload
   * @param fileName Original file name
   * @param mimeType MIME type of the file
   * @param userId User ID who is uploading the file
   * @returns Object with file ID and download URL
   */
  public async uploadLargeFile(
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    userId: string
  ): Promise<{ fileId: string; downloadUrl: string }> {
    if (!this.initialized) {
      throw new Error("MTProto service not initialized or not authenticated");
    }

    try {
      logger.info(
        `Starting large file upload via MTProto: ${fileName} (${fileBuffer.length} bytes)`,
        {
          userId,
          fileName,
          fileSize: fileBuffer.length,
          mimeType,
        }
      );

      // Generate a unique file ID for our database
      const fileId = uuidv4();

      // Calculate file parts for upload
      const fileSize = fileBuffer.length;
      const partSize = 512 * 1024; // 512KB parts
      const totalParts = Math.ceil(fileSize / partSize);

      logger.info(
        `Uploading file in ${totalParts} parts of ${partSize} bytes each`
      );

      // Generate a file ID for MTProto (needs to be numeric)
      const mtprotoFileId = Math.floor(Math.random() * 1000000000);

      // Upload file parts
      logger.info(`Starting file part uploads for ${fileName}`);

      for (let i = 0; i < totalParts; i++) {
        const start = i * partSize;
        const end = Math.min(start + partSize, fileSize);
        const part = fileBuffer.slice(start, end);

        try {
          await this.mtproto.call(
            "upload.saveFilePart",
            {
              file_id: mtprotoFileId,
              file_part: i,
              bytes: part,
            },
            {
              dcId: 5, // Use DC5 explicitly
            }
          );

          logger.info(
            `Uploaded part ${i + 1}/${totalParts} (${part.length} bytes)`
          );
        } catch (partError: any) {
          logger.error(
            `Failed to upload part ${i + 1}/${totalParts}: ${partError.message}`
          );
          throw new Error(
            `Failed to upload part ${i + 1}/${totalParts}: ${partError.message}`
          );
        }
      }

      logger.info(`All parts uploaded successfully, sending to channel`);

      // Send the file to the channel
      const result = await this.mtproto.call(
        "messages.sendMedia",
        {
          peer: {
            _: "inputPeerChannel",
            channel_id: parseInt(this.channelId),
            access_hash: 0, // We assume we're an admin of the channel
          },
          media: {
            _: "inputMediaUploadedDocument",
            file: {
              _: "inputFile",
              id: mtprotoFileId,
              parts: totalParts,
              name: fileName,
              md5_checksum: "", // Optional
            },
            mime_type: mimeType,
            attributes: [
              {
                _: "documentAttributeFilename",
                file_name: fileName,
              },
            ],
          },
          message: `File: ${fileName} (Uploaded by user ${userId})`,
          random_id: Math.floor(Math.random() * 1000000000),
        },
        {
          dcId: 5, // Use DC5 explicitly
        }
      );

      logger.info("Message with file sent successfully", { result });

      // Extract message ID and document info
      const updates = result.updates || [];
      let messageId = null;
      let document = null;

      // Find the update containing our document
      for (const update of updates) {
        if (
          update._ === "updateNewChannelMessage" &&
          update.message?.media?.document
        ) {
          messageId = update.message.id;
          document = update.message.media.document;
          break;
        }

        // Other possible update format
        if (
          update._ === "updateNewMessage" &&
          update.message?.media?.document
        ) {
          messageId = update.message.id;
          document = update.message.media.document;
          break;
        }
      }

      if (!document) {
        logger.error("Could not extract document from response", { result });
        throw new Error(
          "Could not extract document information from Telegram response"
        );
      }

      // Generate download URL
      const downloadUrl = `${this.publicUrl}/download/${fileId}`;

      // Save to database
      await this.prisma.uploadFile.create({
        data: {
          id: fileId,
          fileName: fileName,
          fileType: mimeType,
          fileSize: fileSize,
          telegramFileId: document.id.toString(),
          telegramUrl: `tg://document?id=${document.id}`,
          publicUrl: downloadUrl,
          userId,
        },
      });

      logger.info(`Large file upload completed: ${fileName}`, {
        fileId,
        telegramFileId: document.id,
        size: fileSize,
      });

      // Return file ID and download URL
      return {
        fileId,
        downloadUrl,
      };
    } catch (error: any) {
      logger.error(`Failed to upload large file: ${error.message}`, {
        error,
        fileName,
        size: fileBuffer.length,
      });
      throw new Error(`Failed to upload file: ${error.message}`);
    }
  }

  /**
   * Download a large file from Telegram via MTProto API
   * This is a placeholder - actual implementation would be more complex
   */
  public async downloadLargeFile(fileId: string): Promise<Buffer> {
    if (!this.initialized) {
      throw new Error("MTProto service not initialized or not authenticated");
    }

    try {
      const file = await this.prisma.uploadFile.findUnique({
        where: { id: fileId },
      });

      if (!file) {
        throw new Error(`File not found: ${fileId}`);
      }

      logger.info(
        `Starting large file download via MTProto: ${file.fileName}`,
        {
          fileId,
          telegramFileId: file.telegramFileId,
        }
      );

      // This would be replaced with actual MTProto download logic
      throw new Error("MTProto download not fully implemented yet");
    } catch (error: any) {
      logger.error(`Failed to download large file: ${error.message}`, {
        error,
        fileId,
      });
      throw new Error(`Failed to download file: ${error.message}`);
    }
  }

  /**
   * Stop the MTProto service gracefully
   */
  public async stop(): Promise<void> {
    logger.info("Stopping MTProto service");
    this.initialized = false;
  }

  // Update handlers for MTProto
  private handleUpdatesTooLong() {
    logger.debug("MTProto update: updatesTooLong");
  }

  private handleUpdateShortMessage(update: any) {
    logger.debug("MTProto update: updateShortMessage", {
      messageId: update.id,
    });
  }

  private handleUpdateShortChatMessage(update: any) {
    logger.debug("MTProto update: updateShortChatMessage", {
      messageId: update.id,
    });
  }

  private handleUpdateShort(update: any) {
    logger.debug("MTProto update: updateShort", { update });
  }

  private handleUpdates(update: any) {
    logger.debug("MTProto update: updates", {
      updateCount: update.updates.length,
    });
  }
}
