/**
 * NASA Mission Control Dashboard
 * Live APIs · ISS tracking · Mission digest · Audio alerts
 */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ---------- State ----------
  let issMap = null;
  let issMarker = null;
  let issTrail = [];
  let issTrailLine = null;
  let eonetMap = null;
  let eonetLayer = null;
  let lastNewsIds = new Set();
  let audioCtx = null;
  let missionFilter = 'all';
  let allMissionItems = [];

  // ---------- Utils ----------
  function formatUTC(d = new Date()) { return d.toISOString().substr(11, 8); }
  function formatLocal(d = new Date()) { return d.toLocaleTimeString('en-GB', { hour12: false }); }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function daysAgoISO(n) {
    const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10);
  }
  function daysAheadISO(n) {
    const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10);
  }

  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }

  function setLastRefresh() {
    $('#last-refresh').textContent = `LAST UPDATE: ${formatUTC()} UTC`;
  }

  // ---------- NASA-style chime (Web Audio) ----------
  function playChime() {
    if (!CONFIG.audioEnabled) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;

      // Two-tone "mission control" style alert
      const tones = [
        { freq: 880, start: 0, dur: 0.12 },
        { freq: 1174.7, start: 0.14, dur: 0.18 },
        { freq: 880, start: 0.36, dur: 0.1 }
      ];

      tones.forEach(t => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = t.freq;
        gain.gain.setValueAtTime(0, now + t.start);
        gain.gain.linearRampToValueAtTime(0.25, now + t.start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + t.start + t.dur);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + t.start);
        osc.stop(now + t.start + t.dur + 0.05);
      });
    } catch (e) {
      console.warn('Audio chime failed', e);
    }
  }

  // ---------- Clocks ----------
  function updateClocks() {
    $('#utc-clock').textContent = formatUTC();
    $('#local-clock').textContent = formatLocal();
  }

  // ---------- APOD ----------
  async function loadAPOD() {
    const mediaEl = $('#apod-media');
    const titleEl = $('#apod-title');
    const explEl = $('#apod-explanation');
    const metaEl = $('#apod-meta');
    const dateBadge = $('#apod-date');
    try {
      const data = await fetchJSON(`${CONFIG.endpoints.apod}?api_key=${CONFIG.API_KEY}`);
      dateBadge.textContent = data.date || '—';
      titleEl.textContent = data.title || 'Untitled';
      explEl.textContent = data.explanation || '';
      let mediaHtml = '';
      if (data.media_type === 'video') {
        const url = data.url || '';
        if (url.includes('youtube') || url.includes('youtu.be')) {
          const embed = url.replace('watch?v=', 'embed/').replace('youtu.be/', 'youtube.com/embed/');
          mediaHtml = `<iframe src="${embed}" frameborder="0" allowfullscreen></iframe>`;
        } else {
          mediaHtml = `<video controls src="${url}"></video>`;
        }
      } else {
        mediaHtml = `<img src="${data.hdurl || data.url}" alt="${data.title || 'APOD'}" loading="lazy" />`;
      }
      mediaEl.innerHTML = mediaHtml;
      let meta = [];
      if (data.copyright) meta.push('© ' + data.copyright);
      if (data.media_type) meta.push(data.media_type.toUpperCase());
      metaEl.textContent = meta.join(' · ');
    } catch (err) {
      console.error('APOD', err);
      mediaEl.innerHTML = `<div class="error-msg">APOD unavailable<br>${err.message}</div>`;
    }
  }

  // ---------- NEO ----------
  async function loadNEO() {
    const tbody = $('#neo-tbody');
    try {
      const start = todayISO();
      const end = daysAheadISO(CONFIG.neoDaysAhead);
      const data = await fetchJSON(`${CONFIG.endpoints.neoFeed}?start_date=${start}&end_date=${end}&api_key=${CONFIG.API_KEY}`);
      const nearObjects = data.near_earth_objects || {};
      let all = [];
      let hazardousCount = 0;
      let minLd = Infinity;

      Object.keys(nearObjects).forEach(date => {
        nearObjects[date].forEach(neo => {
          const approach = neo.close_approach_data?.[0];
          if (!approach) return;
          const missKm = parseFloat(approach.miss_distance?.kilometers || 0);
          const ld = missKm / 384400;
          const vel = parseFloat(approach.relative_velocity?.kilometers_per_second || 0);
          const diamMin = neo.estimated_diameter?.meters?.estimated_diameter_min || 0;
          const diamMax = neo.estimated_diameter?.meters?.estimated_diameter_max || 0;
          const avgSize = Math.round((diamMin + diamMax) / 2);
          const isHaz = neo.is_potentially_hazardous_asteroid;
          if (isHaz) hazardousCount++;
          if (ld < minLd) minLd = ld;
          all.push({
            name: (neo.name || '').replace(/[()]/g, ''),
            date: approach.close_approach_date,
            ld, vel, size: avgSize, hazardous: isHaz
          });
        });
      });

      all.sort((a, b) => a.ld - b.ld);
      $('#neo-total').textContent = all.length;
      $('#neo-hazardous').textContent = hazardousCount;
      $('#neo-closest').textContent = isFinite(minLd) ? minLd.toFixed(2) : '—';
      $('#neo-count').textContent = `${all.length} objects`;

      if (!all.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="loading-cell">No close approaches</td></tr>`;
        return;
      }
      tbody.innerHTML = all.slice(0, 15).map(n => `
        <tr>
          <td title="${n.name}">${n.name.length > 18 ? n.name.slice(0, 16) + '…' : n.name}</td>
          <td>${n.date}</td>
          <td>${n.ld.toFixed(2)}</td>
          <td>${n.vel.toFixed(1)}</td>
          <td>${n.size}</td>
          <td class="${n.hazardous ? 'pha-yes' : 'pha-no'}">${n.hazardous ? 'YES' : '—'}</td>
        </tr>`).join('');
    } catch (err) {
      console.error('NEO', err);
      tbody.innerHTML = `<tr><td colspan="6" class="error-msg">${err.message}</td></tr>`;
    }
  }

  // ---------- EPIC ----------
  async function loadEPIC() {
    const mediaEl = $('#epic-media');
    try {
      const images = await fetchJSON(`${CONFIG.endpoints.epicNatural}?api_key=${CONFIG.API_KEY}`);
      if (!Array.isArray(images) || !images.length) {
        mediaEl.innerHTML = `<div class="error-msg">No recent EPIC imagery</div>`;
        return;
      }
      const latest = images[0];
      const [y, m, d] = latest.date.split(' ')[0].split('-');
      const imgUrl = `${CONFIG.endpoints.epicArchive}/${y}/${m}/${d}/png/${latest.image}.png?api_key=${CONFIG.API_KEY}`;
      mediaEl.innerHTML = `<img src="${imgUrl}" alt="Earth from DSCOVR" loading="lazy" />`;
      $('#epic-date').textContent = latest.date.split(' ')[0];
      const c = latest.centroid_coordinates;
      $('#epic-caption').textContent = c
        ? `DSCOVR · L1 · Lat ${c.lat.toFixed(1)}° Lon ${c.lon.toFixed(1)}°`
        : 'DSCOVR · Lagrange Point 1';
    } catch (err) {
      console.error('EPIC', err);
      mediaEl.innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  }

  // ---------- DONKI ----------
  async function loadDONKI() {
    const listEl = $('#donki-list');
    try {
      const start = daysAgoISO(7);
      const notes = await fetchJSON(
        `${CONFIG.endpoints.donkiNotifications}?startDate=${start}&endDate=${todayISO()}&api_key=${CONFIG.API_KEY}`
      );
      let cmes = [];
      try {
        cmes = await fetchJSON(
          `${CONFIG.endpoints.donkiCME}?startDate=${start}&endDate=${todayISO()}&api_key=${CONFIG.API_KEY}`
        );
      } catch (_) {}

      const events = [];
      if (Array.isArray(notes)) {
        notes.slice(0, 10).forEach(n => {
          events.push({
            type: (n.messageType || 'NOTIFICATION').toUpperCase(),
            title: n.messageID || n.messageType || 'Notice',
            time: n.messageIssueTime || '',
            body: (n.messageBody || '').slice(0, 120)
          });
        });
      }
      if (Array.isArray(cmes)) {
        cmes.slice(0, 5).forEach(c => {
          const speed = c.cmeAnalyses?.[0]?.speed;
          events.push({
            type: 'CME',
            title: `Coronal Mass Ejection${speed ? ' · ' + Math.round(speed) + ' km/s' : ''}`,
            time: c.startTime || '',
            body: (c.note || 'CME event').slice(0, 100)
          });
        });
      }
      events.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
      $('#donki-count').textContent = `${events.length} events`;

      if (!events.length) {
        listEl.innerHTML = `<div class="loading-cell">No recent events</div>`;
        return;
      }
      listEl.innerHTML = events.slice(0, 8).map(e => {
        const cls = e.type.includes('CME') ? 'cme' : e.type.includes('FLARE') ? 'flare' : 'notification';
        return `<div class="event-card">
          <div class="event-type ${cls}">${e.type}</div>
          <div class="event-title">${e.title}</div>
          <div class="event-meta">${(e.time || '').replace('T', ' ').slice(0, 16)} UTC${e.body ? ' · ' + e.body : ''}</div>
        </div>`;
      }).join('');
    } catch (err) {
      console.error('DONKI', err);
      listEl.innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  }

  // ---------- EONET ----------
  function initEonetMap() {
    if (eonetMap) return;
    eonetMap = L.map('eonet-map', { zoomControl: false }).setView([20, 0], 1);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OSM · CARTO', maxZoom: 8
    }).addTo(eonetMap);
    L.control.zoom({ position: 'bottomright' }).addTo(eonetMap);
    eonetLayer = L.layerGroup().addTo(eonetMap);
  }

  async function loadEONET() {
    const listEl = $('#eonet-list');
    try {
      initEonetMap();
      eonetLayer.clearLayers();
      const data = await fetchJSON(`${CONFIG.endpoints.eonetEvents}?status=open&limit=25`);
      const events = data.events || [];
      $('#eonet-count').textContent = `${events.length} active`;

      const colors = {
        wildfires: '#ff6d00', severeStorms: '#7c4dff', volcanoes: '#fc3d21',
        floods: '#00bcd4', earthquakes: '#ffab00', landslides: '#8d6e63'
      };

      if (!events.length) {
        listEl.innerHTML = `<div class="loading-cell">No open events</div>`;
        return;
      }

      listEl.innerHTML = events.slice(0, 10).map(ev => {
        const cat = ev.categories?.[0];
        const geo = ev.geometry?.[ev.geometry.length - 1];
        const coords = geo?.coordinates;
        const date = geo?.date ? geo.date.slice(0, 10) : '';
        if (coords && coords.length >= 2) {
          const color = colors[cat?.id] || '#00d4ff';
          L.circleMarker([coords[1], coords[0]], {
            radius: 6, color, fillColor: color, fillOpacity: 0.75, weight: 1
          }).bindPopup(`<strong>${ev.title}</strong><br>${cat?.title || ''}<br>${date}`)
            .addTo(eonetLayer);
        }
        return `<div class="event-card">
          <div class="event-type">${(cat?.title || 'Event').toUpperCase()}</div>
          <div class="event-title">${ev.title}</div>
          <div class="event-meta">${date}${coords ? ` · ${coords[1].toFixed(1)}°, ${coords[0].toFixed(1)}°` : ''}</div>
        </div>`;
      }).join('');

      if (eonetLayer.getLayers().length) {
        eonetMap.fitBounds(L.featureGroup(eonetLayer.getLayers()).getBounds().pad(0.3), { maxZoom: 4 });
      }
    } catch (err) {
      console.error('EONET', err);
      listEl.innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  }

  // ---------- ISS TRACKER ----------
  function initIssMap() {
    if (issMap) return;
    issMap = L.map('iss-map', { zoomControl: false, worldCopyJump: true }).setView([0, 0], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OSM · CARTO', maxZoom: 6
    }).addTo(issMap);
    L.control.zoom({ position: 'bottomright' }).addTo(issMap);

    // Custom ISS icon
    const issIcon = L.divIcon({
      className: 'iss-marker',
      html: `<div style="
        width:18px;height:18px;border-radius:50%;
        background:#00d4ff;border:2px solid #fff;
        box-shadow:0 0 12px #00d4ff,0 0 4px #fff;
      "></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
    issMarker = L.marker([0, 0], { icon: issIcon }).addTo(issMap);
    issTrailLine = L.polyline([], { color: '#00d4ff', weight: 2, opacity: 0.6, dashArray: '4 6' }).addTo(issMap);
  }

  async function loadISS() {
    try {
      initIssMap();
      const data = await fetchJSON(CONFIG.endpoints.issNow);

      const lat = data.latitude;
      const lon = data.longitude;
      const alt = data.altitude;
      const vel = data.velocity; // km/h already from this API
      const vis = data.visibility || '—';
      const foot = data.footprint;

      $('#iss-lat').textContent = lat.toFixed(2) + '°';
      $('#iss-lon').textContent = lon.toFixed(2) + '°';
      $('#iss-alt').textContent = alt.toFixed(1);
      $('#iss-vel').textContent = Math.round(vel).toLocaleString();
      $('#iss-foot').textContent = Math.round(foot);
      $('#iss-visibility').textContent = vis.toUpperCase();

      // Trail (keep last ~40 points ≈ 5 min at 8s interval)
      issTrail.push([lat, lon]);
      if (issTrail.length > 40) issTrail.shift();
      issTrailLine.setLatLngs(issTrail);
      issMarker.setLatLng([lat, lon]);

      // Soft pan if far from current view
      const center = issMap.getCenter();
      if (Math.abs(center.lat - lat) > 25 || Math.abs(center.lng - lon) > 40) {
        issMap.panTo([lat, lon], { animate: true, duration: 1.2 });
      }
    } catch (err) {
      console.error('ISS', err);
    }
  }

  // Crew count – best-effort (HTTP endpoint may fail on HTTPS pages)
  async function loadCrew() {
    try {
      // Fallback constant if CORS/mixed content blocks
      const res = await fetch('https://api.open-notify.org/astros.json').catch(() => null);
      if (res && res.ok) {
        const data = await res.json();
        const issCrew = (data.people || []).filter(p => (p.craft || '').toUpperCase().includes('ISS'));
        $('#iss-crew').textContent = issCrew.length || data.number || '—';
      } else {
        $('#iss-crew').textContent = '—';
      }
    } catch (_) {
      $('#iss-crew').textContent = '—';
    }
  }

  // ---------- MISSION DIGEST (Spaceflight News API) ----------
  function renderMissions() {
    const listEl = $('#mission-list');
    let items = allMissionItems;
    if (missionFilter === 'iss') {
      items = items.filter(i => /iss|space station|crew|spacewalk/i.test(i.title + i.summary));
    } else if (missionFilter === 'artemis') {
      items = items.filter(i => /artemis|orion|sls|moon|lunar/i.test(i.title + i.summary));
    } else if (missionFilter === 'other') {
      items = items.filter(i => !/iss|space station|artemis|orion/i.test(i.title + i.summary));
    }

    if (!items.length) {
      listEl.innerHTML = `<div class="loading-cell">No matching updates</div>`;
      return;
    }

    listEl.innerHTML = items.slice(0, 12).map(item => {
      const tag = /artemis|orion|sls|lunar/i.test(item.title) ? 'ARTEMIS'
                : /iss|space station|crew|spacewalk/i.test(item.title) ? 'ISS'
                : (item.news_site || 'NEWS').toUpperCase().slice(0, 12);
      const time = item.published_at ? item.published_at.replace('T', ' ').slice(0, 16) : '';
      return `<a class="event-card" href="${item.url}" target="_blank" rel="noopener" style="text-decoration:none;display:block">
        <div class="event-type">${tag}</div>
        <div class="event-title">${item.title}</div>
        <div class="event-meta">${time} UTC · ${item.news_site || ''}</div>
      </a>`;
    }).join('');
  }

  async function loadMissions() {
    try {
      // Fetch recent + ISS + Artemis focused
      const [all, iss, artemis] = await Promise.all([
        fetchJSON(`${CONFIG.endpoints.spaceflightNews}?limit=15&ordering=-published_at`),
        fetchJSON(`${CONFIG.endpoints.spaceflightNews}?limit=10&search=ISS&ordering=-published_at`),
        fetchJSON(`${CONFIG.endpoints.spaceflightNews}?limit=10&search=Artemis&ordering=-published_at`)
      ]);

      const map = new Map();
      [...(all.results || []), ...(iss.results || []), ...(artemis.results || [])].forEach(a => {
        if (!map.has(a.id)) map.set(a.id, a);
      });
      allMissionItems = Array.from(map.values())
        .sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));

      // Detect new items for chime
      const newIds = allMissionItems.map(i => i.id);
      const hasNew = newIds.some(id => !lastNewsIds.has(id) && lastNewsIds.size > 0);
      if (hasNew) {
        playChime();
        const status = $('#system-status');
        status.classList.remove('online');
        status.innerHTML = `<span class="status-dot" style="background:var(--amber)"></span> NEW UPDATE`;
        setTimeout(() => {
          status.classList.add('online');
          status.innerHTML = `<span class="status-dot"></span> SYSTEMS NOMINAL`;
        }, 8000);
      }
      lastNewsIds = new Set(newIds);

      $('#mission-count').textContent = `${allMissionItems.length} updates`;
      renderMissions();
    } catch (err) {
      console.error('Missions', err);
      $('#mission-list').innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  }

  // ---------- JPL updates (reuse Spaceflight News filtered for JPL/Mars/Europa etc.) ----------
  async function loadJPL() {
    const listEl = $('#jpl-list');
    try {
      const data = await fetchJSON(
        `${CONFIG.endpoints.spaceflightNews}?limit=12&search=JPL&ordering=-published_at`
      );
      const items = data.results || [];
      if (!items.length) {
        // Fallback broader robotic search
        const fb = await fetchJSON(
          `${CONFIG.endpoints.spaceflightNews}?limit=10&search=Mars OR Europa OR Perseverance OR Voyager&ordering=-published_at`
        );
        items.push(...(fb.results || []));
      }

      if (!items.length) {
        listEl.innerHTML = `<div class="loading-cell">No recent JPL items</div>`;
        return;
      }

      listEl.innerHTML = items.slice(0, 8).map(item => {
        const time = item.published_at ? item.published_at.replace('T', ' ').slice(0, 16) : '';
        return `<a class="event-card" href="${item.url}" target="_blank" rel="noopener" style="text-decoration:none;display:block">
          <div class="event-type">JPL</div>
          <div class="event-title">${item.title}</div>
          <div class="event-meta">${time} · ${item.news_site || ''}</div>
        </a>`;
      }).join('');
    } catch (err) {
      console.error('JPL', err);
      listEl.innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  }

  // ---------- Media Library ----------
  async function loadMedia(query = 'James Webb') {
    const grid = $('#media-grid');
    if (!query.trim()) return;
    grid.innerHTML = `<div class="loading-cell">Searching…</div>`;
    try {
      const data = await fetchJSON(
        `${CONFIG.endpoints.imagesSearch}?q=${encodeURIComponent(query)}&media_type=image&page_size=12`
      );
      const items = data.collection?.items || [];
      if (!items.length) {
        grid.innerHTML = `<div class="loading-cell">No results for “${query}”</div>`;
        return;
      }
      grid.innerHTML = items.map(item => {
        const meta = item.data?.[0] || {};
        const links = item.links || [];
        const thumb = links.find(l => l.rel === 'preview')?.href || links[0]?.href || '';
        const title = meta.title || 'Untitled';
        const nasaId = meta.nasa_id || '';
        return `<a class="media-card" href="https://images.nasa.gov/details/${nasaId}" target="_blank" rel="noopener" title="${title}">
          <img src="${thumb}" alt="${title}" loading="lazy" onerror="this.style.opacity=0.3" />
          <div class="media-title">${title}</div>
        </a>`;
      }).join('');
    } catch (err) {
      grid.innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  }

  // ---------- Orchestration ----------
  async function refreshAll() {
    const btn = $('#btn-refresh');
    btn.classList.add('spinning');
    btn.disabled = true;

    await Promise.allSettled([
      loadAPOD(),
      loadNEO(),
      loadEPIC(),
      loadDONKI(),
      loadEONET(),
      loadMissions(),
      loadJPL(),
      loadCrew()
    ]);

    if (!$('#media-grid').querySelector('.media-card')) {
      loadMedia($('#media-query').value || 'James Webb');
    }

    setLastRefresh();
    btn.classList.remove('spinning');
    btn.disabled = false;
  }

  function init() {
    updateClocks();
    setInterval(updateClocks, 1000);

    // ISS fast loop
    loadISS();
    setInterval(loadISS, CONFIG.issRefreshMs);

    // Tabs
    $$('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        missionFilter = tab.dataset.filter;
        renderMissions();
      });
    });

    // Alert toggle
    $('#alert-status').addEventListener('click', () => {
      CONFIG.audioEnabled = !CONFIG.audioEnabled;
      $('#alert-status').textContent = CONFIG.audioEnabled ? '🔔 ALERTS ON' : '🔇 ALERTS OFF';
      if (CONFIG.audioEnabled) playChime();
    });

    $('#btn-refresh').addEventListener('click', refreshAll);
    $('#btn-media-search').addEventListener('click', () => loadMedia($('#media-query').value));
    $('#media-query').addEventListener('keydown', e => {
      if (e.key === 'Enter') loadMedia($('#media-query').value);
    });

    // First full load + auto
    refreshAll();
    setInterval(refreshAll, CONFIG.autoRefreshMs);

    // Unlock audio on first user gesture
    document.body.addEventListener('click', function unlock() {
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      document.body.removeEventListener('click', unlock);
    }, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
