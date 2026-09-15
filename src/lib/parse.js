// Pure URL/identity helpers. No DOM, no chrome APIs — unit-testable in isolation.

// First path segments on github.com that are site routes, never repository owners.
const RESERVED_ROOTS = new Set([
  'about', 'account', 'apps', 'blog', 'business', 'careers', 'code', 'collections',
  'contact', 'customer-stories', 'dashboard', 'discussions', 'donate', 'education',
  'enterprise', 'events', 'explore', 'features', 'git-lfs', 'github', 'help', 'home',
  'issues', 'join', 'login', 'logout', 'marketplace', 'mobile', 'new', 'notifications',
  'opensource', 'orgs', 'organizations', 'pricing', 'privacy', 'pulls', 'readme',
  'search', 'security', 'sessions', 'settings', 'signup', 'site', 'sitemap', 'sponsors',
  'stars', 'team', 'terms', 'topics', 'trending', 'users', 'watching', 'wiki', 'www',
]);

/**
 * Extract the repository identity from a GitHub URL.
 * @param {string} href absolute or relative URL
 * @returns {{owner: string, repo: string, provider: 'github'} | null}
 */
export function parseRepoFromUrl(href) {
  let url;
  try {
    // Relative paths resolve against the GitHub origin so the helper works both in
    // the content script and in tests without a DOM.
    url = new URL(href, 'https://github.com');
  } catch {
    return null;
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null;

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  const [owner, repo] = segments;
  if (RESERVED_ROOTS.has(owner.toLowerCase())) return null;
  if (RESERVED_ROOTS.has(repo.toLowerCase()) && segments.length === 2) return null;

  // Owner names may only contain alphanumerics and hyphens; repo names add . _ -
  if (!/^[A-Za-z0-9-]+$/.test(owner)) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(repo)) return null;
  if (repo.endsWith('.git')) return null;

  return { owner, repo, provider: 'github' };
}

/** Canonical `github.com/owner/repo` slug the scanrepo API expects.
 * @param {import('../types.js').RepoTarget} target
 * @returns {string}
 */
export function toScanSlug({ owner, repo, provider = 'github' }) {
  const host = provider === 'bitbucket' ? 'bitbucket.org' : 'github.com';
  return `${host}/${owner}/${repo}`;
}