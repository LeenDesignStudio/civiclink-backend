import { buildSchema, getIntrospectionQuery, parse, validate } from 'graphql';
import { describe, expect, it } from 'vitest';
import { depthLimitRule } from './armor.js';
import {
  documentIsOnlyIntrospection,
  introspectionSkipsCsrf,
  skipDepthForIntrospection,
  sourceIsIntrospectionRequest,
} from './introspection.js';

const INTROSPECTION = '{ __schema { queryType { name } } }';
const STUDIO = getIntrospectionQuery();

describe('introspection CSRF exception', () => {
  it('allows an introspection document outside production', () => {
    expect(
      introspectionSkipsCsrf({
        appEnv: 'development',
        method: 'POST',
        url: '/graphql',
        body: { query: INTROSPECTION },
      }),
    ).toBe(true);
    expect(
      introspectionSkipsCsrf({
        appEnv: 'test',
        method: 'POST',
        url: '/graphql',
        body: { query: STUDIO, operationName: 'IntrospectionQuery' },
      }),
    ).toBe(true);
    expect(sourceIsIntrospectionRequest('{ __type(name: "Query") { name } }')).toBe(true);
  });

  it('keeps requiring CSRF in production, including for introspection', () => {
    expect(
      introspectionSkipsCsrf({
        appEnv: 'production',
        method: 'POST',
        url: '/graphql',
        body: { query: STUDIO, operationName: 'IntrospectionQuery' },
      }),
    ).toBe(false);
    expect(skipDepthForIntrospection('production', parse(STUDIO))).toBe(false);
  });

  it('does not treat ordinary queries, mutations, or mixed documents as introspection', () => {
    expect(
      introspectionSkipsCsrf({
        appEnv: 'development',
        method: 'POST',
        url: '/graphql',
        body: { query: '{ health }' },
      }),
    ).toBe(false);
    expect(
      introspectionSkipsCsrf({
        appEnv: 'development',
        method: 'POST',
        url: '/graphql',
        body: { query: '{ __schema { queryType { name } } health }' },
      }),
    ).toBe(false);
    expect(
      introspectionSkipsCsrf({
        appEnv: 'development',
        method: 'POST',
        url: '/graphql',
        body: { query: 'mutation { adminSignOut { signedOut } }' },
      }),
    ).toBe(false);
    expect(
      sourceIsIntrospectionRequest('query { ...Schema } fragment Schema on Query { __schema { queryType { name } } }'),
    ).toBe(false);
    expect(introspectionSkipsCsrf({ appEnv: 'development', method: 'POST', url: '/graphql', body: { query: '{' } })).toBe(
      false,
    );
  });

  it('selects the named operation when a document contains more than one', () => {
    const query = 'query Intro { __schema { queryType { name } } } query Health { health }';
    expect(sourceIsIntrospectionRequest(query, 'Intro')).toBe(true);
    expect(sourceIsIntrospectionRequest(query, 'Health')).toBe(false);
    expect(sourceIsIntrospectionRequest(query)).toBe(false);
    expect(documentIsOnlyIntrospection(parse(STUDIO))).toBe(true);
    expect(documentIsOnlyIntrospection(parse(query))).toBe(false);
  });

  it('still rejects a non-introspection query that exceeds the depth limit', () => {
    const schema = buildSchema('type Query { node: Node } type Node { node: Node name: String }');
    const deep = parse('{ node { node { node { node { node { node { node { node { name } } } } } } } } }');
    const errors = validate(schema, deep, [depthLimitRule()]);
    expect(errors.length).toBeGreaterThan(0);
    expect(skipDepthForIntrospection('development', deep)).toBe(false);
    expect(skipDepthForIntrospection('development', parse(STUDIO))).toBe(true);
  });
});
