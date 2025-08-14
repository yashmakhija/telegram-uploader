import { Request, Response, NextFunction } from "express";
import logger from "../utils/logger.js";
import { config } from "../config/index.js";

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const notFoundHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const error = new AppError(
    `Route ${req.method} ${req.originalUrl} not found`,
    404
  );
  next(error);
};

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let statusCode = 500;
  let message = "Internal Server Error";
  let stack: string | undefined = undefined;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
  }

  if (!config.isProduction && err.stack) {
    stack = err.stack;
  }

  const errorDetails = {
    method: req.method,
    path: req.path,
    statusCode,
    message: err.message,
    stack: err.stack,
    body: req.body,
    params: req.params,
    query: req.query,
    user: req.headers["x-api-key"] ? "authenticated" : "unauthenticated",
    ip: req.ip,
  };

  if (statusCode >= 500) {
    logger.error(`Server Error: ${err.message}`, errorDetails);
  } else {
    logger.warn(`Client Error: ${err.message}`, errorDetails);
  }

  res.status(statusCode).json({
    status: "error",
    message,
    ...(stack && { stack }),
  });
};

export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
