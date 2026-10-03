import { validationError } from '../errors.js';

// How each part of the request is named in validation errors.
const REPORTED_LOCATION = { params: 'params', query: 'querystring', body: 'body' };

// Validates params, query and body against zod schemas and reports every problem at once. Parsed
// values go on `req.input`, because Express 5 makes `req.query` read-only.
export function validate(schemas) {
  return (req, _res, next) => {
    const input = {};
    const issues = [];

    for (const [part, location] of Object.entries(REPORTED_LOCATION)) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part]);
      if (result.success) {
        input[part] = result.data;
        continue;
      }
      for (const issue of result.error.issues) {
        issues.push({ in: location, path: issue.path.join('.'), message: issue.message });
      }
    }

    if (issues.length > 0) return next(validationError(issues));

    req.input = input;
    return next();
  };
}
