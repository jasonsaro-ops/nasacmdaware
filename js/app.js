(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  let issMap, issMarker, pastLine, futureLine;
  let pastTrail = [], neoData = [], newsCache = [];
  let audioCtx = null, zTop = 100000;
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

  /* —— SOL-style ping (Martian film day marker) —— */
  function playSOL() {
    if (!CONFIG.audio) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime;
      // Soft rising ping then soft decay — similar to the SOL day-change chime
      const freqs = [523.25, 659.25, 783.99]; // C5 E5 G5 soft chord
      freqs.forEach((f, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        const s = t + i * 0.06;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.12 - i * 0.02, s + 0.04);
        g.gain.exponentialRampToValueAtTime(0.001, s + 0.55);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(s); o.stop(s + 0.6);
      });
      // Soft high overtone
      const o2 = audioCtx.createOscillator();
      const g2 = audioCtx.createGain();
      o2.type = 'sine'; o2.frequency.value = 1046.5;
      g2.gain.setValueAtTime(0, t + 0.15);
      g2.gain.linearRampToValueAtTime(0.06, t + 0.2);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      o2.connect(g2); g2.connect(audioCtx.destination);
      o2.start(t + 0.15); o2.stop(t + 0.75);
    } catch (_) {}
  }

  setInterval(() => { $('#utc').textContent = utc(); $('#loc').textContent = loc(); }, 1000);

  /* —— Floating windows (always on top) —— */
  function openFloat(id, title, html, w = 500, h = 400) {
    let el = document.getElementById('f-' + id);
    if (el) {
      el.style.zIndex = ++zTop;
      return el;
    }
    el = document.createElement('div');
    el.className = 'float';
    el.id = 'f-' + id;
    el.style.cssText = `width:${w}px;height:${h}px;left:${Math.max(24, (innerWidth - w) / 2 + (Math.random() * 60 - 30))}px;top:${Math.max(52, (innerHeight - h) / 2 + (Math.random() * 40 - 20))}px;z-index:${++zTop}`;
    el.innerHTML = `<div class="float-h"><span>${title}</span><button class="x" type="button">×</button></div><div class="float-b">${html}</div>`;
    const layer = $('#float-layer');
    layer.appendChild(el);

    el.querySelector('.x').onclick = e => { e.stopPropagation(); el.remove(); };
    // drag
    const hdr = el.querySelector('.float-h');
    let ox, oy, drag = false;
    hdr.onmousedown = e => {
      if (e.target.classList.contains('x')) return;
      drag = true;
      ox = e.clientX - el.offsetLeft;
      oy = e.clientY - el.offsetTop;
      el.style.zIndex = ++zTop;
      e.preventDefault();
    };
    const onMove = e => {
      if (!drag) return;
      el.style.left = Math.max(0, Math.min(innerWidth - 80, e.clientX - ox)) + 'px';
      el.style.top = Math.max(0, Math.min(innerHeight - 40, e.clientY - oy)) + 'px';
    };
    const onUp = () => { drag = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return el;
  }

  /* —— ISS map + past/future trajectory —— */
  function initIssMap() {
    if (issMap) return;
    issMap = L.map('iss-map', { zoomControl: false, worldCopyJump: true, attributionControl: false }).setView([0, 0], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 6 }).addTo(issMap);
    // Past trail — solid red
    pastLine = L.polyline([], { color: '#ff3b30', weight: 2.5, opacity: 0.9 }).addTo(issMap);
    // Future trail — dashed red
    futureLine = L.polyline([], { color: '#ff3b30', weight: 2, opacity: 0.55, dashArray: '6 8' }).addTo(issMap);
    issMarker = L.circleMarker([0, 0], {
      radius: 6, color: '#fff', fillColor: '#ff3b30', fillOpacity: 1, weight: 2
    }).addTo(issMap);
  }

  async function loadISS() {
    try {
      initIssMap();
      const d = await get(CONFIG.endpoints.iss);
      const lat = d.latitude, lon = d.longitude;
      $('#iss-lat').textContent = lat.toFixed(2) + '°';
      $('#iss-lon').textContent = lon.toFixed(2) + '°';
      $('#iss-alt').textContent = d.altitude.toFixed(1);
      $('#iss-vel').textContent = Math.round(d.velocity).toLocaleString();
      $('#iss-vis').textContent = (d.visibility || '—').toUpperCase();

      pastTrail.push([lat, lon]);
      if (pastTrail.length > 60) pastTrail.shift();
      pastLine.setLatLngs(pastTrail);
      issMarker.setLatLng([lat, lon]);

      // Future path: sample positions ~90 min ahead (one orbit ≈ 92 min)
      const now = Math.floor(Date.now() / 1000);
      const timestamps = [];
      for (let i = 1; i <= 18; i++) timestamps.push(now + i * 300); // every 5 min for 90 min
      try {
        const fut = await get(`${CONFIG.endpoints.issPos}?timestamps=${timestamps.join(',')}`);
        if (Array.isArray(fut) && fut.length) {
          const pts = fut.map(p => [p.latitude, p.longitude]);
          futureLine.setLatLngs([[lat, lon], ...pts]);
        }
      } catch (_) { /* future optional */ }

      const c = issMap.getCenter();
      if (Math.abs(c.lat - lat) > 28 || Math.abs(c.lng - lon) > 45)
        issMap.panTo([lat, lon], { animate: true, duration: 1 });
    } catch (e) { console.error('ISS', e); }
  }

  /* —— NEO globe (canvas Earth in space) —— */
  function project(lat, lon, R, rot) {
    const lonR = (lon + rot) * Math.PI / 180;
    const latR = lat * Math.PI / 180;
    const x = R * Math.cos(latR) * Math.sin(lonR);
    const y = -R * Math.sin(latR);
    const z = R * Math.cos(latR) * Math.cos(lonR);
    return { x, y, z, visible: z > -R * 0.15 };
  }

  function drawGlobe() {
    const canvas = $('#neo-canvas');
    if (!canvas) return;
    const wrap = canvas.parentElement;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (w < 10 || h < 10) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) * 0.38;

    // Stars
    ctx.fillStyle = '#0a1828';
    for (let i = 0; i < 80; i++) {
      const sx = (i * 97) % w, sy = (i * 53) % h;
      ctx.globalAlpha = 0.3 + (i % 5) * 0.1;
      ctx.fillRect(sx, sy, 1, 1);
    }
    ctx.globalAlpha = 1;

    // Earth disc
    const grd = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
    grd.addColorStop(0, '#1a6a9a');
    grd.addColorStop(0.5, '#0d4a6e');
    grd.addColorStop(1, '#062030');
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    // Terminator / limb
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,229,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Simple lat/lon grid
    ctx.strokeStyle = 'rgba(0,180,200,0.15)';
    ctx.lineWidth = 0.6;
    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath();
      for (let lon = -180; lon <= 180; lon += 6) {
        const p = project(lat, lon, R, neoRot);
        if (p.z > 0) {
          const px = cx + p.x, py = cy + p.y;
          if (lon === -180) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
    }
    for (let lon = -180; lon < 180; lon += 30) {
      ctx.beginPath();
      let started = false;
      for (let lat = -90; lat <= 90; lat += 6) {
        const p = project(lat, lon, R, neoRot);
        if (p.z > 0) {
          const px = cx + p.x, py = cy + p.y;
          if (!started) { ctx.moveTo(px, py); started = true; }
          else ctx.lineTo(px, py);
        } else started = false;
      }
      ctx.stroke();
    }

    // NEO markers
    neoData.forEach(n => {
      // Map approach distance to altitude above surface for viz
      const alt = Math.min(0.55, 0.08 + n.ld * 0.04);
      const p = project(n.vizLat, n.vizLon, R * (1 + alt), neoRot);
      if (!p.visible) return;
      const px = cx + p.x, py = cy + p.y;
      const col = n.haz ? '#ff3b30' : '#00e5ff';
      ctx.beginPath();
      ctx.arc(px, py, n.haz ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      if (n.haz) {
        ctx.strokeStyle = 'rgba(255,59,48,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }

  function startGlobeAnim() {
    if (neoAnim) return;
    const tick = () => {
      neoRot = (neoRot + 0.15) % 360;
      drawGlobe();
      neoAnim = requestAnimationFrame(tick);
    };
    neoAnim = requestAnimationFrame(tick);
  }

  async function loadNEO() {
    try {
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
          const hash = (n.id || '').split('').reduce((s, c) => s + c.charCodeAt(0), 0);
          neoData.push({
            id: n.id,
            name: (n.name || '').replace(/[()]/g, ''),
            date: a.close_approach_date,
            ld, vel,
            size: Math.round((dmin + dmax) / 2),
            haz,
            abs: n.absolute_magnitude_h,
            vizLat: ((hash % 140) - 70) * 0.85,
            vizLon: ((hash * 13) % 360) - 180
          });
        });
      });
      neoData.sort((a, b) => a.ld - b.ld);
      $('#neo-tot').textContent = neoData.length;
      $('#neo-pha').textContent = pha;
      $('#neo-close').textContent = isFinite(minLd) ? minLd.toFixed(2) : '—';
      $('#neo-n').textContent = neoData.length + ' OBJ';
      drawGlobe();
      startGlobeAnim();
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
        <tr><th>Hazardous</th><td class="${n.haz ? 'pha' : ''}">${n.haz ? 'YES' : 'No'}</td></tr>
      </table>
    `, 360, 300);
  }

  /* —— Data feeds —— */
  let apodCache = null, epicCache = null, donkiCache = [], eonetCache = [];

  async function loadAPOD() {
    try {
      apodCache = await get(`${CONFIG.endpoints.apod}?api_key=${CONFIG.API_KEY}`);
      $('#apod-d').textContent = apodCache.date || '—';
      const url = apodCache.media_type === 'image' ? (apodCache.url || apodCache.hdurl) : null;
      $('#apod-prev').innerHTML = url
        ? `<img src="${url}" style="width:100%;height:100%;object-fit:cover" alt="">`
        : `<div style="padding:6px;color:var(--muted)">${apodCache.title || 'Video'}</div>`;
    } catch (e) { $('#apod-prev').innerHTML = `<div class="list-item">${e.message}</div>`; }
  }

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

  async function loadDONKI() {
    try {
      const notes = await get(`${CONFIG.endpoints.donkiN}?startDate=${ago(7)}&endDate=${today()}&api_key=${CONFIG.API_KEY}`);
      donkiCache = (notes || []).slice(0, 12).map(n => ({
        type: (n.messageType || 'NOTE').toUpperCase(),
        title: n.messageID || n.messageType,
        time: (n.messageIssueTime || '').replace('T', ' ').slice(0, 16),
        body: (n.messageBody || '').slice(0, 180)
      }));
      $('#donki-n').textContent = donkiCache.length;
      $('#donki-prev').innerHTML = donkiCache.slice(0, 5).map(e =>
        `<div class="list-item"><div class="t">${e.type}</div><div class="n">${e.title}</div></div>`
      ).join('') || '<div class="list-item">No recent events</div>';
    } catch (e) { $('#donki-prev').innerHTML = `<div class="list-item">${e.message}</div>`; }
  }

  async function loadEONET() {
    try {
      const data = await get(`${CONFIG.endpoints.eonet}?status=open&limit=20`);
      eonetCache = (data.events || []).map(ev => {
        const g = ev.geometry?.[ev.geometry.length - 1];
        return { title: ev.title, cat: ev.categories?.[0]?.title || 'Event', date: g?.date?.slice(0, 10) || '' };
      });
      $('#eonet-n').textContent = eonetCache.length;
      $('#eonet-prev').innerHTML = eonetCache.slice(0, 5).map(e =>
        `<div class="list-item"><div class="t">${e.cat.toUpperCase()}</div><div class="n">${e.title}</div></div>`
      ).join('') || '<div class="list-item">None open</div>';
    } catch (e) { console.error(e); }
  }

  async function loadNews() {
    try {
      const [all, iss, art, jpl] = await Promise.all([
        get(`${CONFIG.endpoints.news}?limit=12&ordering=-published_at`),
        get(`${CONFIG.endpoints.news}?limit=8&search=ISS&ordering=-published_at`),
        get(`${CONFIG.endpoints.news}?limit=8&search=Artemis&ordering=-published_at`),
        get(`${CONFIG.endpoints.news}?limit=8&search=JPL&ordering=-published_at`)
      ]);
      const map = new Map();
      [...(all.results || []), ...(iss.results || []), ...(art.results || [])].forEach(a => map.set(a.id, a));
      newsCache = [...map.values()].sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));
      $('#mis-n').textContent = newsCache.length;
      $('#mis-prev').innerHTML = newsCache.slice(0, 6).map(i =>
        `<div class="list-item"><div class="t">${(i.news_site || 'NEWS').slice(0, 14)}</div><div class="n">${i.title}</div></div>`
      ).join('');
      $('#jpl-prev').innerHTML = (jpl.results || []).slice(0, 5).map(i =>
        `<div class="list-item"><div class="t">JPL</div><div class="n">${i.title}</div></div>`
      ).join('') || '<div class="list-item">—</div>';
    } catch (e) { console.error(e); }
  }

  /* —— Click handlers —— */
  function bindTiles() {
    $$('.panel.clickable, .tile-iss, .tile-neo').forEach(t => {
      t.addEventListener('click', e => {
        if (e.target.closest('.leaflet-container') || e.target.closest('#neo-canvas')) return;
        const p = t.dataset.panel;
        if (p === 'apod') openAPOD();
        else if (p === 'epic') openEPIC();
        else if (p === 'donki') openDONKI();
        else if (p === 'eonet') openEONET();
        else if (p === 'missions') openMissions();
        else if (p === 'jpl') openJPL();
        else if (p === 'cams') openCams();
        else if (p === 'neo') openNEOList();
        else if (p === 'iss') openISSDetail();
      });
    });
    // Canvas click for NEO pick
    const canvas = $('#neo-canvas');
    if (canvas) {
      canvas.addEventListener('click', e => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        const w = rect.width, h = rect.height;
        const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.38;
        let best = null, bestD = 14;
        neoData.forEach(n => {
          const alt = Math.min(0.55, 0.08 + n.ld * 0.04);
          const p = project(n.vizLat, n.vizLon, R * (1 + alt), neoRot);
          if (!p.visible) return;
          const dx = cx + p.x - x, dy = cy + p.y - y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < bestD) { bestD = d; best = n; }
        });
        if (best) openNeoDetail(best);
      });
    }
  }

  function openAPOD() {
    if (!apodCache) return;
    const d = apodCache;
    let media = d.media_type === 'video'
      ? (d.url.includes('youtube') || d.url.includes('youtu.be')
        ? `<iframe src="${d.url.replace('watch?v=', 'embed/').replace('youtu.be/', 'youtube.com/embed/')}" style="width:100%;aspect-ratio:16/9;border:0" allowfullscreen></iframe>`
        : `<video controls src="${d.url}" style="width:100%"></video>`)
      : `<img src="${d.hdurl || d.url}" alt="">`;
    openFloat('apod', 'APOD · ' + (d.date || ''), `${media}<h3 style="margin-top:10px">${d.title || ''}</h3><p>${d.explanation || ''}</p>`, 540, 500);
  }

  function openEPIC() {
    if (!epicCache) return;
    const [y, m, d] = epicCache.date.split(' ')[0].split('-');
    const src = `${CONFIG.endpoints.epicImg}/${y}/${m}/${d}/png/${epicCache.image}.png?api_key=${CONFIG.API_KEY}`;
    openFloat('epic', 'EPIC · DSCOVR L1', `<img src="${src}" style="width:100%;border-radius:50%;max-width:340px;display:block;margin:0 auto" alt=""><p style="text-align:center;margin-top:8px">${epicCache.date}</p>`, 400, 460);
  }

  function openDONKI() {
    openFloat('donki', 'SPACE WEATHER · DONKI', donkiCache.map(e =>
      `<div class="list-item" style="padding:7px 0"><div class="t">${e.type} · ${e.time}</div><div class="n" style="white-space:normal">${e.title}</div><div style="color:var(--muted);font-size:10px;margin-top:2px">${e.body}</div></div>`
    ).join('') || 'No events', 460, 400);
  }

  function openEONET() {
    openFloat('eonet', 'NATURAL EVENTS · EONET', eonetCache.map(e =>
      `<div class="list-item" style="padding:6px 0"><div class="t">${e.cat.toUpperCase()} · ${e.date}</div><div class="n" style="white-space:normal">${e.title}</div></div>`
    ).join('') || 'None', 420, 380);
  }

  function openMissions() {
    openFloat('missions', 'MISSION DIGEST', newsCache.map(i =>
      `<a href="${i.url}" target="_blank" rel="noopener" class="list-item" style="display:block;text-decoration:none;padding:7px 0">
        <div class="t">${(i.news_site || '').toUpperCase()} · ${(i.published_at || '').slice(0, 10)}</div>
        <div class="n" style="white-space:normal;color:var(--text)">${i.title}</div>
      </a>`
    ).join(''), 480, 460);
  }

  function openJPL() {
    openFloat('jpl', 'JPL · ROBOTIC', `
      <div style="margin-bottom:10px">
        <div style="font-size:8px;letter-spacing:0.1em;color:var(--muted);margin-bottom:4px">CLEAN ROOM / HIGH BAY</div>
        <iframe src="https://www.youtube.com/embed/live_stream?channel=UCryGek9-xMZ4tqPL4r6_B1w&autoplay=0&mute=1" style="width:100%;aspect-ratio:16/9;border:0;background:#000" allowfullscreen></iframe>
      </div>
      <div id="jpl-float-list">Loading…</div>
    `, 500, 480);
    get(`${CONFIG.endpoints.news}?limit=10&search=JPL&ordering=-published_at`).then(d => {
      const el = document.querySelector('#jpl-float-list');
      if (el) el.innerHTML = (d.results || []).map(i =>
        `<a href="${i.url}" target="_blank" rel="noopener" class="list-item" style="display:block;text-decoration:none;padding:5px 0">
          <div class="t">${(i.published_at || '').slice(0, 10)}</div>
          <div class="n" style="white-space:normal;color:var(--text)">${i.title}</div>
        </a>`
      ).join('');
    }).catch(() => {});
  }

  function openCams() {
    openFloat('cams', 'LIVE CAMERA FEEDS', `
      <div class="cam-grid">
        <div><div style="font-size:8px;letter-spacing:0.1em;color:var(--muted);margin-bottom:4px">ISS HD EARTH</div>
          <iframe src="https://www.youtube.com/embed/awQzjn72bI0?autoplay=0&mute=1" allowfullscreen></iframe></div>
        <div><div style="font-size:8px;letter-spacing:0.1em;color:var(--muted);margin-bottom:4px">ISS LIVE</div>
          <iframe src="https://www.youtube.com/embed/M3HKLzjvKPc?autoplay=0&mute=1" allowfullscreen></iframe></div>
      </div>
      <p style="margin-top:8px;font-size:10px;color:var(--muted)">Feeds may show recorded views during eclipse or operations.</p>
    `, 620, 400);
  }

  function openNEOList() {
    openFloat('neolist', 'NEAR-EARTH OBJECTS · 7-DAY', `
      <table class="float-table">
        <thead><tr><th>NAME</th><th>DATE</th><th>LD</th><th>km/s</th><th>m</th><th>PHA</th></tr></thead>
        <tbody>
          ${neoData.slice(0, 25).map(n => `
            <tr style="cursor:pointer" data-id="${n.id}">
              <td>${n.name.length > 16 ? n.name.slice(0, 14) + '…' : n.name}</td>
              <td>${n.date}</td><td>${n.ld.toFixed(2)}</td><td>${n.vel.toFixed(1)}</td>
              <td>${n.size}</td><td class="${n.haz ? 'pha' : ''}">${n.haz ? 'YES' : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <p style="margin-top:8px;font-size:10px;color:var(--muted)">Click row or globe marker for detail.</p>
    `, 540, 460);
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
      <p style="margin-top:10px;font-size:10px;color:var(--muted)">Solid red = past track · Dashed red = predicted future (~90 min). Source: WhereTheISS.at</p>
    `, 340, 300);
    get(CONFIG.endpoints.iss).then(d => {
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      set('fd-lat', d.latitude.toFixed(4) + '°');
      set('fd-lon', d.longitude.toFixed(4) + '°');
      set('fd-alt', d.altitude.toFixed(2) + ' km');
      set('fd-vel', Math.round(d.velocity).toLocaleString() + ' km/h');
      set('fd-vis', (d.visibility || '—').toUpperCase());
      set('fd-foot', Math.round(d.footprint) + ' km');
    }).catch(() => {});
  }

  async function refresh() {
    $('#btn-refresh').style.opacity = '0.5';
    await Promise.allSettled([loadAPOD(), loadNEO(), loadEPIC(), loadDONKI(), loadEONET(), loadNews()]);
    $('#last-upd').textContent = 'UPD ' + utc();
    $('#btn-refresh').style.opacity = '1';
  }

  function init() {
    $('#utc').textContent = utc();
    $('#loc').textContent = loc();
    initIssMap();
    bindTiles();
    loadISS();
    setInterval(loadISS, CONFIG.issMs);
    refresh();
    setInterval(refresh, CONFIG.refreshMs);
    window.addEventListener('resize', () => drawGlobe());

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
