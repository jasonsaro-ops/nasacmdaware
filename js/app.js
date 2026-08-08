(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  let issMap, neoMap, issMarker, issTrail = [], issLine, neoLayer;
  let neoData = [], newsCache = [], audioCtx = null;
  let zTop = 300;

  const utc = () => new Date().toISOString().substr(11, 8);
  const loc = () => new Date().toLocaleTimeString('en-GB', { hour12: false });
  const today = () => new Date().toISOString().slice(0, 10);
  const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const ago = n => addDays(-n);

  async function get(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
    return r.json();
  }

  function chime() {
    if (!CONFIG.audio) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime;
      [[880, 0, 0.1], [1175, 0.12, 0.15], [880, 0.3, 0.08]].forEach(([f, s, d]) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0, t + s);
        g.gain.linearRampToValueAtTime(0.22, t + s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + s + d);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t + s); o.stop(t + s + d + 0.05);
      });
    } catch (_) {}
  }

  // —— Clocks ——
  setInterval(() => { $('#utc').textContent = utc(); $('#loc').textContent = loc(); }, 1000);

  // —— Floating windows ——
  function openFloat(id, title, html, w = 520, h = 400) {
    let el = document.getElementById('f-' + id);
    if (el) { el.style.zIndex = ++zTop; return el; }
    el = document.createElement('div');
    el.className = 'float';
    el.id = 'f-' + id;
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.style.left = Math.max(20, (window.innerWidth - w) / 2 - 40 + Math.random() * 80) + 'px';
    el.style.top = Math.max(50, (window.innerHeight - h) / 2 - 30 + Math.random() * 60) + 'px';
    el.style.zIndex = ++zTop;
    el.innerHTML = `<div class="float-h"><span>${title}</span><button class="x" title="Close">×</button></div><div class="float-b">${html}</div>`;
    $('#float-layer').appendChild(el);

    el.querySelector('.x').onclick = () => el.remove();
    // drag
    const hdr = el.querySelector('.float-h');
    let ox, oy, dragging = false;
    hdr.onmousedown = e => {
      if (e.target.classList.contains('x')) return;
      dragging = true; ox = e.clientX - el.offsetLeft; oy = e.clientY - el.offsetTop;
      el.style.zIndex = ++zTop;
    };
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      el.style.left = Math.max(0, e.clientX - ox) + 'px';
      el.style.top = Math.max(0, e.clientY - oy) + 'px';
    });
    window.addEventListener('mouseup', () => { dragging = false; });
    return el;
  }

  // —— Maps ——
  function initMaps() {
    if (!issMap) {
      issMap = L.map('iss-map', { zoomControl: false, worldCopyJump: true }).setView([0, 0], 2);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 6, attribution: '' }).addTo(issMap);
      issMarker = L.circleMarker([0, 0], { radius: 7, color: '#fff', fillColor: '#fc3d21', fillOpacity: 1, weight: 2 }).addTo(issMap);
      issLine = L.polyline([], { color: '#fc3d21', weight: 2.5, opacity: 0.85 }).addTo(issMap);
    }
    if (!neoMap) {
      neoMap = L.map('neo-map', { zoomControl: true, worldCopyJump: true }).setView([20, 0], 2);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 7, attribution: '© CARTO' }).addTo(neoMap);
      neoLayer = L.layerGroup().addTo(neoMap);
    }
  }

  // —— ISS ——
  async function loadISS() {
    try {
      initMaps();
      const d = await get(CONFIG.endpoints.iss);
      const lat = d.latitude, lon = d.longitude;
      $('#iss-lat').textContent = lat.toFixed(2) + '°';
      $('#iss-lon').textContent = lon.toFixed(2) + '°';
      $('#iss-alt').textContent = d.altitude.toFixed(1);
      $('#iss-vel').textContent = Math.round(d.velocity).toLocaleString();
      $('#iss-vis').textContent = (d.visibility || '—').toUpperCase();

      issTrail.push([lat, lon]);
      if (issTrail.length > 50) issTrail.shift();
      issLine.setLatLngs(issTrail);
      issMarker.setLatLng([lat, lon]);
      const c = issMap.getCenter();
      if (Math.abs(c.lat - lat) > 30 || Math.abs(c.lng - lon) > 50)
        issMap.panTo([lat, lon], { animate: true, duration: 1 });
    } catch (e) { console.error('ISS', e); }
  }

  // —— NEO ——
  async function loadNEO() {
    try {
      initMaps();
      const start = today(), end = addDays(7);
      const data = await get(`${CONFIG.endpoints.neoFeed}?start_date=${start}&end_date=${end}&api_key=${CONFIG.API_KEY}`);
      const objs = data.near_earth_objects || {};
      neoData = [];
      let pha = 0, minLd = Infinity;

      Object.keys(objs).forEach(date => {
        objs[date].forEach(n => {
          const a = n.close_approach_data?.[0];
          if (!a) return;
          const ld = parseFloat(a.miss_distance?.kilometers || 0) / 384400;
          const vel = parseFloat(a.relative_velocity?.kilometers_per_second || 0);
          const dmin = n.estimated_diameter?.meters?.estimated_diameter_min || 0;
          const dmax = n.estimated_diameter?.meters?.estimated_diameter_max || 0;
          const haz = n.is_potentially_hazardous_asteroid;
          if (haz) pha++;
          if (ld < minLd) minLd = ld;
          // Approximate ground point of closest approach using approach epoch (simplified: use random-ish lon from name hash + lat 0 band for viz)
          // Better: place markers at approach "sub-point" approx using orbital nodes simplified to lat/lon from approach data if available
          // NeoWs doesn't give ground track; we place markers distributed for visualization + click for data
          const hash = (n.id || '').split('').reduce((s, c) => s + c.charCodeAt(0), 0);
          const mlat = ((hash % 140) - 70) * 0.9;
          const mlon = ((hash * 7) % 360) - 180;
          neoData.push({
            id: n.id, name: (n.name || '').replace(/[()]/g, ''),
            date: a.close_approach_date, ld, vel,
            size: Math.round((dmin + dmax) / 2), haz,
            lat: mlat, lon: mlon, abs: n.absolute_magnitude_h
          });
        });
      });
      neoData.sort((a, b) => a.ld - b.ld);
      $('#neo-tot').textContent = neoData.length;
      $('#neo-pha').textContent = pha;
      $('#neo-close').textContent = isFinite(minLd) ? minLd.toFixed(2) : '—';
      $('#neo-n').textContent = neoData.length + ' OBJ';

      neoLayer.clearLayers();
      neoData.forEach(n => {
        const col = n.haz ? '#fc3d21' : '#5eb3f6';
        const m = L.circleMarker([n.lat, n.lon], {
          radius: n.haz ? 7 : 5, color: col, fillColor: col, fillOpacity: 0.85, weight: 1
        });
        m.bindTooltip(n.name + (n.haz ? ' · PHA' : ''), { direction: 'top' });
        m.on('click', () => openNeoDetail(n));
        neoLayer.addLayer(m);
      });
    } catch (e) { console.error('NEO', e); }
  }

  function openNeoDetail(n) {
    openFloat('neo-' + n.id, 'NEO · ' + n.name, `
      <table class="float-table">
        <tr><th>Name</th><td>${n.name}</td></tr>
        <tr><th>Approach</th><td>${n.date}</td></tr>
        <tr><th>Miss distance</th><td>${n.ld.toFixed(3)} LD (${(n.ld * 384400).toFixed(0)} km)</td></tr>
        <tr><th>Velocity</th><td>${n.vel.toFixed(2)} km/s</td></tr>
        <tr><th>Est. size</th><td>~${n.size} m</td></tr>
        <tr><th>Abs. magnitude</th><td>${n.abs ?? '—'}</td></tr>
        <tr><th>Potentially hazardous</th><td class="${n.haz ? 'pha' : ''}">${n.haz ? 'YES' : 'No'}</td></tr>
      </table>
      <p style="margin-top:10px;font-size:11px;color:var(--muted)">Marker position is illustrative for visualization. Approach geometry from NeoWs.</p>
    `, 380, 320);
  }

  // —— APOD ——
  let apodCache = null;
  async function loadAPOD() {
    try {
      apodCache = await get(`${CONFIG.endpoints.apod}?api_key=${CONFIG.API_KEY}`);
      $('#apod-d').textContent = apodCache.date || '—';
      const url = apodCache.media_type === 'image' ? (apodCache.url || apodCache.hdurl) : null;
      $('#apod-prev').innerHTML = url
        ? `<img src="${url}" style="width:100%;height:100%;object-fit:cover" alt="">`
        : `<div style="padding:8px;color:var(--muted)">${apodCache.title || 'Video'}</div>`;
    } catch (e) { $('#apod-prev').innerHTML = `<div class="list-item">${e.message}</div>`; }
  }

  // —— EPIC ——
  let epicCache = null;
  async function loadEPIC() {
    try {
      const imgs = await get(`${CONFIG.endpoints.epic}?api_key=${CONFIG.API_KEY}`);
      if (!imgs?.length) return;
      epicCache = imgs[0];
      const [y, m, d] = epicCache.date.split(' ')[0].split('-');
      const src = `${CONFIG.endpoints.epicImg}/${y}/${m}/${d}/png/${epicCache.image}.png?api_key=${CONFIG.API_KEY}`;
      $('#epic-d').textContent = epicCache.date.split(' ')[0];
      $('#epic-prev').innerHTML = `<img src="${src}" alt="EPIC">`;
    } catch (e) { console.error(e); }
  }

  // —— DONKI ——
  let donkiCache = [];
  async function loadDONKI() {
    try {
      const start = ago(7);
      const notes = await get(`${CONFIG.endpoints.donkiN}?startDate=${start}&endDate=${today()}&api_key=${CONFIG.API_KEY}`);
      donkiCache = (notes || []).slice(0, 12).map(n => ({
        type: (n.messageType || 'NOTE').toUpperCase(),
        title: n.messageID || n.messageType,
        time: (n.messageIssueTime || '').replace('T', ' ').slice(0, 16),
        body: (n.messageBody || '').slice(0, 200)
      }));
      $('#donki-n').textContent = donkiCache.length;
      $('#donki-prev').innerHTML = donkiCache.slice(0, 5).map(e =>
        `<div class="list-item"><div class="t">${e.type}</div><div class="n">${e.title}</div></div>`
      ).join('') || '<div class="list-item">No recent events</div>';
    } catch (e) { $('#donki-prev').innerHTML = `<div class="list-item">${e.message}</div>`; }
  }

  // —— EONET ——
  let eonetCache = [];
  async function loadEONET() {
    try {
      const data = await get(`${CONFIG.endpoints.eonet}?status=open&limit=20`);
      eonetCache = (data.events || []).map(ev => {
        const g = ev.geometry?.[ev.geometry.length - 1];
        return {
          title: ev.title,
          cat: ev.categories?.[0]?.title || 'Event',
          date: g?.date?.slice(0, 10) || '',
          coords: g?.coordinates
        };
      });
      $('#eonet-n').textContent = eonetCache.length;
      $('#eonet-prev').innerHTML = eonetCache.slice(0, 5).map(e =>
        `<div class="list-item"><div class="t">${e.cat.toUpperCase()}</div><div class="n">${e.title}</div></div>`
      ).join('') || '<div class="list-item">None open</div>';
    } catch (e) { console.error(e); }
  }

  // —— Missions / JPL ——
  async function loadNews() {
    try {
      const [all, iss, art, jpl] = await Promise.all([
        get(`${CONFIG.endpoints.news}?limit=12&ordering=-published_at`),
        get(`${CONFIG.endpoints.news}?limit=8&search=ISS&ordering=-published_at`),
        get(`${CONFIG.endpoints.news}?limit=8&search=Artemis&ordering=-published_at`),
        get(`${CONFIG.endpoints.news}?limit=8&search=JPL&ordering=-published_at`)
      ]);
      const map = new Map();
      [...(all.results||[]), ...(iss.results||[]), ...(art.results||[])].forEach(a => map.set(a.id, a));
      newsCache = [...map.values()].sort((a, b) => (b.published_at||'').localeCompare(a.published_at||''));
      const jplItems = jpl.results || [];

      $('#mis-n').textContent = newsCache.length;
      $('#mis-prev').innerHTML = newsCache.slice(0, 6).map(i =>
        `<div class="list-item"><div class="t">${(i.news_site||'NEWS').slice(0,14)}</div><div class="n">${i.title}</div></div>`
      ).join('');
      $('#jpl-prev').innerHTML = jplItems.slice(0, 5).map(i =>
        `<div class="list-item"><div class="t">JPL</div><div class="n">${i.title}</div></div>`
      ).join('') || '<div class="list-item">—</div>';
    } catch (e) { console.error(e); }
  }

  // —— Media preview ——
  async function loadMediaPrev() {
    try {
      const d = await get(`${CONFIG.endpoints.images}?q=James%20Webb&media_type=image&page_size=4`);
      const items = d.collection?.items || [];
      $('#media-prev').innerHTML = items.length
        ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;height:100%">
            ${items.slice(0,4).map(it => {
              const th = it.links?.find(l => l.rel==='preview')?.href || '';
              return `<img src="${th}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.opacity=0.2">`;
            }).join('')}
          </div>`
        : '';
    } catch (_) {}
  }

  // —— Panel open handlers ——
  function bindTiles() {
    $$('.tile.clickable, .tile-iss, .tile-neo').forEach(t => {
      t.addEventListener('click', e => {
        // don't steal map interaction
        if (e.target.closest('.leaflet-container') || e.target.closest('.leaflet-control')) return;
        const p = t.dataset.panel;
        if (p === 'apod') openAPOD();
        else if (p === 'epic') openEPIC();
        else if (p === 'donki') openDONKI();
        else if (p === 'eonet') openEONET();
        else if (p === 'missions') openMissions();
        else if (p === 'jpl') openJPL();
        else if (p === 'cams') openCams();
        else if (p === 'media') openMedia();
        else if (p === 'neo') openNEOList();
        else if (p === 'iss') openISSDetail();
      });
    });
  }

  function openAPOD() {
    if (!apodCache) return;
    const d = apodCache;
    let media = d.media_type === 'video'
      ? (d.url.includes('youtube') || d.url.includes('youtu.be')
          ? `<iframe src="${d.url.replace('watch?v=','embed/').replace('youtu.be/','youtube.com/embed/')}" style="width:100%;aspect-ratio:16/9;border:0" allowfullscreen></iframe>`
          : `<video controls src="${d.url}" style="width:100%"></video>`)
      : `<img src="${d.hdurl || d.url}" alt="">`;
    openFloat('apod', 'APOD · ' + (d.date || ''), `
      ${media}
      <h3 style="margin-top:10px">${d.title || ''}</h3>
      <p>${d.explanation || ''}</p>
      <p style="margin-top:8px;font-size:11px">${d.copyright ? '© ' + d.copyright : ''}</p>
    `, 560, 520);
  }

  function openEPIC() {
    if (!epicCache) return;
    const [y, m, d] = epicCache.date.split(' ')[0].split('-');
    const src = `${CONFIG.endpoints.epicImg}/${y}/${m}/${d}/png/${epicCache.image}.png?api_key=${CONFIG.API_KEY}`;
    openFloat('epic', 'EPIC · DSCOVR L1', `
      <img src="${src}" style="width:100%;border-radius:50%;max-width:360px;display:block;margin:0 auto" alt="Earth">
      <p style="text-align:center;margin-top:10px">${epicCache.date}</p>
    `, 420, 480);
  }

  function openDONKI() {
    openFloat('donki', 'SPACE WEATHER · DONKI', donkiCache.map(e =>
      `<div class="list-item" style="padding:8px 0"><div class="t">${e.type} · ${e.time}</div><div class="n" style="white-space:normal">${e.title}</div><div style="color:var(--muted);font-size:11px;margin-top:2px">${e.body}</div></div>`
    ).join('') || 'No events', 480, 420);
  }

  function openEONET() {
    openFloat('eonet', 'NATURAL EVENTS · EONET', eonetCache.map(e =>
      `<div class="list-item" style="padding:6px 0"><div class="t">${e.cat.toUpperCase()} · ${e.date}</div><div class="n" style="white-space:normal">${e.title}</div></div>`
    ).join('') || 'None', 440, 400);
  }

  function openMissions() {
    openFloat('missions', 'MISSION DIGEST', newsCache.map(i =>
      `<a href="${i.url}" target="_blank" rel="noopener" class="list-item" style="display:block;text-decoration:none;padding:8px 0">
        <div class="t">${(i.news_site||'').toUpperCase()} · ${(i.published_at||'').slice(0,10)}</div>
        <div class="n" style="white-space:normal;color:var(--text)">${i.title}</div>
      </a>`
    ).join(''), 500, 480);
  }

  function openJPL() {
    openFloat('jpl', 'JPL / ROBOTIC MISSIONS', `
      <div style="margin-bottom:12px">
        <div style="font-size:10px;letter-spacing:0.1em;color:var(--muted);margin-bottom:4px">CLEAN ROOM / HIGH BAY</div>
        <iframe src="https://www.youtube.com/embed/live_stream?channel=UCryGek9-xMZ4tqPL4r6_B1w&autoplay=0&mute=1" style="width:100%;aspect-ratio:16/9;border:0;background:#000" allowfullscreen></iframe>
      </div>
      <div id="jpl-float-list">Loading…</div>
    `, 520, 500);
    get(`${CONFIG.endpoints.news}?limit=10&search=JPL&ordering=-published_at`).then(d => {
      const el = document.querySelector('#jpl-float-list');
      if (el) el.innerHTML = (d.results || []).map(i =>
        `<a href="${i.url}" target="_blank" rel="noopener" class="list-item" style="display:block;text-decoration:none;padding:6px 0">
          <div class="t">${(i.published_at||'').slice(0,10)}</div>
          <div class="n" style="white-space:normal;color:var(--text)">${i.title}</div>
        </a>`
      ).join('');
    }).catch(() => {});
  }

  function openCams() {
    openFloat('cams', 'LIVE CAMERA FEEDS', `
      <div class="cam-grid">
        <div><div style="font-size:9px;letter-spacing:0.1em;color:var(--muted);margin-bottom:4px">ISS HD EARTH</div>
          <iframe src="https://www.youtube.com/embed/awQzjn72bI0?autoplay=0&mute=1" allowfullscreen></iframe></div>
        <div><div style="font-size:9px;letter-spacing:0.1em;color:var(--muted);margin-bottom:4px">ISS LIVE</div>
          <iframe src="https://www.youtube.com/embed/M3HKLzjvKPc?autoplay=0&mute=1" allowfullscreen></iframe></div>
      </div>
      <p style="margin-top:8px;font-size:11px;color:var(--muted)">Feeds may show recorded Earth views during eclipse or operations.</p>
    `, 640, 420);
  }

  function openMedia() {
    openFloat('media', 'NASA IMAGE & VIDEO LIBRARY', `
      <div class="search-row">
        <input id="mq" value="James Webb" placeholder="Search…">
        <button id="ms">SEARCH</button>
      </div>
      <div class="media-g" id="mg">…</div>
    `, 560, 480);
    const run = async () => {
      const q = document.getElementById('mq')?.value || 'NASA';
      const d = await get(`${CONFIG.endpoints.images}?q=${encodeURIComponent(q)}&media_type=image&page_size=16`);
      const g = document.getElementById('mg');
      if (!g) return;
      g.innerHTML = (d.collection?.items || []).map(it => {
        const m = it.data?.[0] || {};
        const th = it.links?.find(l => l.rel === 'preview')?.href || '';
        return `<a href="https://images.nasa.gov/details/${m.nasa_id||''}" target="_blank" rel="noopener">
          <img src="${th}" alt="" onerror="this.style.opacity=0.2"><span>${m.title||''}</span></a>`;
      }).join('');
    };
    setTimeout(() => {
      document.getElementById('ms')?.addEventListener('click', run);
      document.getElementById('mq')?.addEventListener('keydown', e => e.key === 'Enter' && run());
      run();
    }, 50);
  }

  function openNEOList() {
    openFloat('neolist', 'NEAR-EARTH OBJECTS · 7-DAY', `
      <table class="float-table">
        <thead><tr><th>NAME</th><th>DATE</th><th>LD</th><th>km/s</th><th>m</th><th>PHA</th></tr></thead>
        <tbody>
          ${neoData.slice(0, 25).map(n => `
            <tr style="cursor:pointer" data-id="${n.id}">
              <td>${n.name.length > 16 ? n.name.slice(0,14)+'…' : n.name}</td>
              <td>${n.date}</td><td>${n.ld.toFixed(2)}</td><td>${n.vel.toFixed(1)}</td>
              <td>${n.size}</td><td class="${n.haz?'pha':''}">${n.haz?'YES':'—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <p style="margin-top:8px;font-size:11px;color:var(--muted)">Click row or map marker for detail. Map markers are distributed for visualization.</p>
    `, 560, 480);
    setTimeout(() => {
      document.querySelectorAll('#f-neolist tr[data-id]').forEach(tr => {
        tr.onclick = () => {
          const n = neoData.find(x => x.id === tr.dataset.id);
          if (n) openNeoDetail(n);
        };
      });
    }, 30);
  }

  function openISSDetail() {
    openFloat('issd', 'ISS TELEMETRY', `
      <table class="float-table">
        <tr><th>Latitude</th><td id="fd-lat">—</td></tr>
        <tr><th>Longitude</th><td id="fd-lon">—</td></tr>
        <tr><th>Altitude</th><td id="fd-alt">—</td></tr>
        <tr><th>Velocity</th><td id="fd-vel">—</td></tr>
        <tr><th>Visibility</th><td id="fd-vis">—</td></tr>
        <tr><th>Footprint</th><td id="fd-foot">—</td></tr>
      </table>
      <p style="margin-top:10px;font-size:11px;color:var(--muted)">Live from WhereTheISS.at · Trail on main map (red). Position updates ~7 s.</p>
    `, 360, 300);
    const sync = async () => {
      try {
        const d = await get(CONFIG.endpoints.iss);
        const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        set('fd-lat', d.latitude.toFixed(4) + '°');
        set('fd-lon', d.longitude.toFixed(4) + '°');
        set('fd-alt', d.altitude.toFixed(2) + ' km');
        set('fd-vel', Math.round(d.velocity).toLocaleString() + ' km/h');
        set('fd-vis', (d.visibility || '—').toUpperCase());
        set('fd-foot', Math.round(d.footprint) + ' km');
      } catch (_) {}
    };
    sync();
  }

  // —— Orchestrate ——
  async function refresh() {
    $('#btn-refresh').style.opacity = '0.5';
    await Promise.allSettled([loadAPOD(), loadNEO(), loadEPIC(), loadDONKI(), loadEONET(), loadNews(), loadMediaPrev()]);
    $('#last-upd').textContent = 'UPD ' + utc();
    $('#btn-refresh').style.opacity = '1';
  }

  function init() {
    $('#utc').textContent = utc();
    $('#loc').textContent = loc();
    initMaps();
    bindTiles();
    loadISS();
    setInterval(loadISS, CONFIG.issMs);
    refresh();
    setInterval(refresh, CONFIG.refreshMs);

    $('#btn-refresh').onclick = refresh;
    $('#btn-audio').onclick = () => {
      CONFIG.audio = !CONFIG.audio;
      $('#btn-audio').textContent = CONFIG.audio ? '🔔' : '🔇';
      if (CONFIG.audio) chime();
    };
    document.body.addEventListener('click', function u() {
      if (audioCtx?.state === 'suspended') audioCtx.resume();
      document.body.removeEventListener('click', u);
    }, { once: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
