// The "Scan this repo" button: markup plus the layout it cannot wait for.
//
// content.css arrives over an asynchronous <link>, so a button inserted before that
// fetch lands paints with UA defaults: `display:block` on the button and
// `display:inline` on the icon, which drops the 16px SVG onto the text baseline and
// lifts it ~3px above the button's centre. The declarations below are therefore applied
// inline at creation, so the first paint is already centred and stays centred even if
// the stylesheet never loads. content.css keeps the settled look and repeats the same
// declarations; tests/unit/button.test.js fails if the two drift apart.

export const BUTTON_ID = 'scanrepo-scan-button';
export const ICON_CLASS = 'scanrepo-btn-icon';
export const LABEL_CLASS = 'scanrepo-btn-label';
export const SPINNER_CLASS = 'scanrepo-btn-spinner';

/** Mirror of the layout declarations in `.scanrepo-btn`. @type {Record<string, string>} */
export const BUTTON_LAYOUT = {
  display: 'inline-flex',
  'align-items': 'center',
  gap: '6px',
  'margin-right': '8px',
};

/** Mirror of the layout declarations in `.scanrepo-btn-icon`. @type {Record<string, string>} */
export const ICON_LAYOUT = {
  display: 'inline-flex',
  'align-items': 'center',
};

/** Mirror of the box geometry in `.scanrepo-btn-spinner`; the border and colours stay in CSS. @type {Record<string, string>} */
export const SPINNER_LAYOUT = {
  width: '12px',
  height: '12px',
  'border-radius': '50%',
};

const ICON_SVG = `
    <span class="${ICON_CLASS}" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm0 2.5 1.6 3.4 3.7.5-2.7 2.6.7 3.7L8 10.9l-3.3 1.8.7-3.7L2.7 6.4l3.7-.5L8 2.5Z"/>
      </svg>
    </span>`;

/** @param {HTMLElement} el @param {Record<string, string>} declarations */
function applyLayout(el, declarations) {
  for (const [property, value] of Object.entries(declarations)) {
    el.style.setProperty(property, value);
  }
}

/** @returns {HTMLButtonElement} */
export function buildButton() {
  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  // Match GitHub's native action-bar button classes so it inherits Primer styling
  // and the same hover treatment as "Code".
  button.className = 'btn btn-sm scanrepo-btn';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  applyLayout(button, BUTTON_LAYOUT);

  button.innerHTML = `${ICON_SVG}
    <span class="${LABEL_CLASS}">Scan this repo</span>
    <span class="${SPINNER_CLASS}" hidden></span>`;

  const icon = button.querySelector(`.${ICON_CLASS}`);
  if (icon instanceof HTMLElement) applyLayout(icon, ICON_LAYOUT);
  const spinner = button.querySelector(`.${SPINNER_CLASS}`);
  if (spinner instanceof HTMLElement) applyLayout(spinner, SPINNER_LAYOUT);

  return button;
}