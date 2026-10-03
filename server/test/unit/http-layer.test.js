import SwaggerParser from '@apidevtools/swagger-parser';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { binaryResponse, buildOpenApiDocument } from '../../src/routes/openapi.js';
import { validate } from '../../src/middleware/validate.middleware.js';

const run = (schemas, req) => {
  let error;
  validate(schemas)(req, {}, (err) => {
    error = err;
  });
  return { error, req };
};

describe('validate middleware', () => {
  const schemas = {
    params: z.object({ code: z.string().min(3) }),
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      q: z.string().optional(),
    }),
    body: z.object({
      url: z.string().min(1),
      tags: z.array(z.object({ name: z.string() })).optional(),
    }),
  };

  it('exposes parsed, coerced and defaulted input on req.input', () => {
    const { error, req } = run(schemas, {
      params: { code: 'abc' },
      query: { limit: '5' },
      body: { url: 'https://example.com' },
    });

    expect(error).toBeUndefined();
    expect(req.input).toEqual({
      params: { code: 'abc' },
      query: { limit: 5 },
      body: { url: 'https://example.com' },
    });
  });

  it('applies defaults when the query is empty', () => {
    const { req } = run({ query: schemas.query }, { query: {} });
    expect(req.input.query.limit).toBe(20);
  });

  it('reports every problem at once, labelled by where it came from', () => {
    const { error } = run(schemas, {
      params: { code: 'x' },
      query: { limit: '500' },
      body: { url: '', tags: [{ name: 7 }] },
    });

    expect(error).toMatchObject({ name: 'ValidationError' });
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details.map(({ in: where, path }) => `${where}:${path}`).sort()).toEqual([
      'body:tags.0.name',
      'body:url',
      'params:code',
      'querystring:limit',
    ]);
    expect(error.details.every((d) => typeof d.message === 'string' && d.message)).toBe(true);
  });

  it('treats a missing body as invalid when a body schema exists', () => {
    const { error } = run({ body: schemas.body }, { body: undefined });
    expect(error).toMatchObject({ name: 'ValidationError' });
    expect(error.details[0].in).toBe('body');
  });

  it('only checks the parts it was given schemas for, and leaves the request untouched', () => {
    const query = { limit: '5' };
    const { error, req } = run({ params: schemas.params }, { params: { code: 'abc' }, query });

    expect(error).toBeUndefined();
    expect(req.input).toEqual({ params: { code: 'abc' } });
    expect(req.query).toBe(query);
  });
});

describe('OpenAPI generation', () => {
  const routeRegistry = {
    routes: [
      {
        method: 'get',
        path: '/api/v1/things/:id',
        security: 'required',
        tags: ['Things'],
        summary: 'Get a thing',
        request: {
          params: z.object({ id: z.string().describe('Thing id') }),
          query: z.object({ limit: z.coerce.number().int().default(20), q: z.string().optional() }),
        },
        responses: { 200: z.object({ ok: z.boolean() }), 404: null },
      },
      {
        method: 'post',
        path: '/things',
        security: 'optional',
        request: { body: z.object({ name: z.string().min(1) }) },
        responses: { 201: z.object({ id: z.string() }) },
      },
      {
        method: 'get',
        path: '/things/:id/image',
        security: 'none',
        request: { params: z.object({ id: z.string() }) },
        responses: { 200: binaryResponse('A PNG image', 'image/png') },
      },
      { method: 'get', path: '/metrics', hiddenFromDocs: true, request: {}, responses: {} },
    ],
  };

  const doc = buildOpenApiDocument({
    info: { title: 'Test API', description: 'For tests', version: '1.0.0' },
    servers: [{ url: 'http://localhost' }],
    tags: [{ name: 'Things', description: 'Things' }],
    routeRegistry,
  });

  it('is a valid OpenAPI 3.1 document', async () => {
    expect(doc.openapi).toBe('3.1.0');
    await expect(SwaggerParser.validate(structuredClone(doc))).resolves.toBeDefined();
  });

  it('converts Express path parameters and omits hidden routes', () => {
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/api/v1/things/{id}',
      '/things',
      '/things/{id}/image',
    ]);
  });

  it('documents path and query parameters from the request schemas', () => {
    const { parameters } = doc.paths['/api/v1/things/{id}'].get;

    expect(parameters).toContainEqual({
      name: 'id',
      in: 'path',
      required: true,
      description: 'Thing id',
      schema: { type: 'string' },
    });
    expect(parameters.find((p) => p.name === 'limit')).toMatchObject({
      in: 'query',
      required: false,
    });
    expect(parameters.find((p) => p.name === 'q')).toMatchObject({ in: 'query', required: false });
  });

  it('maps security modes: required, optional (anonymous also accepted) and none', () => {
    expect(doc.paths['/api/v1/things/{id}'].get.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths['/things'].post.security).toEqual([{ bearerAuth: [] }, {}]);
    expect(doc.paths['/things/{id}/image'].get.security).toBeUndefined();
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('documents request bodies, JSON responses, empty responses and binary responses', () => {
    const post = doc.paths['/things'].post;
    expect(post.requestBody.content['application/json'].schema.properties.name).toMatchObject({
      type: 'string',
    });
    expect(post.responses['201'].content['application/json'].schema.properties.id).toBeDefined();

    expect(doc.paths['/api/v1/things/{id}'].get.responses['404']).toEqual({
      description: 'Not Found',
    });

    expect(doc.paths['/things/{id}/image'].get.responses['200'].content['image/png']).toEqual({
      schema: { type: 'string', format: 'binary' },
    });
  });

  it('never leaks the JSON Schema dialect marker into the document', () => {
    expect(JSON.stringify(doc)).not.toContain('$schema');
  });
});
