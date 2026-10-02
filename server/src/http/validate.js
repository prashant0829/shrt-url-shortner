import { ValidationError } from '../shared/errors.js';

// Where each part of the request is reported from (matches the names clients see in errors).
const LOCATIONS = { params: 'params', query: 'querystring', body: 'body' };

/**
 * Validates `req.params`, `req.query` and `req.body` against zod schemas and exposes the parsed
 * (coerced, defaulted) values as `req.input.{params,query,body}`. On failure it reports every
 * problem at once as a 400 `VALIDATION_ERROR`.
 *
 * Parsed values go on `req.input` because Express 5 makes `req.query` read-only.
 *
 * @param {{params?: import('zod').ZodType, query?: import('zod').ZodType, body?: import('zod').ZodType}} schemas
 * @returns {import('express').RequestHandler}
 */
export function validate(schemas) {
  return (req, _res, next) => {
    const input = {};
    const issues = [];

    for (const [part, location] of Object.entries(LOCATIONS)) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part]);
      if (result.success) {
        input[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          issues.push({ in: location, path: issue.path.join('.'), message: issue.message });
        }
      }
    }

    if (issues.length > 0) return next(new ValidationError(issues));

    req.input = input;
    return next();
  };
}
