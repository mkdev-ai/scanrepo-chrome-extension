import { describe, expect, it } from 'vitest';
import { parseRepoFromUrl, toScanSlug } from '../../src/lib/parse.js';

describe('parseRepoFromUrl', () => {
  it('parses a canonical repo URL', () => {
    expect(parseRepoFromUrl('https://github.com/facebook/react')).toEqual({
      owner: 'facebook',
      repo: 'react',
      provider: 'github',
    });
  });

  it('accepts deep paths into a repo', () => {
    expect(parseRepoFromUrl('https://github.com/owner/repo/tree/main/src')?.repo).toBe('repo');
    expect(parseRepoFromUrl('https://github.com/owner/repo/issues/12')?.owner).toBe('owner');
  });

  it('tolerates www and a trailing slash', () => {
    expect(parseRepoFromUrl('https://www.github.com/owner/repo/')?.repo).toBe('repo');
  });

  it('parses relative paths', () => {
    expect(parseRepoFromUrl('/owner/repo')?.owner).toBe('owner');
  });

  it('allows dots, underscores and hyphens in repo names', () => {
    expect(parseRepoFromUrl('https://github.com/owner/my_repo.js')?.repo).toBe('my_repo.js');
  });

  it.each([
    ['site routes are not repos', 'https://github.com/settings/profile'],
    ['bare profile pages', 'https://github.com/torvalds'],
    ['the trending page', 'https://github.com/trending'],
    ['explore', 'https://github.com/explore'],
    ['orgs', 'https://github.com/orgs/nodejs'],
    ['the root', 'https://github.com/'],
    ['a different host', 'https://gitlab.com/owner/repo'],
    ['the api host', 'https://api.github.com/repos/owner/repo'],
    ['a lookalike host', 'https://github.com.evil.test/owner/repo'],
  ])('returns null for %s', (_label, href) => {
    expect(parseRepoFromUrl(href)).toBeNull();
  });

  it('rejects a .git suffix', () => {
    expect(parseRepoFromUrl('https://github.com/owner/repo.git')).toBeNull();
  });

  it('rejects invalid owner characters', () => {
    expect(parseRepoFromUrl('https://github.com/ow ner/repo')).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(parseRepoFromUrl('')).toBeNull();
    expect(parseRepoFromUrl('not a url')).toBeNull();
  });
});

describe('toScanSlug', () => {
  it('builds a github slug', () => {
    expect(toScanSlug({ owner: 'a', repo: 'b' })).toBe('github.com/a/b');
  });

  it('builds a bitbucket slug', () => {
    expect(toScanSlug({ owner: 'a', repo: 'b', provider: 'bitbucket' })).toBe('bitbucket.org/a/b');
  });
});