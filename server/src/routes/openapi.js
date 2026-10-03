import { STATUS_CODES } from 'node:http';
import { z } from 'zod';
import { BEARER_SCHEME, ContentType, HttpStatus, RouteSecurity } from '../constants.js';

const OPENAPI_VERSION = '3.1.0';

// An empty requirement object means "no token" is also accepted.
const SECURITY_REQUIREMENTS = {
  [RouteSecurity.REQUIRED]: [{ bearerAuth: [] }],
  [RouteSecurity.OPTIONAL]: [{ bearerAuth: [] }, {}],
};

// Marks a documented response as a file (such as the QR image) instead of JSON.
export const binaryResponse = (description, ...contentTypes) => ({
  binary: true,
  description,
  contentTypes,
});

// zod -> JSON Schema 2020-12, which OpenAPI 3.1 uses as is. `side` picks the request ('input') or
// response ('output') form of transformed schemas.
function toJsonSchema(schema, side) {
  const { $schema: _omit, ...jsonSchema } = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    unrepresentable: 'any',
    io: side,
  });
  return jsonSchema;
}

const toOpenApiPath = (expressPath) => expressPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

function buildParameters(schema, location) {
  const { properties = {}, required = [] } = toJsonSchema(schema, 'input');
  return Object.entries(properties).map(([name, { description, ...propertySchema }]) => ({
    name,
    in: location,
    required: location === 'path' || required.includes(name),
    ...(description && { description }),
    schema: propertySchema,
  }));
}

function buildResponse(status, spec) {
  const description = STATUS_CODES[status] ?? 'Response';
  if (spec === null) return { description };

  if (spec.binary) {
    return {
      description: spec.description,
      content: Object.fromEntries(
        spec.contentTypes.map((type) => [type, { schema: { type: 'string', format: 'binary' } }]),
      ),
    };
  }
  return { description, content: { [ContentType.JSON]: { schema: toJsonSchema(spec, 'output') } } };
}

function buildOperation(route) {
  const { request, responses } = route;
  const parameters = [
    ...(request.params ? buildParameters(request.params, 'path') : []),
    ...(request.query ? buildParameters(request.query, 'query') : []),
  ];
  const responseEntries = Object.entries(responses);

  return {
    tags: route.tags,
    summary: route.summary,
    description: route.description,
    security: SECURITY_REQUIREMENTS[route.security],
    parameters: parameters.length > 0 ? parameters : undefined,
    requestBody: request.body
      ? {
          required: true,
          content: { [ContentType.JSON]: { schema: toJsonSchema(request.body, 'input') } },
        }
      : undefined,
    responses:
      responseEntries.length > 0
        ? Object.fromEntries(
            responseEntries.map(([status, spec]) => [status, buildResponse(Number(status), spec)]),
          )
        : { [HttpStatus.OK]: { description: 'OK' } },
  };
}

export function buildOpenApiDocument({ info, servers, tags, routeRegistry }) {
  const paths = {};
  for (const route of routeRegistry.routes) {
    if (route.hiddenFromDocs) continue;

    const operation = Object.fromEntries(
      Object.entries(buildOperation(route)).filter(([, value]) => value !== undefined),
    );
    const openApiPath = toOpenApiPath(route.path);
    paths[openApiPath] = { ...paths[openApiPath], [route.method]: operation };
  }

  return {
    openapi: OPENAPI_VERSION,
    info,
    servers,
    tags,
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: BEARER_SCHEME, bearerFormat: 'JWT' } },
    },
  };
}
