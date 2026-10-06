export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function renderNotificationEmail(input: {
  title: string;
  body: string;
  unsubscribeUrl: string;
  openPixelUrl: string;
  clickUrl: string | null;
}): RenderedEmail {
  const linkLine = input.clickUrl ? `\n\nOpen: ${input.clickUrl}` : '';
  const text = `${input.title}\n\n${input.body}${linkLine}\n\nUnsubscribe: ${input.unsubscribeUrl}`;
  const click = input.clickUrl
    ? `<p><a href="${escapeHtml(input.clickUrl)}">View</a></p>`
    : '';
  const html = `<!doctype html><html><body><h1>${escapeHtml(input.title)}</h1><p>${escapeHtml(input.body)}</p>${click}<p><a href="${escapeHtml(input.unsubscribeUrl)}">Unsubscribe</a></p><img src="${escapeHtml(input.openPixelUrl)}" width="1" height="1" alt="" /></body></html>`;
  return { subject: input.title, text, html };
}

export function renderPush(input: { title: string; body: string; link: string | null }): {
  title: string;
  body: string;
  link: string | null;
} {
  return { title: input.title.slice(0, 120), body: input.body.slice(0, 240), link: input.link };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
