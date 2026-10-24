/**
 * Reuse-Block Copy Buttons
 *
 * Shared by the description, entity and place detail pages. Each
 * `.reuse-copy-btn` in a page's Reuse block carries the URL to copy in
 * `data-copy-url` (a METS or IIIF manifest on a description page, an
 * EAC-CPF or Linked Places record on an entity or place page). A click
 * copies the URL to the clipboard, swaps the icon to a check mark and
 * the label to the "Copied" confirmation, then restores the button after
 * two seconds. The script is loaded as a classic `<script>` tag (no ES
 * module imports) and self-runs on `DOMContentLoaded`.
 *
 * i18n / single-source: the confirmation text is read from each button's
 * data-i18n-copied attribute (description.copied), injected by the
 * template — blob-only, no Spanish fallback. Spanish lives only in
 * es.toml.
 *
 * @version v1.5.0
 */

document.addEventListener("DOMContentLoaded", function() {
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
});

// Version: v1.5.0
