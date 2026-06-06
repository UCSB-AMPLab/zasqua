/**
 * Site Header Controls
 *
 * Two small pieces of interactivity that ride on top of the
 * site-wide header markup: the mobile hamburger menu (toggles the
 * nav open / closed, with close-on-outside-click and close-on-Esc
 * handlers) and the nav dropdown (tap-to-open on mobile, where the
 * desktop CSS :hover version wouldn't work). Both behaviours are
 * loaded as classic `<script>` tags from the base layout on every
 * page and run inside their own IIFEs so their local variables
 * don't leak into the global scope.
 *
 * @version v1.0.0
 */

// Hamburger menu toggle
(function () {
  const btn = document.querySelector('.hamburger-toggle');
  const nav = document.querySelector('.site-nav');
  if (!btn || !nav) return;

  const icon = btn.querySelector('.material-symbols-outlined');

  function open() {
    nav.classList.add('nav-open');
    btn.setAttribute('aria-expanded', 'true');
    if (icon) icon.textContent = 'close';
  }

  function close() {
    nav.classList.remove('nav-open');
    btn.setAttribute('aria-expanded', 'false');
    if (icon) icon.textContent = 'menu';
  }

  btn.addEventListener('click', function () {
    nav.classList.contains('nav-open') ? close() : open();
  });

  // Close on click outside header
  document.addEventListener('click', function (e) {
    if (nav.classList.contains('nav-open') && !e.target.closest('.site-header')) {
      close();
    }
  });

  // Close on Escape
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav.classList.contains('nav-open')) {
      close();
    }
  });
})();

// Nav dropdown toggle (mobile tap, desktop uses CSS :hover)
(function () {
  var dropdown = document.querySelector('.nav-dropdown');
  var trigger = document.querySelector('.nav-dropdown-trigger');
  if (!dropdown || !trigger) return;

  trigger.addEventListener('click', function (e) {
    e.preventDefault();
    dropdown.classList.toggle('dropdown-open');
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.nav-dropdown')) {
      dropdown.classList.remove('dropdown-open');
    }
  });
})();

// Version: v1.0.0
