export function slugify(input: string, max = 160): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'item';
}

export function uniqueSlug(base: string, taken: (slug: string) => boolean): string {
  const root = slugify(base);
  if (!taken(root)) return root;
  for (let n = 2; n < 10_000; n += 1) {
    const candidate = slugify(`${root}-${n}`);
    if (!taken(candidate)) return candidate;
  }
  return slugify(`${root}-${Date.now()}`);
}
