import type { Selector } from './types.js';

export function extractElements(html: string, selector: Selector): string[] {
  const tag = selector.tag.toLowerCase();
  const lower = html.toLowerCase();
  const blocks: string[] = [];
  let from = 0;
  while (from < html.length) {
    const open = lower.indexOf(`<${tag}`, from);
    if (open < 0) break;
    const openEnd = html.indexOf('>', open);
    if (openEnd < 0) break;
    const openTag = html.slice(open, openEnd + 1);
    if (selector.className && !hasClass(openTag, selector.className)) {
      from = openEnd + 1;
      continue;
    }
    if (selector.attr) {
      const value = attrValue(openTag, selector.attr);
      if (value !== undefined) blocks.push(value);
      from = openEnd + 1;
      continue;
    }
    const closeAt = findClose(lower, tag, openEnd + 1);
    blocks.push(html.slice(openEnd + 1, closeAt));
    from = closeAt;
  }
  return blocks;
}

export function textContent(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractField(block: string, selector: Selector): string | undefined {
  const [first] = extractElements(block, selector);
  if (first === undefined) return undefined;
  if (selector.attr) return first.trim();
  const text = textContent(first);
  return text.length > 0 ? text : undefined;
}

function hasClass(openTag: string, className: string): boolean {
  const value = attrValue(openTag, 'class');
  if (!value) return false;
  return value.split(/\s+/).includes(className);
}

function attrValue(openTag: string, name: string): string | undefined {
  const pattern = new RegExp(`${escapeRegExp(name)}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');
  const match = pattern.exec(openTag);
  return match?.[2] ?? match?.[3];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findClose(lower: string, tag: string, from: number): number {
  const openToken = `<${tag}`;
  const closeToken = `</${tag}`;
  let depth = 1;
  let cursor = from;
  while (cursor < lower.length && depth > 0) {
    const nextOpen = lower.indexOf(openToken, cursor);
    const nextClose = lower.indexOf(closeToken, cursor);
    if (nextClose < 0) return lower.length;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1;
      cursor = nextOpen + openToken.length;
      continue;
    }
    depth -= 1;
    cursor = nextClose + closeToken.length;
    if (depth === 0) return nextClose;
  }
  return lower.length;
}
