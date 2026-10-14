// Serves the privacy policy and terms at /privacy and /terms (public; Apple needs the URLs).
// Who runs Autocut comes from the server's environment, so personal details never live in git:
//   LEGAL_OPERATOR  e.g. "Rishav Vashisht" or a company name
//   LEGAL_EMAIL     the contact address for privacy and support requests
//   LEGAL_COUNTRY   e.g. "India" (governing law and contact line)
import { readFile } from 'node:fs/promises';

const UPDATED = '14 October 2026';
const DIR = new URL('../legal/', import.meta.url);

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function legalPage(name) {
  if (name !== 'privacy' && name !== 'terms') return null;
  const values = {
    OPERATOR: process.env.LEGAL_OPERATOR || '[operator name]',
    EMAIL: process.env.LEGAL_EMAIL || '[contact email]',
    COUNTRY: process.env.LEGAL_COUNTRY || '[country]',
    RETENTION_DAYS: process.env.RETENTION_DAYS || '7',
    UPDATED,
  };
  const body = (await readFile(new URL(`${name}.html`, DIR), 'utf8')).replace(/\{\{(\w+)\}\}/g, (_, k) => escape(values[k] ?? ''));
  const title = name === 'privacy' ? 'Privacy Policy' : 'Terms of Service';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Autocut</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&display=swap" rel="stylesheet">
<style>
  :root { --ink: #111114; --muted: #6b6b73; --line: #ededf0; --bg: #fff; color-scheme: light dark; }
  @media (prefers-color-scheme: dark) { :root { --ink: #f2f2f4; --muted: #a1a1a8; --line: #2a2a2e; --bg: #111114; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif; }
  main { max-width: 680px; margin: 0 auto; padding: 32px 20px 64px; }
  header { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; }
  .mark { width: 28px; height: 28px; border-radius: 7px; background: #111114; display: grid; place-items: center; }
  .mark svg { width: 16px; height: 16px; }
  .brand { font-family: "Bricolage Grotesque", -apple-system, sans-serif; font-weight: 800; letter-spacing: -0.3px; }
  nav { margin-left: auto; display: flex; gap: 14px; font-size: 14px; }
  nav a { color: var(--muted); text-decoration: none; }
  nav a[aria-current] { color: var(--ink); font-weight: 600; }
  h1 { font-size: 30px; line-height: 1.2; letter-spacing: -0.5px; margin: 0 0 4px; }
  h2 { font-size: 19px; margin: 32px 0 6px; letter-spacing: -0.2px; }
  h3 { font-size: 16px; margin: 20px 0 4px; }
  p, li { color: var(--ink); }
  .meta { color: var(--muted); font-size: 14px; margin-top: 0; }
  ul { padding-left: 20px; }
  li { margin: 4px 0; }
  a { color: inherit; }
  footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; }
</style>
</head>
<body>
<main>
<header>
  <div class="mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path fill="#fff" d="M7 4.5v8.3l11.5-6.4L8.6 1.9C7.9 1.5 7 2 7 2.8zM7 15.2v6c0 .8.9 1.3 1.6.9L19 16c.6-.4.6-1.3 0-1.7L17.6 13.5z"/></svg></div>
  <span class="brand">Autocut</span>
  <nav><a href="/privacy"${name === 'privacy' ? ' aria-current="page"' : ''}>Privacy</a><a href="/terms"${name === 'terms' ? ' aria-current="page"' : ''}>Terms</a></nav>
</header>
${body}
<footer>© ${new Date().getFullYear()} ${escape(values.OPERATOR)}</footer>
</main>
</body>
</html>`;
}
