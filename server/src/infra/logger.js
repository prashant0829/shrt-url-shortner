import { pino } from 'pino';
import { Environment, SERVICE_NAME } from '../constants.js';

const REDACTED_PATHS = ['req.headers.authorization', 'req.headers.cookie'];

const prettyPrinting = {
  transport: {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service' },
  },
};

// Pretty output only in development; every other environment logs JSON for log shippers.
export function createLogger(config) {
  return pino({
    level: config.log.level,
    base: { service: SERVICE_NAME },
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    ...(config.env === Environment.DEVELOPMENT ? prettyPrinting : {}),
  });
}
