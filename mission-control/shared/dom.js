// shared/dom.js
// A tiny helper for building DOM nodes without ever touching innerHTML.
// Tab titles and URLs are attacker-controllable strings (any website can
// set its own <title>), so every page in this extension builds elements
// with createElement + textContent rather than string-concatenated HTML.
// This file is the one exception that's allowed to think about that.

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * el('div', { class: 'panel', dataset: { index: 3 } }, ['hello', otherNode])
 * - props.ns === 'svg' -> creates the element in the SVG namespace (required
 *   for <svg>, <circle>, <path>, etc. — document.createElement won't work for these)
 * - props.class / props.className -> class attribute (set via setAttribute so
 *   it works identically for HTML and SVG elements)
 * - props.dataset -> dataset.* entries (HTML elements only)
 * - props.on -> { click: fn, ... } event listeners
 * - any other prop is set via setAttribute (style strings, href, src, type, etc.)
 * - children: strings become text nodes, falsy entries are skipped, nodes are appended as-is
 */
export function el(tag, props = {}, children = []) {
  const node = props && props.ns === 'svg' ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);

  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'ns') continue;
    if (key === 'class' || key === 'className') {
      node.setAttribute('class', value);
    } else if (key === 'dataset') {
      for (const [dKey, dVal] of Object.entries(value)) node.dataset[dKey] = dVal;
    } else if (key === 'on') {
      for (const [evt, handler] of Object.entries(value)) node.addEventListener(evt, handler);
    } else if (key === 'html') {
      // Explicit escape hatch for trusted, hand-authored static markup only
      // (e.g. a literal inline SVG string). Never pass dynamic/user content here.
      node.innerHTML = value;
    } else {
      node.setAttribute(key, value);
    }
  }

  const kids = Array.isArray(children) ? children : [children];
  for (const child of kids) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }

  return node;
}

/** Removes all children of a node. */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Convenience: replace a node's children in one call. */
export function setChildren(node, children) {
  clear(node);
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
}
