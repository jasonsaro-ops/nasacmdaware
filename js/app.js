(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  let satMap, satLayers = {}, focusId = 25544;
  let satRecords = {}; // norad -> {satrec, name, color}
  let neoData = [], newsCache = [], donkiCache = [], eonetCache = [];
  let epicCache = null, audioCtx = null, zTop = 100000;
  let neoRot = 0, neoAnim = null;

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

  function playSOL() {
    if (!CONFIG.audio) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime;
      [523.25, 659.25, 783.99].forEach((f, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        const s = t + i * 0.06;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.11 - i * 0.02, s + 0.04);
        g.gain.exponentialRampToValueAtTime(0.001, s + 0.55);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(s); o.stop(s + 0.6);
      });
    } catch (_) {}
  }

  setInterval(() => { $('#utc').textContent = utc(); $('#loc').textContent = loc(); }, 1000);

  function openFloat(id, title, html, w = 500, h = 400) {
    let el = document.getElementById('f-' + id);
    if (el) { el.style.zIndex = ++zTop; return el; }
    el = document.createElement('div');
    el.className = 'float';
    el.id = 'f-' + id;
    el.style.cssText = `width:${w}px;height:${h}px;left:${Math.max(24,(innerWidth-w)/2+(Math.random()*60-30))}px;top:${Math.max(52,(innerHeight-h)/2+(Math.random()*40-20))}px;z-index:${++zTop}`;
    el.innerHTML = `<div class="float-h"><span>${title}</span><button class="x" type="button">×</button></div><div class="float-b">${html}</div>`;
    $('#float-layer').appendChild(el);
    el.querySelector('.x').onclick = e => { e.stopPropagation(); el.remove(); };
    const hdr = el.querySelector('.float-h');
    let ox, oy, drag = false;
    hdr.onmousedown = e => {
      if (e.target.classList.contains('x')) return;
      drag = true; ox = e.clientX - el.offsetLeft; oy = e.clientY - el.offsetTop;
      el.style.zIndex = ++zTop; e.preventDefault();
    };
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      el.style.left = Math.max(0, Math.min(innerWidth - 80, e.clientX - ox)) + 'px';
      el.style.top = Math.max(0, Math.min(innerHeight - 40, e.clientY - oy)) + 'px';
    });
    window.addEventListener('mouseup', () => { drag = false; });
    return el;
  }

  /* ========== MULTI-SAT TRACKER (issinfo-style) ========== */
  function initSatMap() {
    if (satMap) return;
    satMap = L.map('sat-map', { zoomControl: false, worldCopyJump: true, attributionControl: false }).setView([15, 0], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 6 }).addTo(satMap);
  }

  function propPos(satrec, date) {
    const pv = satellite.propagate(satrec, date);
    if (!pv.position) return null;
    const gmst = satellite.gstime(date);
    const gd = satellite.eciToGeodetic(pv.position, gmst);
    const lat = satellite.degreesLat(gd.latitude);
    const lon = satellite.degreesLong(gd.longitude);
    const alt = gd.height;
    // velocity magnitude km/s -> km/h
    let vel = 0;
    if (pv.velocity) {
      const v = pv.velocity;
      vel = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) * 3600;
    }
    return { lat, lon, alt, vel };
  }

  function groundTrack(satrec, minutesPast, minutesFuture, stepMin) {
    const past = [], future = [];
    const now = new Date();
    for (let m = -minutesPast; m <= 0; m += stepMin) {
      const p = propPos(satrec, new Date(now.getTime() + m * 60000));
      if (p) past.push([p.lat, p.lon]);
    }
    for (let m = stepMin; m <= minutesFuture; m += stepMin) {
      const p = propPos(satrec, new Date(now.getTime() + m * 60000));
      if (p) future.push([p.lat, p.lon]);
    }
    return { past, future };
  }

  async function loadSatTLEs() {
    initSatMap();
    const wanted = new Map(CONFIG.sats.map(s => [s.id, s]));
    // Fetch station + visual + weather + resource groups
    const urls = [
      CONFIG.endpoints.tleStations,
      CONFIG.endpoints.tleVisual,
      CONFIG.endpoints.tleWeather,
      CONFIG.endpoints.tleResource
    ];
    const all = [];
    for (const url of urls) {
      try {
        const data = await get(url);
        if (Array.isArray(data)) all.push(...data);
      } catch (e) {
        console.warn('TLE fetch failed', url, e.message);
      }
    }

    // Build satrec for wanted NORADs
    all.forEach(item => {
      const id = item.NORAD_CAT_ID || item.norad_cat_id;
      if (!wanted.has(id)) return;
      const meta = wanted.get(id);
      try {
        // OMM JSON from Celestrak
        const satrec = satellite.json2satrec
          ? satellite.json2satrec(item)
          : satellite.twoline2satrec(
              // fallback if only TLE lines present
              item.TLE_LINE1 || item.tle1,
              item.TLE_LINE2 || item.tle2
            );
        // Prefer OMM fields
        let rec = null;
        if (item.EPOCH && item.MEAN_MOTION) {
          rec = satellite.json2satrec(item);
        } else if (item.TLE_LINE1 && item.TLE_LINE2) {
          rec = satellite.twoline2satrec(item.TLE_LINE1, item.TLE_LINE2);
        }
        if (!rec || rec.error) return;
        satRecords[id] = { satrec: rec, name: meta.name, color: meta.color, primary: !!meta.primary };
      } catch (e) {
        console.warn('satrec fail', id, e);
      }
    });

    // Always ensure ISS via WhereTheISS if TLE failed
    if (!satRecords[25544]) {
      satRecords[25544] = { satrec: null, name: 'ISS', color: '#ff3b30', primary: true, useWTIA: true };
    }

    // Legend
    const leg = $('#sat-legend');
    leg.innerHTML = CONFIG.sats.filter(s => satRecords[s.id] || s.id === 25544).map(s =>
      `<span data-id="${s.id}"><i class="dot" style="background:${s.color}"></i>${s.name}</span>`
    ).join('');
    leg.querySelectorAll('span').forEach(el => {
      el.onclick = e => {
        e.stopPropagation();
        focusId = +el.dataset.id;
        updateSatPositions();
      };
    });

    $('#sat-count').textContent = Object.keys(satRecords).length + ' SATS';
    updateSatPositions();
  }

  function updateSatPositions() {
    initSatMap();
    const now = new Date();

    CONFIG.sats.forEach(meta => {
      const rec = satRecords[meta.id];
      if (!rec) return;

      let pos = null;
      if (rec.useWTIA) return; // handled separately
      pos = propPos(rec.satrec, now);
      if (!pos) return;

      if (!satLayers[meta.id]) {
        satLayers[meta.id] = {
          marker: L.circleMarker([pos.lat, pos.lon], {
            radius: meta.primary ? 7 : 5,
            color: '#fff', fillColor: meta.color, fillOpacity: 1, weight: meta.primary ? 2 : 1
          }).bindTooltip(meta.name, { direction: 'top', opacity: 0.9 }).addTo(satMap),
          past: L.polyline([], { color: meta.color, weight: meta.primary ? 2.5 : 1.5, opacity: 0.85 }).addTo(satMap),
          future: L.polyline([], { color: meta.color, weight: meta.primary ? 2 : 1.2, opacity: 0.45, dashArray: '5 7' }).addTo(satMap)
        };
        satLayers[meta.id].marker.on('click', () => { focusId = meta.id; updateSatPositions(); });
      }

      const layer = satLayers[meta.id];
      layer.marker.setLatLng([pos.lat, pos.lon]);
      const track = groundTrack(rec.satrec, 45, 45, 2);
      // Handle antimeridian splits simply by setting latlngs
      layer.past.setLatLngs(track.past);
      layer.future.setLatLngs([[pos.lat, pos.lon], ...track.future]);

      if (meta.id === focusId) {
        $('#sat-focus').textContent = meta.name;
        $('#sat-lat').textContent = pos.lat.toFixed(2) + '°';
        $('#sat-lon').textContent = pos.lon.toFixed(2) + '°';
        $('#sat-alt').textContent = pos.alt.toFixed(1);
        $('#sat-vel').textContent = Math.round(pos.vel).toLocaleString();
      }
    });

    // ISS via WTIA for highest accuracy when focused or always overlay
    updateISS();
  }

  async function updateISS() {
    try {
      const d = await get(CONFIG.endpoints.iss);
      const lat = d.latitude, lon = d.longitude;
      const meta = CONFIG.sats.find(s => s.id === 25544);
      if (!satLayers[25544]) {
        satLayers[25544] = {
          marker: L.circleMarker([lat, lon], {
            radius: 7, color: '#fff', fillColor: '#ff3b30', fillOpacity: 1, weight: 2
          }).bindTooltip('ISS', { direction: 'top' }).addTo(satMap),
          past: L.polyline([], { color: '#ff3b30', weight: 2.5, opacity: 0.9 }).addTo(satMap),
          future: L.polyline([], { color: '#ff3b30', weight: 2, opacity: 0.5, dashArray: '5 7' }).addTo(satMap)
        };
        satLayers[25544].marker.on('click', () => { focusId = 25544; });
      }
      satLayers[25544].marker.setLatLng([lat, lon]);

      // Past from accumulation + future from API
      if (!satLayers[25544]._pastArr) satLayers[25544]._pastArr = [];
      satLayers[25544]._pastArr.push([lat, lon]);
      if (satLayers[25544]._pastArr.length > 40) satLayers[25544]._pastArr.shift();
      satLayers[25544].past.setLatLngs(satLayers[25544]._pastArr);

      const now = Math.floor(Date.now() / 1000);
      const ts = [];
      for (let i = 1; i <= 18; i++) ts.push(now + i * 300);
      try {
        const fut = await get(`${CONFIG.endpoints.issPos}?timestamps=${ts.join(',')}`);
        if (Array.isArray(fut)) {
          satLayers[25544].future.setLatLngs([[lat, lon], ...fut.map(p => [p.latitude, p.longitude])]);
        }
      } catch (_) {}

      if (focusId === 25544) {
        $('#sat-focus').textContent = 'ISS';
        $('#sat-lat').textContent = lat.toFixed(2) + '°';
        $('#sat-lon').textContent = lon.toFixed(2) + '°';
        $('#sat-alt').textContent = d.altitude.toFixed(1);
        $('#sat-vel').textContent = Math.round(d.velocity).toLocaleString();
      }
    } catch (e) { console.error('ISS', e); }
  }

  /* ========== NEO ========== */
  function project(lat, lon, R, rot) {
    const lonR = (lon + rot) * Math.PI / 180;
    const latR = lat * Math.PI / 180;
    const x = R * Math.cos(latR) * Math.sin(lonR);
    const y = -R * Math.sin(latR);
    const z = R * Math.cos(latR) * Math.cos(lonR);
    return { x, y, z, visible: z > -R * 0.12 };
  }

  function drawGlobe() {
    const canvas = $('#neo-canvas');
    if (!canvas) return;
    const wrap = canvas.parentElement;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (w < 10 || h < 10) return;
    const dpr = devicePixelRatio || 1;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.4;

    ctx.fillStyle = '#0a1828';
    for (let i = 0; i < 60; i++) {
      ctx.globalAlpha = 0.25 + (i % 4) * 0.1;
      ctx.fillRect((i * 97) % w, (i * 53) % h, 1, 1);
    }
    ctx.globalAlpha = 1;

    const grd = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
    grd.addColorStop(0, '#1a6a9a'); grd.addColorStop(0.55, '#0d4a6e'); grd.addColorStop(1, '#062030');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = grd; ctx.fill();
    ctx.strokeStyle = 'rgba(0,229,255,0.3)'; ctx.lineWidth = 1.2; ctx.stroke();

    neoData.forEach(n => {
      const alt = Math.min(0.5, 0.08 + n.ld * 0.04);
      const p = project(n.vizLat, n.vizLon, R * (1 + alt), neoRot);
      if (!p.visible) return;
      const px = cx + p.x, py = cy + p.y;
      ctx.beginPath(); ctx.arc(px, py, n.haz ? 3.2 : 2.2, 0, Math.PI * 2);
      ctx.fillStyle = n.haz ? '#ff3b30' : '#00e5ff'; ctx.fill();
    });
  }

  function startGlobe() {
    if (neoAnim) return;
    const tick = () => { neoRot = (neoRot + 0.12) % 360; drawGlobe(); neoAnim = requestAnimationFrame(tick); };
    neoAnim = requestAnimationFrame(tick);
  }

  function openNeoDetail(n) {
    openFloat('neo-' + n.id, 'NEO · ' + n.name, `
      <table class="float-table">
        <tr><th>Name</th><td>${n.name}</td></tr>
        <tr><th>Approach</th><td>${n.date}</td></tr>
        <tr><th>Miss distance</th><td>${n.ld.toFixed(3)} LD (${(n.ld*384400).toFixed(0)} km)</td></tr>
        <tr><th>Velocity</th><td>${n.vel.toFixed(2)} km/s</td></tr>
        <tr><th>Est. size</th><td>~${n.size} m</td></tr>
        <tr><th>Abs. magnitude</th><td>${n.abs ?? '—'}</td></tr>
        <tr><th>Hazardous</th><td class="${n.haz?'pha':''}">${n.haz?'YES':'No'}</td></tr>
      </table>`, 360, 300);
  }

  async function loadNEO() {
    try {
      const data = await get(`${CONFIG.endpoints.neoFeed}?start_date=${today()}&end_date=${addDays(7)}&api_key=${CONFIG.API_KEY}`);
      const objs = data.near_earth_objects || {};
      neoData = []; let pha = 0, minLd = Infinity;
      Object.keys(objs).forEach(date => {
        objs[date].forEach(n => {
          const a = n.close_approach_data?.[0]; if (!a) return;
          const ld = parseFloat(a.miss_distance?.kilometers || 0) / 384400;
          const vel = parseFloat(a.relative_velocity?.kilometers_per_second || 0);
          const dmin = n.estimated_diameter?.meters?.estimated_diameter_min || 0;
          const dmax = n.estimated_diameter?.meters?.estimated_diameter_max || 0;
          const haz = n.is_potentially_hazardous_asteroid;
          if (haz) pha++; if (ld < minLd) minLd = ld;
          const hash = (n.id || '').split('').reduce((s, c) => s + c.charCodeAt(0), 0);
          neoData.push({
            id: n.id, name: (n.name || '').replace(/[()]/g, ''),
            date: a.close_approach_date, ld, vel, size: Math.round((dmin + dmax) / 2),
            haz, abs: n.absolute_magnitude_h,
            vizLat: ((hash % 140) - 70) * 0.85, vizLon: ((hash * 13) % 360) - 180
          });
        });
      });
      neoData.sort((a, b) => a.ld - b.ld);
      $('#neo-tot').textContent = neoData.length;
      $('#neo-pha').textContent = pha;
      $('#neo-close').textContent = isFinite(minLd) ? minLd.toFixed(2) : '—';
      $('#neo-n').textContent = neoData.length + ' OBJ';
      $('#neo-list').innerHTML = neoData.slice(0, 30).map(n =>
        `<div class="ni ${n.haz?'pha':''}" data-id="${n.id}">
          <div class="nm">${n.name}</div>
          <div class="mt">${n.date} · ${n.ld.toFixed(2)} LD${n.haz?' · PHA':''}</div>
        </div>`
      ).join('');
      $$('#neo-list .ni').forEach(el => {
        el.onclick = e => {
          e.stopPropagation();
          const n = neoData.find(x => x.id === el.dataset.id);
          if (n) openNeoDetail(n);
        };
      });
      drawGlobe(); startGlobe();
    } catch (e) { console.error('NEO', e); }
  }

  /* ========== EPIC with metadata ========== */
  async function loadEPIC() {
    try {
      const imgs = await get(`${CONFIG.endpoints.epic}?api_key=${CONFIG.API_KEY}`);
      if (!imgs?.length) { $('#epic-prev').innerHTML = '<div class="list-item">No EPIC data</div>'; return; }
      epicCache = imgs[0];
      const [y, m, d] = epicCache.date.split(' ')[0].split('-');
      const src = `${CONFIG.endpoints.epicImg}/${y}/${m}/${d}/png/${epicCache.image}.png?api_key=${CONFIG.API_KEY}`;
      $('#epic-d').textContent = epicCache.date.split(' ')[0];
      const c = epicCache.centroid_coordinates || {};
      const dsc = epicCache.dscovr_j2000_position || {};
      $('#epic-prev').innerHTML = `
        <img src="${src}" alt="EPIC Earth">
        <div class="epic-meta">
          <div class="row"><span class="k">DATE</span><span class="v">${epicCache.date}</span></div>
          <div class="row"><span class="k">CENTROID</span><span class="v">${(c.lat||0).toFixed(2)}° ${(c.lon||0).toFixed(2)}°</span></div>
          <div class="row"><span class="k">DSCOVR</span><span class="v">L1 · ${(Math.sqrt((dsc.x||0)**2+(dsc.y||0)**2+(dsc.z||0)**2)/1e6).toFixed(2)} M km</span></div>
          <div class="row"><span class="k">CAPTION</span><span class="v" style="color:var(--text);font-family:var(--font);font-size:9px">${(epicCache.caption||'').slice(0,120)}</span></div>
          <div class="row"><span class="k">FRAMES</span><span class="v">${imgs.length} available</span></div>
        </div>`;
    } catch (e) {
      $('#epic-prev').innerHTML = `<div class="list-item">${e.message}</div>`;
    }
  }

  /* ========== DONKI enhanced ========== */
  async function loadDONKI() {
    try {
      const start = ago(5);
      const [notes, cmes, flrs, gsts] = await Promise.all([
        get(`${CONFIG.endpoints.donkiN}?startDate=${start}&endDate=${today()}&api_key=${CONFIG.API_KEY}`).catch(() => []),
        get(`${CONFIG.endpoints.donkiCME}?startDate=${start}&endDate=${today()}&api_key=${CONFIG.API_KEY}`).catch(() => []),
        get(`${CONFIG.endpoints.donkiFLR}?startDate=${start}&endDate=${today()}&api_key=${CONFIG.API_KEY}`).catch(() => []),
        get(`${CONFIG.endpoints.donkiGST}?startDate=${start}&endDate=${today()}&api_key=${CONFIG.API_KEY}`).catch(() => [])
      ]);
      donkiCache = [];
      (notes || []).slice(0, 6).forEach(n => donkiCache.push({
        type: (n.messageType || 'NOTE').toUpperCase(),
        title: n.messageID || n.messageType,
        time: (n.messageIssueTime || '').replace('T', ' ').slice(0, 16),
        body: (n.messageBody || '').slice(0, 160)
      }));
      (cmes || []).slice(0, 4).forEach(c => {
        const sp = c.cmeAnalyses?.[0]?.speed;
        donkiCache.push({ type: 'CME', title: `CME${sp ? ' · ' + Math.round(sp) + ' km/s' : ''}`, time: (c.startTime || '').replace('T', ' ').slice(0, 16), body: (c.note || '').slice(0, 120) });
      });
      (flrs || []).slice(0, 4).forEach(f => donkiCache.push({
        type: 'FLARE ' + (f.classType || ''),
        title: f.sourceLocation || f.flrID || 'Solar Flare',
        time: (f.beginTime || '').replace('T', ' ').slice(0, 16),
        body: `Class ${f.classType || '—'} · Peak ${(f.peakTime || '').slice(11, 16)}`
      }));
      (gsts || []).slice(0, 3).forEach(g => {
        const kp = g.allKpIndex?.[0]?.kpIndex;
        donkiCache.push({ type: 'GST', title: `Geomagnetic Storm${kp != null ? ' · Kp ' + kp : ''}`, time: (g.startTime || '').replace('T', ' ').slice(0, 16), body: '' });
      });
      donkiCache.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
      $('#donki-n').textContent = donkiCache.length;
      $('#donki-prev').innerHTML = donkiCache.slice(0, 8).map(e =>
        `<div class="list-item"><div class="t">${e.type} · ${e.time}</div><div class="n">${e.title}</div>${e.body?`<div class="d">${e.body}</div>`:''}</div>`
      ).join('') || '<div class="list-item">No recent events — solar conditions quiet</div>';
    } catch (e) { $('#donki-prev').innerHTML = `<div class="list-item">${e.message}</div>`; }
  }

  /* ========== EONET enhanced ========== */
  async function loadEONET() {
    try {
      const data = await get(`${CONFIG.endpoints.eonet}?status=open&limit=25`);
      eonetCache = (data.events || []).map(ev => {
        const g = ev.geometry?.[ev.geometry.length - 1];
        const cat = ev.categories?.[0];
        return {
          title: ev.title,
          cat: cat?.title || 'Event',
          id: cat?.id || '',
          date: g?.date?.slice(0, 10) || '',
          coords: g?.coordinates,
          sources: (ev.sources || []).map(s => s.id).join(', ')
        };
      });
      $('#eonet-n').textContent = eonetCache.length + ' OPEN';
      $('#eonet-prev').innerHTML = eonetCache.slice(0, 8).map(e =>
        `<div class="list-item">
          <div class="t">${e.cat.toUpperCase()} · ${e.date}</div>
          <div class="n">${e.title}</div>
          <div class="d">${e.coords ? e.coords[1].toFixed(1) + '°, ' + e.coords[0].toFixed(1) + '°' : ''}${e.sources ? ' · ' + e.sources : ''}</div>
        </div>`
      ).join('') || '<div class="list-item">No open events</div>';
    } catch (e) { console.error(e); }
  }

  /* ========== ISS Mission Status ========== */
  async function loadMissions() {
    try {
      const [issNews, crew] = await Promise.all([
        get(`${CONFIG.endpoints.news}?limit=15&search=ISS&ordering=-published_at`),
        get('https://api.open-notify.org/astros.json').catch(() => null)
      ]);
      newsCache = issNews.results || [];
      let crewHtml = '';
      if (crew && crew.people) {
        const issCrew = crew.people.filter(p => (p.craft || '').toUpperCase().includes('ISS'));
        crewHtml = `<div class="list-item"><div class="t">CREW ONBOARD · ${issCrew.length || crew.number}</div>
          <div class="n" style="white-space:normal">${issCrew.map(p => p.name).join(' · ') || '—'}</div></div>`;
      }
      $('#mis-n').textContent = newsCache.length;
      $('#mis-prev').innerHTML = crewHtml + newsCache.slice(0, 7).map(i =>
        `<div class="list-item"><div class="t">${(i.published_at||'').slice(0,10)} · ${(i.news_site||'').slice(0,12)}</div><div class="n">${i.title}</div></div>`
      ).join('');

      // JPL
      const jpl = await get(`${CONFIG.endpoints.news}?limit=8&search=JPL&ordering=-published_at`);
      $('#jpl-prev').innerHTML = (jpl.results || []).slice(0, 6).map(i =>
        `<div class="list-item"><div class="t">JPL · ${(i.published_at||'').slice(0,10)}</div><div class="n">${i.title}</div></div>`
      ).join('') || '<div class="list-item">—</div>';
    } catch (e) { console.error(e); }
  }

  /* ========== Panels / floats ========== */
  function bindUI() {
    $$('.panel.clickable').forEach(t => {
      t.addEventListener('click', e => {
        if (e.target.closest('.leaflet-container') || e.target.closest('#neo-canvas') || e.target.closest('.neo-list')) return;
        const p = t.dataset.panel;
        if (p === 'epic') openEPIC();
        else if (p === 'donki') openDONKI();
        else if (p === 'eonet') openEONET();
        else if (p === 'missions') openMissions();
        else if (p === 'jpl') openJPL();
      });
    });
    // Camera click → full float
    $$('.cam-slot').forEach(slot => {
      slot.addEventListener('click', () => {
        const id = slot.dataset.cam;
        const src = slot.querySelector('iframe')?.src?.replace('controls=0', 'controls=1') || '';
        openFloat('cam-' + id, 'LIVE CAMERA · ' + (slot.querySelector('.cam-label')?.textContent || ''), `
          <iframe src="${src}" style="width:100%;aspect-ratio:16/9;border:0;background:#000" allow="autoplay; encrypted-media" allowfullscreen></iframe>
        `, 640, 400);
      });
    });
    const canvas = $('#neo-canvas');
    if (canvas) {
      canvas.addEventListener('click', e => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        const w = rect.width, h = rect.height, cx = w/2, cy = h/2, R = Math.min(w,h)*0.4;
        let best = null, bestD = 12;
        neoData.forEach(n => {
          const alt = Math.min(0.5, 0.08 + n.ld * 0.04);
          const p = project(n.vizLat, n.vizLon, R*(1+alt), neoRot);
          if (!p.visible) return;
          const d = Math.hypot(cx + p.x - x, cy + p.y - y);
          if (d < bestD) { bestD = d; best = n; }
        });
        if (best) openNeoDetail(best);
      });
    }
  }

  function openEPIC() {
    if (!epicCache) return;
    const [y, m, d] = epicCache.date.split(' ')[0].split('-');
    const src = `${CONFIG.endpoints.epicImg}/${y}/${m}/${d}/png/${epicCache.image}.png?api_key=${CONFIG.API_KEY}`;
    const c = epicCache.centroid_coordinates || {};
    openFloat('epic', 'EPIC · DSCOVR L1', `
      <img src="${src}" style="width:100%;max-width:320px;border-radius:50%;display:block;margin:0 auto" alt="">
      <table class="float-table" style="margin-top:12px">
        <tr><th>Date</th><td>${epicCache.date}</td></tr>
        <tr><th>Centroid</th><td>${(c.lat||0).toFixed(3)}°, ${(c.lon||0).toFixed(3)}°</td></tr>
        <tr><th>Caption</th><td>${epicCache.caption || '—'}</td></tr>
      </table>`, 420, 500);
  }
  function openDONKI() {
    openFloat('donki', 'SPACE WEATHER · DONKI', donkiCache.map(e =>
      `<div class="list-item" style="padding:7px 0"><div class="t">${e.type} · ${e.time}</div><div class="n" style="white-space:normal">${e.title}</div><div class="d">${e.body||''}</div></div>`
    ).join('') || 'Quiet', 480, 420);
  }
  function openEONET() {
    openFloat('eonet', 'NATURAL EVENTS · EONET', eonetCache.map(e =>
      `<div class="list-item" style="padding:6px 0"><div class="t">${e.cat.toUpperCase()} · ${e.date}</div><div class="n" style="white-space:normal">${e.title}</div><div class="d">${e.coords?e.coords[1].toFixed(2)+'°, '+e.coords[0].toFixed(2)+'°':''}</div></div>`
    ).join('') || 'None', 440, 400);
  }
  function openMissions() {
    openFloat('missions', 'ISS MISSION STATUS', newsCache.map(i =>
      `<a href="${i.url}" target="_blank" rel="noopener" class="list-item" style="display:block;text-decoration:none;padding:7px 0">
        <div class="t">${(i.published_at||'').slice(0,10)} · ${i.news_site||''}</div>
        <div class="n" style="white-space:normal;color:var(--text)">${i.title}</div>
      </a>`
    ).join(''), 500, 460);
  }
  function openJPL() {
    openFloat('jpl', 'JPL · ROBOTIC', `
      <iframe src="https://www.youtube.com/embed/live_stream?channel=UCryGek9-xMZ4tqPL4r6_B1w&autoplay=1&mute=1" style="width:100%;aspect-ratio:16/9;border:0;background:#000" allow="autoplay" allowfullscreen></iframe>
      <div id="jpl-fl" style="margin-top:8px">Loading…</div>`, 520, 480);
    get(`${CONFIG.endpoints.news}?limit=8&search=JPL&ordering=-published_at`).then(d => {
      const el = $('#jpl-fl');
      if (el) el.innerHTML = (d.results||[]).map(i =>
        `<a href="${i.url}" target="_blank" rel="noopener" class="list-item" style="display:block;text-decoration:none;padding:5px 0">
          <div class="t">${(i.published_at||'').slice(0,10)}</div>
          <div class="n" style="white-space:normal;color:var(--text)">${i.title}</div></a>`
      ).join('');
    }).catch(() => {});
  }

  async function refresh() {
    $('#btn-refresh').style.opacity = '0.5';
    await Promise.allSettled([loadNEO(), loadEPIC(), loadDONKI(), loadEONET(), loadMissions()]);
    $('#last-upd').textContent = 'UPD ' + utc();
    $('#btn-refresh').style.opacity = '1';
  }

  function init() {
    $('#utc').textContent = utc();
    $('#loc').textContent = loc();
    initSatMap();
    bindUI();
    loadSatTLEs();
    setInterval(updateSatPositions, CONFIG.satMs);
    refresh();
    setInterval(refresh, CONFIG.refreshMs);
    window.addEventListener('resize', drawGlobe);
    $('#btn-refresh').onclick = refresh;
    $('#btn-audio').onclick = () => {
      CONFIG.audio = !CONFIG.audio;
      $('#btn-audio').textContent = CONFIG.audio ? '🔔' : '🔇';
      if (CONFIG.audio) playSOL();
    };
    document.body.addEventListener('click', function u() {
      if (audioCtx?.state === 'suspended') audioCtx.resume();
      document.body.removeEventListener('click', u);
    }, { once: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
