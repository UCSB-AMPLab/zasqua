---
title: "Explorar lugares"
build:
  render: "never"
---

<!--
  Place explorer section index.

  Serves /lugares/ via layouts/lugares/list.html. Matches Eleventy
  permalink. Empty body — all rendering happens in the layout.

  MODULE-03 gating: build.render = "never" suppresses this static index page
  so that Hugo does not create a public/lugares/ directory when the section
  is disabled. The lugares/_content.gotmpl conditionally emits the section
  home page via AddPage only when manifest.modules.places is enabled.
  Setting render = "never" here prevents a double-render conflict and ensures
  that core-only builds produce no lugares/ directory in public/.

  Version: v1.2.0
-->
