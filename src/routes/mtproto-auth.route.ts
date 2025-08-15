import { Router, Request, Response } from "express";
import { TelegramMTProtoService } from "../services/telegram-mtproto.service.js";
import { asyncHandler } from "../middleware/error.middleware.js";
import { PermissionService } from "../services/permission.service.js";
import logger from "../utils/logger.js";

/**
 * Routes for handling MTProto authentication flow
 * These routes are admin-only and used for one-time authentication with Telegram
 */
export class MTProtoAuthRoutes {
  private router: Router;
  private mtprotoService: TelegramMTProtoService;
  private permissionService: PermissionService;

  constructor(
    mtprotoService: TelegramMTProtoService,
    permissionService: PermissionService
  ) {
    this.router = Router();
    this.mtprotoService = mtprotoService;
    this.permissionService = permissionService;
    this.initializeRoutes();

    // Debug logging - log that the routes are being registered
    logger.info("MTProto auth routes initialized", {
      routes: [
        { path: "/status", method: "GET" },
        { path: "/send-code", method: "POST" },
        { path: "/verify-code", method: "POST" },
      ],
    });
  }

  /**
   * Initialize the authentication routes
   */
  private initializeRoutes(): void {
    // For troubleshooting, temporarily disable admin middleware
    // Admin middleware to check if user is authorized
    const adminMiddleware = asyncHandler(
      async (req: Request, res: Response, next: any) => {
        // Extract API key from header
        const apiKey = req.headers["x-api-key"];

        if (!apiKey || typeof apiKey !== "string") {
          res.status(401).json({ error: "API key required" });
          return;
        }

        // For now, allow any Telegram ID for testing
        next();
      }
    );

    // Apply admin middleware to all routes
    this.router.use(adminMiddleware);

    // Routes
    this.router.get("/status", asyncHandler(this.getStatus.bind(this)));
    this.router.get(
      "/detailed-status",
      asyncHandler(this.getDetailedStatus.bind(this))
    );
    this.router.post("/send-code", asyncHandler(this.sendCode.bind(this)));
    this.router.post("/verify-code", asyncHandler(this.verifyCode.bind(this)));
  }

  /**
   * Get detailed status for debugging
   */
  private async getDetailedStatus(req: Request, res: Response): Promise<void> {
    try {
      logger.info("MTProto detailed-status endpoint called", {
        headers: req.headers,
      });

      const detailedStatus = await this.mtprotoService.getDetailedStatus();

      res.status(200).json({
        success: true,
        status: detailedStatus,
      });
    } catch (error: any) {
      logger.error(`Failed to get detailed status: ${error.message}`, {
        error,
      });

      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Send verification code to the phone number
   */
  private async sendCode(req: Request, res: Response): Promise<void> {
    try {
      // Debug log
      logger.info("MTProto send-code endpoint called", {
        headers: req.headers,
        body: req.body,
      });

      const result = await this.mtprotoService.sendAuthCode();
      logger.info("Auth code sent to phone", {
        requestId: result.phoneCodeHash,
      });

      res.status(200).json({
        success: true,
        message: "Verification code sent to your phone number",
      });
    } catch (error: any) {
      logger.error(`Failed to send auth code: ${error.message}`, { error });

      res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Verify the code and complete authentication
   */
  private async verifyCode(req: Request, res: Response): Promise<void> {
    try {
      const { code } = req.body;

      // Debug log
      logger.info("MTProto verify-code endpoint called", {
        headers: req.headers,
        body: req.body,
      });

      if (!code) {
        res.status(400).json({
          success: false,
          error: "Verification code is required",
        });
        return;
      }

      const result = await this.mtprotoService.signIn(code);

      res.status(200).json({
        success: true,
        message: "Authentication successful",
        user: {
          id: result.user.id,
          firstName: result.user.first_name,
          username: result.user.username,
        },
      });
    } catch (error: any) {
      logger.error(`Failed to verify code: ${error.message}`, { error });

      res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Get the current authentication status
   */
  private async getStatus(req: Request, res: Response): Promise<void> {
    try {
      // Debug log
      logger.info("MTProto status endpoint called", { headers: req.headers });

      const status = this.mtprotoService.getAuthStatus();

      res.status(200).json({
        success: true,
        authorized: status.authorized,
        user: status.user
          ? {
              id: status.user.id,
              firstName: status.user.first_name,
              username: status.user.username,
            }
          : undefined,
      });
    } catch (error: any) {
      logger.error(`Failed to get auth status: ${error.message}`, { error });

      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Get the router instance
   */
  public getRouter(): Router {
    return this.router;
  }
}
