/**
 * Description Detail Page Controller (`/{reference_code}/`)
 *
 * Drives the description detail page. Two responsibilities: (1)
 * "Copy" button next to the IIIF manifest URL — clicks copy the URL
 * to the clipboard and flash a "Copied" confirmation; (2) embed
 * the TIFY IIIF image viewer when the description has an associated
 * manifest, then inject custom header controls (Expand, Collapse,
 * Full screen, Thumbnails) so the viewer integrates with the rest of
 * the page chrome rather than showing TIFY's default toolbar. The
 * script is loaded as a classic `<script>` tag (no ES module imports)
 * and self-runs on `DOMContentLoaded`.
 *
 * i18n / single-source: all control labels and the copy
 * confirmation are read from data attributes injected by
 * descripcion/single.html — the TIFY labels from the .desc-viewer
 * data-i18n blob (description.tify* keys), the copy confirmation from
 * each copy button's data-i18n-copied (description.copied) — blob-only,
 * no Spanish fallback. Spanish lives only in es.toml.
 *
 * @version v1.4.0
 */

document.addEventListener("DOMContentLoaded", function() {

  // Copy-to-clipboard for IIIF manifest URL
  var copyBtns = document.querySelectorAll(".reuse-copy-btn");
  for (var i = 0; i < copyBtns.length; i++) {
    copyBtns[i].addEventListener("click", function() {
      var btn = this;
      var url = btn.getAttribute("data-copy-url");
      if (!url) return;
      navigator.clipboard.writeText(url).then(function() {
        var icon = btn.querySelector(".material-symbols-outlined");
        var originalHTML = btn.innerHTML;
        icon.textContent = "check";
        // description.copied, injected per button as data-i18n-copied
        // (blob-only, no Spanish fallback).
        btn.lastChild.textContent = btn.getAttribute("data-i18n-copied") || "";
        setTimeout(function() {
          btn.innerHTML = originalHTML;
        }, 2000);
      });
    });
  }

  // IIIF Viewer (TIFY)
  var viewerEl = document.querySelector(".desc-viewer[data-manifest]");
  if (!viewerEl || typeof Tify === "undefined") return;

  var manifestUrl = viewerEl.getAttribute("data-manifest");

  // TIFY control labels from the viewer's data-i18n blob (description.*
  // keys). Blob-only, no Spanish fallback.
  var i18n = {};
  try { i18n = JSON.parse(viewerEl.dataset.i18n || "{}"); } catch (e) {}

  // Init TIFY. Keep the instance handle so the viewer is driven through
  // its public API (ready / setView) rather than by poking its internal
  // DOM and Vue state.
  var tify = new Tify({
    container: ".desc-viewer",
    manifestUrl: manifestUrl,
    colorMode: "dark",
    view: null
  });

  // Trigger viewport recalculation after a layout change
  function resetViewport() {
    setTimeout(function() {
      window.dispatchEvent(new Event("resize"));
    }, 200);
  }

  // TIFY exposes a `ready` promise that resolves once the viewer is
  // mounted and its header DOM exists — the correct signal to inject
  // custom controls. Replaces a fixed setTimeout that could fire before
  // the header rendered on a slow/large manifest, or needlessly late on a
  // fast one.
  tify.ready.then(function() {
    var header = viewerEl.querySelector(".tify-header");
    if (!header) return;

    var columns = header.querySelectorAll(".tify-header-column");
    if (columns.length < 3) return;

    // Custom header buttons (Expand / Collapse / Full screen / Thumbnails)
    // are appended directly into TIFY's internal `.tify-header-column` DOM
    // because TIFY exposes no documented plugin or slot API for custom
    // toolbar controls (upstream issue tify-iiif-viewer/tify#275: maintainers
    // direct users to fork for this class of customization). This is a
    // necessary coupling to TIFY internals — the `.tify-header` /
    // `.tify-header-column` selectors are not public API and must be
    // re-verified whenever the vendored TIFY bundle changes.

    // -- Left group (column 1): size toggle buttons --
    var leftBtns = document.createElement("div");
    leftBtns.className = "viewer-left-btns";
    leftBtns.style.cssText = "display: flex; gap: 0.3rem; align-items: center;";

    var expandBtn = document.createElement("button");
    expandBtn.className = "viewer-pill viewer-pill-expand";
    expandBtn.innerHTML = '<span class="material-symbols-outlined">open_in_full</span> ' + (i18n.tifyExpand || "");
    expandBtn.addEventListener("click", function() {
      document.querySelector(".desc-layout").classList.add("viewer-expanded");
      resetViewport();
    });

    var contraerBtn = document.createElement("button");
    contraerBtn.className = "viewer-pill viewer-pill-contraer";
    contraerBtn.innerHTML = '<span class="material-symbols-outlined">close_fullscreen</span> ' + (i18n.tifyCollapse || "");
    contraerBtn.addEventListener("click", function() {
      document.querySelector(".desc-layout").classList.remove("viewer-expanded");
      resetViewport();
    });

    var fullscreenBtn = document.createElement("button");
    fullscreenBtn.className = "viewer-pill viewer-pill-fullscreen";
    fullscreenBtn.innerHTML = '<span class="material-symbols-outlined">fullscreen</span> ' + (i18n.tifyFullscreen || "");
    fullscreenBtn.addEventListener("click", function() {
      if (document.fullscreenElement === viewerEl) {
        document.exitFullscreen();
      } else {
        viewerEl.requestFullscreen();
      }
    });

    leftBtns.appendChild(expandBtn);
    leftBtns.appendChild(contraerBtn);
    leftBtns.appendChild(fullscreenBtn);
    columns[0].appendChild(leftBtns);

    // -- Right group (column 3): Miniaturas --
    var rightBtns = document.createElement("div");
    rightBtns.className = "viewer-right-btns";
    rightBtns.style.cssText = "gap: 0.3rem; align-items: center;";

    var miniBtn = document.createElement("button");
    miniBtn.className = "viewer-pill viewer-pill-mini";
    miniBtn.innerHTML = '<span class="material-symbols-outlined">grid_view</span> ' + (i18n.tifyThumbnails || "");
    // Toggle TIFY's thumbnails panel through its public setView() API.
    // setView() sets the active view directly and does not toggle, and the
    // open/closed state must be DERIVED at click time, never cached in a
    // local flag: TIFY's own keyboard shortcuts (e.g. the `2` key, bound to
    // the widget root and still active while the native header controls are
    // CSS-hidden) can change the view behind this button. `tify.options` is
    // the same object the viewer's internal store mutates in place on every
    // view change, so `tify.options.view` is a live read of the current
    // panel ("thumbnails" when open; "" or null when closed).
    miniBtn.addEventListener("click", function() {
      var thumbsOpen = tify.options && tify.options.view === "thumbnails";
      tify.setView(thumbsOpen ? null : "thumbnails");
    });

    rightBtns.appendChild(miniBtn);
    columns[2].appendChild(rightBtns);

    // -- Fullscreen label toggle + viewport reset --
    document.addEventListener("fullscreenchange", function() {
      if (document.fullscreenElement === viewerEl) {
        fullscreenBtn.innerHTML = '<span class="material-symbols-outlined">fullscreen_exit</span> ' + (i18n.tifyExitFullscreen || "");
      } else {
        fullscreenBtn.innerHTML = '<span class="material-symbols-outlined">fullscreen</span> ' + (i18n.tifyFullscreen || "");
      }
      resetViewport();
    });

  }).catch(function () {
    // TIFY rejects `ready` when the manifest fails to load (a bad or missing
    // IIIF manifest). The custom toolbar cannot be injected in that case;
    // swallow the rejection so it does not surface as an unhandled promise
    // rejection. The viewer still shows TIFY's own error state.
  });

});

// Version: v1.4.0
