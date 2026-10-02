import { STATUS_CODES } from 'node:http';
import { z } from 'zod';

/** Marks a documented response as a file (QR code images) rather than JSON. */
export const binaryResponse = (description, ...contentTypes) => ({
  binary: true,
  description,
  contentTypes,
});

/** zod -> JSON Schema 2020-12, which OpenAPI 3.1 uses as-is. `io` picks the request or response side of transforms. */
function toJsonSchema(schema, io) {
  const { $schema: _omit, ...jsonSchema } = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    unrepresentable: 'any',
    io,
  });
  return jsonSchema;
}

function parametersFrom(schema, location) {
  const { properties = {}, required = [] } = toJsonSchema(schema, 'input');
  return Object.entries(properties).map(([name, { description, ...propertySchema }]) => ({
    name,
    in: location,
    required: location === 'path' || required.includes(name),
    ...(description && { description }),
    schema: propertySchema,
  }));
}

function responseFor(status, spec) {
  if (spec === null) return { description: STATUS_CODES[status] ?? 'Response' };
  if (spec.binary) {
    return {
      description: spec.description,
      content: Object.fromEntries(
        spec.contentTypes.map((type) => [type, { schema: { type: 'string', format: 'binary' } }]),
      ),
    };
  }
  return {
    description: STATUS_CODES[status] ?? 'Response',
    content: { 'application/json': { schema: toJsonSchema(spec, 'output') } },
  };
}

const SECURITY = {
  required: [{ bearerAuth: [] }],
  optional: [{ bearerAuth: [] }, {}], // the empty requirement means "no token" is also accepted
};

function operationFor(route) {
  const { request, responses } = route;
  const parameters = [
    ...(request.params ? parametersFrom(request.params, 'path') : []),
    ...(request.query ? parametersFrom(request.query, 'query') : []),
  ];
  const responseEntries = Object.entries(responses);

  return {
    tags: route.tags,
    summary: route.summary,
    description: route.description,
    security: SECURITY[route.security],
    parameters: parameters.length > 0 ? parameters : undefined,
    requestBody: request.body
      ? {
          required: true,
          content: { 'application/json': { schema: toJsonSchema(request.body, 'input') } },
        }
      : undefined,
    responses:
      responseEntries.length > 0
        ? Object.fromEntries(
            responseEntries.map(([status, spec]) => [status, responseFor(Number(status), spec)]),
          )
        : { 200: { description: 'OK' } },
  };
}

/**
 * Builds the OpenAPI 3.1 document from the routes that registered themselves.
 * @param {object} options
 * @param {{title: string, description: string, version: string}} options.info
 * @param {{url: string}[]} options.servers
 * @param {{name: string, description: string}[]} options.tags
 * @param {{routes: object[]}} options.registry
 */
export function buildOpenApiDocument({ info, servers, tags, registry }) {
  const paths = {};
  for (const route of registry.routes) {
    if (route.hidden) continue;
    const key = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'); // Express -> OpenAPI path params
    const operation = Object.fromEntries(
      Object.entries(operationFor(route)).filter(([, value]) => value !== undefined),
    );
    paths[key] = { ...paths[key], [route.method]: operation };
  }

  return {
    openapi: '3.1.0',
    info,
    servers,
    tags,
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    },
  };
}
