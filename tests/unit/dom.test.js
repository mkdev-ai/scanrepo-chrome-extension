// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  findActionContainer,
  findCodeButton,
  isPrivateRepo,
  repoFromLocation,
} from '../../src/content/dom.js';

/**
 * Markup shape verified against github.com in 2026-09: the action row is an
 * unlabelled div holding "Go to file", "Code" and a "…" menu, and it lives outside
 * `#repository-container-header`, which now contains only the repo name and the
 * visibility label.
 */
function ripgrepStylePage() {
  document.body.innerHTML = `
    <div id="repository-container-header">
      <span class="author">octocat</span><span>/</span><span>Hello-World</span>
      <span data-testid="visibility-label">Public</span>
    </div>
    <div class="OverviewContent-module__Box_1__MPS0U">
      <div class="OverviewContent-module__Box_6__Y_Yb_">
        <div><button>Go to file</button></div>
        <button id="the-code-button">Code</button>
        <div><button aria-label="Open more actions menu">…</button></div>
      </div>
    </div>`;
}

/** A page where the only "Code" control is the file-view dropdown (no action row). */
function fileViewOnlyPage() {
  document.body.innerHTML = `
    <div id="repository-container-header"><span>Public</span></div>
    <div class="react-code-view-header">
      <button id="file-view-code">Code</button>
    </div>`;
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

describe('findCodeButton', () => {
  it('finds the Code control by its label', () => {
    ripgrepStylePage();
    expect(findCodeButton(document).id).toBe('the-code-button');
  });

  it('prefers the action row over an in-file Code dropdown', () => {
    // Both exist on a repo page; the overview action row comes first in the document.
    ripgrepStylePage();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="react-code-view-header"><button id="file-view-code">Code</button></div>',
    );
    expect(findCodeButton(document).id).toBe('the-code-button');
  });

  it('still finds the Code control when only a file-view dropdown exists', () => {
    fileViewOnlyPage();
    expect(findCodeButton(document).id).toBe('file-view-code');
  });

  it('honours the legacy data-testid attribute when present', () => {
    document.body.innerHTML = `
      <div id="repository-container-header">
        <button data-testid="code-button">Code</button>
      </div>`;
    expect(findCodeButton(document).getAttribute('data-testid')).toBe('code-button');
  });

  it('finds a summary-based Code control (older dropdown variant)', () => {
    document.body.innerHTML = '<div><summary id="code-summary">Code</summary></div>';
    expect(findCodeButton(document).id).toBe('code-summary');
  });

  it('returns null when there is no Code control', () => {
    document.body.innerHTML = '<div id="repository-container-header">octocat/Hello-World</div>';
    expect(findCodeButton(document)).toBeNull();
  });

  it('does not mistake the extension button for the Code control', () => {
    document.body.innerHTML = `
      <div id="repository-container-header">
        <button id="scanrepo-scan-button"><span>Scan this repo</span></button>
      </div>`;
    expect(findCodeButton(document)).toBeNull();
  });

  it('ignores a control whose label merely contains "code"', () => {
    document.body.innerHTML = '<div><button>Download code</button></div>';
    expect(findCodeButton(document)).toBeNull();
  });
});

describe('findActionContainer', () => {
  it('anchors to the parent of the Code control', () => {
    ripgrepStylePage();
    const codeButton = findCodeButton(document);
    const container = findActionContainer(codeButton);
    expect(container.className).toBe('OverviewContent-module__Box_6__Y_Yb_');
    expect([...container.children].map((c) => c.textContent.trim())).toContain('Code');
  });

  it('returns null without a Code control', () => {
    expect(findActionContainer(null)).toBeNull();
  });
});

describe('isPrivateRepo', () => {
  it('reads the octolytics meta tag when present', () => {
    document.head.innerHTML = '<meta name="octolytics-dimension-repository_public" content="false">';
    expect(isPrivateRepo(document)).toBe(true);

    document.head.innerHTML = '<meta name="octolytics-dimension-repository_public" content="true">';
    expect(isPrivateRepo(document)).toBe(false);
  });

  it('reads a Private label in the header', () => {
    document.body.innerHTML = `
      <div id="repository-container-header"><span>Private</span></div>`;
    expect(isPrivateRepo(document)).toBe(true);
  });

  it('reads a Public label in the header', () => {
    document.body.innerHTML = `
      <div id="repository-container-header"><span>Public</span></div>`;
    expect(isPrivateRepo(document)).toBe(false);
  });

  it('does not treat the word "public" inside other text as the visibility label', () => {
    // e.g. a description reading "public domain" must not be read as visibility.
    document.body.innerHTML = `
      <div id="repository-container-header"><span>Public domain utilities</span></div>`;
    expect(isPrivateRepo(document)).toBe(false);
  });

  it('assumes public when no signal is present, letting the scan report otherwise', () => {
    document.body.innerHTML = '<div id="repository-container-header"></div>';
    expect(isPrivateRepo(document)).toBe(false);
  });
});

describe('repoFromLocation', () => {
  it('reads owner and repo from the path name', () => {
    expect(repoFromLocation({ pathname: '/facebook/react' })).toEqual({
      owner: 'facebook',
      repo: 'react',
      provider: 'github',
    });
  });

  it('ignores deeper paths', () => {
    expect(repoFromLocation({ pathname: '/a/b/tree/main' })?.repo).toBe('b');
  });

  it('returns null when the path is too short', () => {
    expect(repoFromLocation({ pathname: '/settings' })).toBeNull();
  });
});