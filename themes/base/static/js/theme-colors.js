/**
 * Theme Colour and Font Reader
 *
 * This module deals with handing the site's graph and map colours to the
 * scripts that draw on a canvas or a map, which cannot use CSS custom
 * properties directly. The entity graphs (`entity.js`,
 * `infinite-bipartite-explorer.js`) and the place maps (`place.js`,
 * `place-explorer.js`) call `window.zasquaThemeColor(name)` for each
 * colour they draw with.
 *
 * `zasquaThemeColor(name)` reads the custom property `--<name>` from the
 * document element's computed style, which the browser has already
 * resolved through any var() chain (so `--graph-person`, defined in
 * base.css as the primary colour, comes back as the site's primary hex
 * value). When the stylesheet does not set the property — a site that
 * replaces base.css entirely — it returns a neutral grey from the table
 * below.
 *
 * The tokens and their defaults are declared in
 * `themes/base/assets/css/base.css` (the `--graph-*` and `--map-*`
 * block); a site overrides them in a `:root` rule. Map colours go to
 * MapLibre, which accepts hex, rgb() and hsl() values but not every CSS
 * colour syntax, so sites should set those tokens in one of those forms.
 *
 * `zasquaThemeFont(element)` returns the font family the browser has
 * computed for an element (the document body when none is given), so the
 * graphs can draw canvas labels in the same family as the page text
 * around them; a canvas does not inherit the page's CSS font. With no
 * computed family it returns the generic `sans-serif`.
 *
 * The layout shell (`_default/baseof.html`) loads this file on every page
 * before the page scripts.
 *
 * @version v1.6.0
 */
(function () {
  'use strict';

  var NEUTRAL = {
    'graph-person': '#666',
    'graph-corporate': '#999',
    'graph-document': '#aaa',
    'graph-document-hover': '#777',
    'graph-document-dimmed': '#e5e5e5',
    'graph-entity-dimmed': '#ddd',
    'graph-node-fill': '#fff',
    'graph-link': '#e0e0e0',
    'graph-link-faint': 'rgba(150, 150, 150, 0.3)',
    'map-marker': '#666'
  };

  window.zasquaThemeColor = function (name) {
    var value = '';
    try {
      value = getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim();
    } catch (e) { /* no computed style available; use the default */ }
    return value || NEUTRAL[name] || '#888';
  };

  window.zasquaThemeFont = function (element) {
    var family = '';
    try {
      family = getComputedStyle(element || document.body).fontFamily || '';
    } catch (e) { /* no computed style available; use the generic family */ }
    return family.trim() || 'sans-serif';
  };
})();

// Version: v1.6.0
