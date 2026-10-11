import type { PageSelectors, Selector, SourceConfig } from './types.js';

export function sourceConfigFromJson(value: unknown): SourceConfig {
  const record = objectValue(value);
  const config: SourceConfig = {};
  const urls = strings(record.urls);
  if (urls.length > 0) config.urls = urls;
  const states = strings(record.states);
  if (states.length > 0) config.states = states;
  const layers = strings(record.layers);
  if (layers.length > 0) config.layers = layers;
  const allowedHosts = strings(record.allowedHosts);
  if (allowedHosts.length > 0) config.allowedHosts = allowedHosts;
  const item = selectorOf(record.item);
  if (item) config.item = item;
  if (record.fields && typeof record.fields === 'object' && !Array.isArray(record.fields)) {
    const fields: Record<string, Selector> = {};
    for (const [key, field] of Object.entries(record.fields)) {
      const selector = selectorOf(field);
      if (selector) fields[key] = selector;
    }
    if (Object.keys(fields).length > 0) config.fields = fields;
  }
  const state = text(record.state);
  if (state) config.state = state;
  const county = text(record.county);
  if (county) config.county = county;
  if (typeof record.tigerYear === 'number' && Number.isInteger(record.tigerYear)) config.tigerYear = record.tigerYear;
  const pageUrl = text(record.pageUrl);
  if (pageUrl) config.pageUrl = pageUrl;
  const officeId = text(record.officeId);
  if (officeId) config.officeId = officeId;
  const jurisdictionGeoid = text(record.jurisdictionGeoid);
  if (jurisdictionGeoid) config.jurisdictionGeoid = jurisdictionGeoid;
  const selectors = selectorsOf(record.selectors);
  if (selectors) config.selectors = selectors;
  return config;
}

function selectorsOf(value: unknown): PageSelectors | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const selectors: PageSelectors = {};
  const name = selectorOf(record.name);
  const title = selectorOf(record.title);
  const phone = selectorOf(record.phone);
  const email = selectorOf(record.email);
  const address = selectorOf(record.address);
  if (name) selectors.name = name;
  if (title) selectors.title = title;
  if (phone) selectors.phone = phone;
  if (email) selectors.email = email;
  if (address) selectors.address = address;
  return Object.keys(selectors).length > 0 ? selectors : undefined;
}

function selectorOf(value: unknown): Selector | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.tag !== 'string' || record.tag.trim().length === 0) return undefined;
  const selector: Selector = { tag: record.tag.trim() };
  if (typeof record.className === 'string' && record.className.trim().length > 0) selector.className = record.className.trim();
  if (typeof record.attr === 'string' && record.attr.trim().length > 0) selector.attr = record.attr.trim();
  return selector;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return objectValue(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
