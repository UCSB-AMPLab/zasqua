---
title: "Explorar entidades"
build:
  render: "never"
---

<!--
  Entity explorer section index.

  Serves /entidades/ via layouts/entidades/list.html. Matches Eleventy
  permalink. Empty body — all rendering happens in the layout.

  MODULE-03 gating: build.render = "never" suppresses this static index page
  so that Hugo does not create a public/entidades/ directory when the section
  is disabled. The entidades/_content.gotmpl conditionally emits the section
  home page via AddPage only when manifest.modules.entities is enabled.
  Setting render = "never" here prevents a double-render conflict and ensures
  that core-only builds produce no entidades/ directory in public/.

  Version: v1.2.0
-->
