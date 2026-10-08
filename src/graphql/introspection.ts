import { Kind, parse, type DocumentNode, type OperationDefinitionNode, type SelectionNode } from 'graphql';

const SCHEMA_FIELDS = new Set(['__schema', '__type']);

export function introspectionSkipsCsrf(input: {
  appEnv: string;
  method: string;
  url: string;
  body: unknown;
}): boolean {
  if (input.appEnv === 'production' || input.method === 'OPTIONS') return false;
  const source = readGraphqlSource(input.method, input.url, input.body);
  if (!source) return false;
  return sourceIsIntrospectionRequest(source.query, source.operationName);
}

/** True when every operation in the document is an introspection query. */
export function documentIsOnlyIntrospection(document: DocumentNode): boolean {
  const operations = operationDefinitions(document);
  return operations.length > 0 && operations.every(operationIsIntrospection);
}

export function skipDepthForIntrospection(appEnv: string, document: unknown): boolean {
  if (appEnv === 'production' || !isDocumentNode(document)) return false;
  return documentIsOnlyIntrospection(document);
}

export function sourceIsIntrospectionRequest(source: string, operationName?: string | null): boolean {
  let document: DocumentNode;
  try {
    document = parse(source);
  } catch {
    return false;
  }
  const operation = selectOperation(operationDefinitions(document), operationName);
  return operation !== undefined && operationIsIntrospection(operation);
}

function operationDefinitions(document: DocumentNode): OperationDefinitionNode[] {
  return document.definitions.filter(
    (definition): definition is OperationDefinitionNode => definition.kind === Kind.OPERATION_DEFINITION,
  );
}

function selectOperation(
  operations: readonly OperationDefinitionNode[],
  operationName?: string | null,
): OperationDefinitionNode | undefined {
  if (typeof operationName === 'string' && operationName.length > 0) {
    return operations.find((operation) => operation.name?.value === operationName);
  }
  return operations.length === 1 ? operations[0] : undefined;
}

function operationIsIntrospection(operation: OperationDefinitionNode): boolean {
  if (operation.operation !== 'query') return false;
  const selections = operation.selectionSet.selections;
  return selections.length > 0 && selections.every(isSchemaField);
}

function isSchemaField(selection: SelectionNode): boolean {
  return selection.kind === Kind.FIELD && SCHEMA_FIELDS.has(selection.name.value);
}

function isDocumentNode(value: unknown): value is DocumentNode {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === Kind.DOCUMENT;
}

function readGraphqlSource(
  method: string,
  url: string,
  body: unknown,
): { query: string; operationName: string | null } | undefined {
  if (method === 'GET') {
    const params = new URL(url, 'http://127.0.0.1').searchParams;
    const query = params.get('query');
    if (!query) return undefined;
    return { query, operationName: params.get('operationName') };
  }
  return readBody(body);
}

function readBody(body: unknown): { query: string; operationName: string | null } | undefined {
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return readBody(JSON.parse(trimmed) as unknown);
      } catch {
        return undefined;
      }
    }
    return trimmed.length > 0 ? { query: trimmed, operationName: null } : undefined;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.query !== 'string' || record.query.length === 0) return undefined;
  const operationName = typeof record.operationName === 'string' ? record.operationName : null;
  return { query: record.query, operationName };
}
