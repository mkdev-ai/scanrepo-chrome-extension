// @vitest-environment jsdom
//
// Regression guard for SCB-4: the icon rendered slightly high until content.css
// arrived. The extension injected the button and the stylesheet together, but a <link>
// is fetched asynchronously, so for the first few frames the button painted with UA
// defaults — `display:block` with an `inline` icon — which puts the SVG on the text
// baseline, ~3px above the button's centre.
//
// buildButton() now applies the centring declarations inline, so the very first paint is
// correct. These tests pin that layout and fail if it drifts from content.css.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BUTTON_ID,
  BUTTON_LAYOUT,
  ICON_LAYOUT,
  SPINNER_LAYOUT,
  buildButton,
} from '../../src/content/button.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The declaration block for a selector, so drift from content.css is detectable. */
function cssBlock(selector) {
  const css = readFileSync(path.join(root, 'src/content/content.css'), 'utf8');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `no rule for ${selector} in content.css`).not.toBeNull();
  return match[1];
}

/** Declarations parsed into a property -> value map. */
function declarations(block) {
  /** @type {Record<string, string>} */
  const found = {};
  for (const entry of block.split(';')) {
    const [property, value] = entry.split(':');
    if (property && value) found[property.trim()] = value.trim();
  }
  return found;
}

/** Inline layout actually present on an element, as the browser will use it. */
function inlineLayout(/** @type {HTMLElement} */ el) {
  /** @type {Record<string, string>} */
  const found = {};
  for (let i = 0; i < el.style.length; i++) {
    const property = el.style.item(i);
    found[property] = el.style.getPropertyValue(property);
  }
  return found;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('buildButton', () => {
  it('keeps its identity and native GitHub styling', () => {
    const button = buildButton();
    expect(button.id).toBe(BUTTON_ID);
    expect(button.className).toBe('btn btn-sm scanrepo-btn');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders the icon, label and spinner', () => {
    const button = buildButton();
    expect(button.querySelector('.scanrepo-btn-icon svg')).not.toBeNull();
    expect(button.querySelector('.scanrepo-btn-label').textContent).toBe('Scan this repo');
    expect(button.querySelector('.scanrepo-btn-spinner').hasAttribute('hidden')).toBe(true);
  });

  it('centres the button and its icon without waiting for content.css', () => {
    const button = buildButton();
    expect(inlineLayout(button)).toMatchObject(BUTTON_LAYOUT);
    expect(inlineLayout(button.querySelector('.scanrepo-btn-icon'))).toMatchObject(ICON_LAYOUT);
  });

  it('reserves the spinner box without waiting for content.css', () => {
    const button = buildButton();
    expect(inlineLayout(button.querySelector('.scanrepo-btn-spinner'))).toMatchObject(SPINNER_LAYOUT);
  });
});

describe('the inline layout mirrors content.css', () => {
  it('matches .scanrepo-btn', () => {
    const declared = declarations(cssBlock('.scanrepo-btn'));
    for (const [property, value] of Object.entries(BUTTON_LAYOUT)) {
      expect(declared[property], `.scanrepo-btn is missing ${property}`).toBe(value);
    }
  });

  it('matches .scanrepo-btn-icon', () => {
    const declared = declarations(cssBlock('.scanrepo-btn-icon'));
    for (const [property, value] of Object.entries(ICON_LAYOUT)) {
      expect(declared[property], `.scanrepo-btn-icon is missing ${property}`).toBe(value);
    }
  });

  it('matches .scanrepo-btn-spinner geometry', () => {
    const declared = declarations(cssBlock('.scanrepo-btn-spinner'));
    for (const [property, value] of Object.entries(SPINNER_LAYOUT)) {
      expect(declared[property], `.scanrepo-btn-spinner is missing ${property}`).toBe(value);
    }
  });
});