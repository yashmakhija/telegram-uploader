import { Request, Response, NextFunction } from "express";
import logger from "../utils/logger.js";
import { config } from "../config/index.js";

export const performanceMonitor = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (config.isProduction && req.path === "/health") {
    return next();
  }

  const start = process.hrtime();

  res.on("finish", () => {
    const [seconds, nanoseconds] = process.hrtime(start);
    const ms = seconds * 1000 + nanoseconds / 1000000;
    const duration = ms.toFixed(2);

    const isSlowResponse = ms > 1000;
    const isErrorResponse = res.statusCode >= 400;

    const message = `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`;

    const context = {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: parseFloat(duration),
      userAgent: req.get("user-agent"),
      ip: req.ip,
    };

    if (isErrorResponse) {
      logger.warn(`Slow Error Response: ${message}`, context);
    } else if (isSlowResponse) {
      logger.warn(`Slow Response: ${message}`, context);
    } else {
      logger.http(message, context);
    }
  });

  next();
};
