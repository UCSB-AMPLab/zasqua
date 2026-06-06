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
 * @version v1.3.0
 */

// Main page logic — shard loading, role filters, description list with sort
(async function() {
  var timelineEl = document.getElementById('place-timeline');
  if (!timelineEl) return;

  var placeId = timelineEl.dataset.placeId;
  if (!placeId) return;

  // Locale-aware formatters (read from <html lang>; fallback es-CO).
  var locale = document.documentElement.lang || 'es-CO';
  var coll = new Intl.Collator(locale);
  var monthFmt = new Intl.DateTimeFormat(locale, { month: 'long' });
  var noDateLabel = timelineEl.dataset.noDateLabel;

  // Client-i18n blob (shardError/filteredEmpty/selectedClose/dateConnector),
  // injected by lugar/single.html — single source, blob-only.
  var i18n = {};
  try { i18n = JSON.parse(timelineEl.dataset.i18n || '{}'); } catch (e) { /* keep {} */ }

  // Place-role labels keyed by the raw role code, sourced from
  // ui.yaml.placeRoles via data-place-role-labels — drops the former inline
  // Spanish map so the vocab is single-sourced.
  var placeRoleLabels = {};
  try { placeRoleLabels = JSON.parse(timelineEl.dataset.placeRoleLabels || '{}'); } catch (e) { /* keep {} */ }

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
    var labelGroups = {};
    for (var i = 0; i < allLinks.length; i++) {
      var r = allLinks[i].role || 'unknown';
      var label = placeRoleLabels[r] || r;
      if (!labelGroups[label]) labelGroups[label] = { roles: [], count: 0 };
      if (labelGroups[label].roles.indexOf(r) === -1) labelGroups[label].roles.push(r);
      labelGroups[label].count++;
    }

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
    ? links.filter(function(l) { return activeRoles.has(l.role || 'unknown'); })
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
    var roleLabel = (typeof placeRoleLabels !== 'undefined' ? placeRoleLabels[link.role] : null) || link.role;
    html += '<span class="timeline-role-badge">' + escapeHtml(roleLabel) + '</span>';
  }
  html += '<a href="/' + slug + '/" class="timeline-title">' + escapeHtml(link.title) + '</a>';
  html += '<div class="timeline-ref">' + escapeHtml(link.reference_code) + '</div>';
  html += '</div>';

  html += '</div>';
  return html;
}

function formatDate(dateStr) {
  if (!dateStr) return '';

  if (dateStr.indexOf(' .. ') !== -1) {
    var parts = dateStr.split(' .. ');
    return formatDate(parts[0]) + ' \u2013 ' + formatDate(parts[1]);
  }

  // Locale-aware date ordering (approved 2026-06-02): es keeps the Spanish
  // "D de Month de YYYY" form glued with i18n.dateConnector (" de "); en (US)
  // renders "Month D, YYYY". Branch on the locale read from <html lang>.
  var isEs = locale.indexOf('es') === 0;
  var conn = i18n.dateConnector;

  var match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    var day = parseInt(match[3], 10);
    var month = monthFmt.format(new Date(2000, parseInt(match[2], 10) - 1, 1));
    return isEs
      ? day + conn + month + conn + match[1]
      : month + ' ' + day + ', ' + match[1];
  }

  var ymMatch = dateStr.match(/^(\d{4})-(\d{2})$/);
  if (ymMatch) {
    var m = monthFmt.format(new Date(2000, parseInt(ymMatch[2], 10) - 1, 1));
    return isEs
      ? m + conn + ymMatch[1]
      : m + ' ' + ymMatch[1];
  }

  return dateStr;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
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

    // Burgundy dot marker
    var markerEl = document.createElement('div');
    markerEl.style.width = '12px';
    markerEl.style.height = '12px';
    markerEl.style.borderRadius = '50%';
    markerEl.style.backgroundColor = '#8B2942';
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
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
})();

// Version: v1.3.0
