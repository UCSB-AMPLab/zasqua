/**
 * Place Detail Page Controller (`/{place_code}/`)
 *
 * Drives the place detail page. Renders the linked-descriptions
 * list with role filters and a three-bucket chronological or
 * alphabetical sort. Companion to the MapTiler map rendered by the
 * place detail layout.
 *
 * Pipeline context:
 *   - `/data/place-links/{place_code}.json` — the focal shard,
 *     emitted per-place by `scripts/precompute-links.js` from the
 *     backend's flat `place_links.json`. Each shard entry carries
 *     `date_expression` (freeform Spanish) for display and
 *     `date_start` (ISO YYYY-MM-DD) for chronological sorting.
 *
 * Three-bucket chronological sort: before v1.0.0 the sort did a
 * single string-sort on `date_expression`, which is not actually
 * chronological — "12 y 13 de junio de 1756" sorts before
 * "1500-1602", and a negative-year string like "-1587" sorts
 * before anything else. The backend now ships `date_start` as an
 * ISO YYYY-MM-DD string on every record that has a usable date.
 * The sort block splits records into three buckets:
 * `date_start`-sorted (truthfully chronological),
 * `date_expression`-only (fallback for pre-fix exports), and
 * undated ("Sin fecha") at the tail. Display still uses
 * `date_expression`; only the sort key changes.
 *
 * @version v1.6.0
 */

// Main page logic — shard loading, role filters, description list with sort
// label-map:start
// A code → label map read from a data-*-labels attribute. The map has no
// prototype, so a code such as "constructor" or "toString" finds no
// inherited value and `labels[code] || code` falls back to the code. Only
// string values are kept; a missing or malformed attribute gives an empty
// map.
function parseLabelMap(raw) {
  var map = Object.create(null);
  if (!raw) return map;
  var parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return map; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return map;
  Object.keys(parsed).forEach(function (key) {
    if (typeof parsed[key] === 'string') map[key] = parsed[key];
  });
  return map;
}
// label-map:end

// role-label-groups:start
// Place-role codes are compared in lowercase everywhere: in the pills, the
// filter and the label lookups, as in the vocab partial, which lowercases
// the export's role codes. roleCode gives that form ('' for a link without
// a role).
function roleCode(role) {
  return role ? String(role).toLowerCase() : '';
}

// The links grouped by the display label of their place role, so roles
// that share a label (subject/mentioned) make one pill. Returns a map of
// label → { roles, count } with no prototype, so a label or code such as
// "constructor" is grouped like any other. A link without a role counts
// as 'unknown'.
function groupRolesByLabel(links, labels) {
  var groups = Object.create(null);
  for (var i = 0; i < links.length; i++) {
    var r = roleCode(links[i].role) || 'unknown';
    var label = labels[r] || r;
    if (!groups[label]) groups[label] = { roles: [], count: 0 };
    if (groups[label].roles.indexOf(r) === -1) groups[label].roles.push(r);
    groups[label].count++;
  }
  return groups;
}
// role-label-groups:end

(async function() {
  var timelineEl = document.getElementById('place-timeline');
  if (!timelineEl) return;

  var placeId = timelineEl.dataset.placeId;
  if (!placeId) return;

  // Locale-aware formatters, in the language of <html lang>, which the
  // layout always sets; 'en' covers a page without one.
  var locale = document.documentElement.lang || 'en';
  var coll = new Intl.Collator(locale);
  var noDateLabel = timelineEl.dataset.noDateLabel;

  // Client-i18n blob (shardError/filteredEmpty/selectedClose/dateConnector),
  // injected by lugar/single.html — single source, blob-only.
  var i18n = {};
  try { i18n = JSON.parse(timelineEl.dataset.i18n || '{}'); } catch (e) { /* keep {} */ }

  // Place-role labels keyed by the raw role code, sourced from
  // ui.yaml.placeRoles via data-place-role-labels — drops the former inline
  // Spanish map so the vocab is single-sourced.
  var placeRoleLabels = parseLabelMap(timelineEl.dataset.placeRoleLabels);

  var links;
  try {
    var res = await fetch('/data/place-links/' + placeId + '.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    links = await res.json();
  } catch (err) {
    console.error('[place] Failed to load shard:', err);
    timelineEl.innerHTML = '<p class="text-stone-500 text-sm">' + escapeHtml(i18n.shardError) + '</p>';
    return;
  }

  // State
  var activeRoles = new Set();
  var sortMode = 'chronological';

  // Set description count \u2014 singular/plural noun selected via CLDR PluralRules
  // from the place.linkedDescriptionsCount {one,other} sub-table, injected
  // blob-only by lugar/single.html. No Spanish fallback.
  var countEl = document.getElementById('place-desc-count');
  if (countEl) {
    var _ldc = i18n.linkedDescriptionsCount || {};
    var _ldcForm = _ldc[new Intl.PluralRules(locale.split('-')[0]).select(links.length)] || _ldc.other || '';
    countEl.textContent = links.length + ' ' + _ldcForm;
  }

  // Wire sort buttons
  var sortBtns = document.querySelectorAll('#place-description-sort .sort-btn');
  sortBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      sortMode = btn.getAttribute('data-sort');
      sortBtns.forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      renderDescriptionList(timelineEl, links, activeRoles, sortMode);
    });
  });

  buildRoleFilters(links);
  renderDescriptionList(timelineEl, links, activeRoles, sortMode);

  // --- Role filters (pills) ---

  function buildRoleFilters(allLinks) {
    var filtersEl = document.getElementById('place-role-filters');
    if (!filtersEl) return;

    // Group roles by display label so duplicates (e.g. subject/mentioned) merge into one pill
    var labelGroups = groupRolesByLabel(allLinks, placeRoleLabels);

    var labels = Object.keys(labelGroups).sort(function(a, b) {
      return labelGroups[b].count - labelGroups[a].count;
    });

    filtersEl.innerHTML = '';
    for (var j = 0; j < labels.length; j++) {
      var group = labelGroups[labels[j]];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'entity-role-btn';
      btn.dataset.roles = group.roles.join(',');
      btn.textContent = labels[j] + ' (' + group.count + ')';
      btn.addEventListener('click', function() {
        var rs = this.dataset.roles.split(',');
        var allActive = rs.every(function(r) { return activeRoles.has(r); });
        if (allActive) {
          rs.forEach(function(r) { activeRoles.delete(r); });
          this.classList.remove('active');
        } else {
          rs.forEach(function(r) { activeRoles.add(r); });
          this.classList.add('active');
        }
        renderDescriptionList(timelineEl, links, activeRoles, sortMode);
      });
      filtersEl.appendChild(btn);
    }

  }

  // --- Description list rendering ---

function renderDescriptionList(container, links, activeRoles, sortMode) {
  var filtered = activeRoles && activeRoles.size > 0
    ? links.filter(function(l) { return activeRoles.has(roleCode(l.role) || 'unknown'); })
    : links;

  if (!filtered || filtered.length === 0) {
    container.innerHTML = '<p class="text-stone-500 text-sm" style="padding:16px 0">' + escapeHtml(i18n.filteredEmpty) + '</p>';
    return;
  }

  var html = '';

  if (sortMode === 'alphabetical') {
    // Alphabetical: sort all entries by title, no date grouping
    var sorted = filtered.slice().sort(function(a, b) {
      return coll.compare(a.title || '', b.title || '');
    });
    for (var i = 0; i < sorted.length; i++) {
      html += renderTimelineEntry(sorted[i], i === sorted.length - 1, true);
    }
  } else {
    // Three-bucket chronological sort (2026-04-20 fix):
    //   1. date_start (ISO YYYY-MM-DD from backend) — true chronological order.
    //   2. date_expression only — freeform Spanish string sort as a fallback
    //      for records whose backend export predates the date_start field.
    //   3. Sin fecha — no usable date on either field.
    // Display still uses date_expression; only the sort key changes.
    var datedByStart = [];
    var datedByExprOnly = [];
    var undated = [];
    for (var j = 0; j < filtered.length; j++) {
      if (filtered[j].date_start) {
        datedByStart.push(filtered[j]);
      } else if (filtered[j].date_expression) {
        datedByExprOnly.push(filtered[j]);
      } else {
        undated.push(filtered[j]);
      }
    }

    datedByStart.sort(function(a, b) {
      return a.date_start.localeCompare(b.date_start);
    });
    datedByExprOnly.sort(function(a, b) {
      return a.date_expression.localeCompare(b.date_expression);
    });

    var all = datedByStart.concat(datedByExprOnly, undated.length > 0 ? [null] : [], undated);
    for (var k = 0; k < all.length; k++) {
      if (all[k] === null) {
        html += '<div class="timeline-no-date">' + noDateLabel + '</div>';
        continue;
      }
      html += renderTimelineEntry(all[k], k === all.length - 1);
    }
  }

  container.innerHTML = html;
}

function renderTimelineEntry(link, isLast, hideTrack) {
  var slug = link.reference_code.replace(/[?#]/g, '');
  var html = '<div class="timeline-entry' + (isLast ? ' timeline-entry-last' : '') + '">';

  if (!hideTrack) {
    html += '<div class="timeline-track">';
    html += '<div class="timeline-dot"><div class="timeline-dot-inner"></div></div>';
    if (!isLast) html += '<div class="timeline-line"></div>';
    html += '</div>';
  }

  html += '<div class="timeline-card">';
  if (link.date_expression) {
    html += '<div class="timeline-date">' + escapeHtml(formatDate(link.date_expression)) + '</div>';
  }
  if (link.role) {
    var roleLabel = (typeof placeRoleLabels !== 'undefined' ? placeRoleLabels[roleCode(link.role)] : null) || link.role;
    html += '<span class="timeline-role-badge">' + escapeHtml(roleLabel) + '</span>';
  }
  html += '<a href="/' + slug + '/" class="timeline-title">' + escapeHtml(link.title) + '</a>';
  html += '<div class="timeline-ref">' + escapeHtml(link.reference_code) + '</div>';
  html += '</div>';

  html += '</div>';
  return html;
}

// Dates on the place timeline read as they do on the record and entity
// pages: in the page's language, through narrativeDate below.
function formatDate(dateStr) {
  return narrativeDate(dateStr, locale);
}

// narrative-date:start
// Formats an archival date string ("1723-03-15", "1723-03", or a range
// joined by " .. ") as prose in `locale`, with the month names and word
// order Intl takes from CLDR: "15 de marzo de 1723" in es-CO, "March 15,
// 1723" in en-US. The year is copied from the input so that years before
// 1000 keep four digits. Anything else passes through unchanged. This
// block is identical in entity.js, infinite-bipartite-explorer.js and
// place.js, and matches scripts/enrichment/date-format.js; tests check all four.
var _narrativeDateFmts = {};
function narrativeDate(dateStr, locale) {
  if (!dateStr) return '';
  if (dateStr.indexOf(' .. ') !== -1) {
    var range = dateStr.split(' .. ');
    return narrativeDate(range[0], locale) + ' – ' + narrativeDate(range[1], locale);
  }
  var m = dateStr.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!m) return dateStr;
  var month = parseInt(m[2], 10);
  var day = m[3] ? parseInt(m[3], 10) : 0;
  if (month < 1 || month > 12) return dateStr;
  // 2000 is a leap year, so 29 February is a valid stand-in date.
  var date = new Date(Date.UTC(2000, month - 1, day || 1));
  if (day && date.getUTCDate() !== day) return dateStr;
  var key = (locale || '') + (day ? '|ymd' : '|ym');
  if (!_narrativeDateFmts[key]) {
    var opts = { timeZone: 'UTC', calendar: 'gregory', year: 'numeric', month: 'long' };
    if (day) opts.day = 'numeric';
    _narrativeDateFmts[key] = new Intl.DateTimeFormat(locale || undefined, opts);
  }
  var year = m[1];
  return _narrativeDateFmts[key].formatToParts(date).map(function (p) {
    return p.type === 'year' ? year : p.value;
  }).join('');
}
// narrative-date:end

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
}

})();

// Map initialisation — custom MapTiler Topo basemap + click tooltip
(function() {
  var mapEl = document.getElementById('place-map');
  if (!mapEl || typeof maplibregl === 'undefined') return;

  // Client-i18n blob lives on #place-timeline; read the close-aria string from
  // it here too (single source, blob-only).
  var i18n = {};
  var timelineEl = document.getElementById('place-timeline');
  if (timelineEl) {
    try { i18n = JSON.parse(timelineEl.dataset.i18n || '{}'); } catch (e) { /* keep {} */ }
  }

  try {
    var lat = parseFloat(mapEl.dataset.lat);
    var lon = parseFloat(mapEl.dataset.lon);
    if (isNaN(lat) || isNaN(lon)) return;

    var placeName = mapEl.dataset.placeName || '';
    var placeType = mapEl.dataset.placeType || '';

    // Basemap: custom MapTiler Topo style. Style ID + API key come from
    // hugo.toml [params] via `data-maptiler-*` attributes on the map element;
    // the key is origin-restricted server-side at MapTiler.
    var maptilerKey = mapEl.dataset.maptilerKey || '';
    var maptilerStyleId = mapEl.dataset.maptilerStyleId || '';
    var maptilerStyleUrl = 'https://api.maptiler.com/maps/' + maptilerStyleId + '/style.json?key=' + maptilerKey;
    var map = new maplibregl.Map({
      container: 'place-map',
      style: maptilerStyleUrl,
      center: [lon, lat],
      zoom: 7,
      renderWorldCopies: false
    });

    // Dot marker in the theme's map-marker colour (theme-colors.js; the
    // grey stands in if a layout omits that script)
    var markerColor = window.zasquaThemeColor ? window.zasquaThemeColor('map-marker') : '#888';
    var markerEl = document.createElement('div');
    markerEl.style.width = '12px';
    markerEl.style.height = '12px';
    markerEl.style.borderRadius = '50%';
    markerEl.style.backgroundColor = markerColor;
    markerEl.style.border = '2px solid #FFFFFF';
    markerEl.style.cursor = 'pointer';

    new maplibregl.Marker({ element: markerEl })
      .setLngLat([lon, lat])
      .addTo(map);

    // Click-to-pin tooltip
    var activeTooltip = null;
    var mapContainer = mapEl;

    function dismissTooltip() {
      if (activeTooltip) { activeTooltip.remove(); activeTooltip = null; }
    }

    markerEl.addEventListener('click', function(e) {
      e.stopPropagation();
      dismissTooltip();

      var tooltip = document.createElement('div');
      tooltip.className = 'graph-tooltip map-tooltip';

      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'map-tooltip-close';
      closeBtn.setAttribute('aria-label', i18n.selectedClose);
      closeBtn.textContent = '\u00D7';
      closeBtn.addEventListener('click', function(ev) {
        ev.stopPropagation();
        dismissTooltip();
      });

      var content = document.createElement('div');
      content.innerHTML =
        '<strong style="font-size:0.95rem">' + escapeHtml(placeName) + '</strong>' +
        '<br><span style="font-size:0.8rem;color:#57534e">' + escapeHtml(placeType) + '</span>';

      tooltip.appendChild(closeBtn);
      tooltip.appendChild(content);

      // Position tooltip above marker
      var pt = map.project([lon, lat]);
      tooltip.style.position = 'absolute';
      tooltip.style.left = pt.x + 'px';
      tooltip.style.top = (pt.y - 10) + 'px';
      tooltip.style.transform = 'translate(-50%, -100%)';
      tooltip.style.zIndex = '10';
      mapContainer.style.position = 'relative';
      mapContainer.appendChild(tooltip);
      activeTooltip = tooltip;

      // Dismiss on map pan
      map.once('movestart', dismissTooltip);
    });

  } catch (e) {
    console.error('[place] Map init failed:', e);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
})();

// Version: v1.6.0
