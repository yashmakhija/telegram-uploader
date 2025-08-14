import winston from "winston";
import { config } from "../config/index.js";

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const level = () => {
  return config.isProduction ? "info" : "debug";
};

const colors = {
  error: "red",
  warn: "yellow",
  info: "green",
  http: "magenta",
  debug: "blue",
};

winston.addColors(colors);

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

const consoleTransport = new winston.transports.Console({
  format: consoleFormat,
});

export const logger = winston.createLogger({
  level: level(),
  levels,
  transports: [consoleTransport],
});

if (config.isProduction) {
  logger.add(
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
      format: fileFormat,
    })
  );

  logger.add(
    new winston.transports.File({
      filename: "logs/combined.log",
      format: fileFormat,
    })
  );
}

export default {
  error: (message: string, meta: object = {}) =>
    logger.error(message, { meta }),
  warn: (message: string, meta: object = {}) => logger.warn(message, { meta }),
  info: (message: string, meta: object = {}) => logger.info(message, { meta }),
  http: (message: string, meta: object = {}) => logger.http(message, { meta }),
  debug: (message: string, meta: object = {}) =>
    logger.debug(message, { meta }),
};
