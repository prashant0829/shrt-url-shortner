import { pino } from 'pino';

export function createLogger(config) {
  return pino({
    level: config.log.level,
    base: { service: 'url-shortener' },
    redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], censor: '[redacted]' },
    // Human-friendly output in development only; production emits JSON for log shippers.
    ...(config.env === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss.l',
              ignore: 'pid,hostname,service',
            },
          },
        }
      : {}),
  });
}
