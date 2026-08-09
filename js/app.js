(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  let world = null;
  let satRecords = {}; // id -> {satrec, name, color, enabled, pos, path}
  let neoData = [], newsCache = [], donkiCache = [], eonetCache = [];
  let epicCache = null, audioCtx = null, zTop = 100000;
  let neoRot = 0, neoAnim = null;
  let focusId = 25544;

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

  /* —— Floating windows —— */
  function openFloat(id, title, html, w = 480, h = 400) {
    let el = document.getElementById('f-' + id);
    if (el) { el.style.zIndex = ++zTop; return el; }
    el = document.createElement('div');
    el.className = 'float';
    el.id = 'f-' + id;
    el.style.cssText = `width:${w}px;height:${h}px;left:${Math.max(24,(innerWidth-w)/2+(Math.random()*50-25))}px;top:${Math.max(52,(innerHeight-h)/2+(Math.random()*40-20))}px;z-index:${++zTop}`;
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

  /* ========== 3D GLOBE (issinfo-style) ========== */
  function initGlobe() {
    const el = $('#globe-container');
    if (!el || world) return;
    const w = el.clientWidth || 400;
    const h = el.clientHeight || 300;

    world = Globe()
      (el)
      .width(w)
      .height(h)
      .backgroundColor('#000000')
      .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
      .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
      .atmosphereColor('#4a9eff')
      .atmosphereAltitude(0.15)
      .pointsData([])
      .pointAltitude(0.01)
      .pointRadius(0.45)
      .pointColor('color')
      .pointsMerge(false)
      .pathsData([])
      .pathColor('color')
      .pathStroke(0.8)
      .pathPointAlt(0.008)
      .pathDashLength(0.01)
      .pathDashGap(0)
      .labelsData([])
      .labelText('name')
      .labelSize(1.2)
      .labelColor('color')
      .labelDotRadius(0.3)
      .labelAltitude(0.02)
      .labelResolution(2);

    // Auto-rotate slowly
    world.controls().autoRotate = true;
    world.controls().autoRotateSpeed = 0.35;
    world.controls().enableZoom = true;

    window.addEventListener('resize', () => {
      if (!world) return;
      const c = $('#globe-container');
      world.width(c.clientWidth).height(c.clientHeight);
    });
  }

  function propPos(satrec, date) {
    try {
      const pv = satellite.propagate(satrec, date);
      if (!pv.position) return null;
      const gmst = satellite.gstime(date);
      const gd = satellite.eciToGeodetic(pv.position, gmst);
      const lat = satellite.degreesLat(gd.latitude);
      const lon = satellite.degreesLong(gd.longitude);
      const alt = gd.height;
      let vel = 0;
      if (pv.velocity) {
        const v = pv.velocity;
        vel = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) * 3600;
      }
      return { lat, lon, alt, vel };
    } catch (_) { return null; }
  }

  function orbitPath(satrec, stepMin, totalMin) {
    const pts = [];
    const now = new Date();
    for (let m = -totalMin / 2; m <= totalMin / 2; m += stepMin) {
      const p = propPos(satrec, new Date(now.getTime() + m * 60000));
      if (p) pts.push([p.lat, p.lon]);
    }
    return pts;
  }

  async function loadSatTLEs() {
    initGlobe();
    const wanted = new Map(CONFIG.sats.map(s => [s.id, s]));
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
      } catch (e) { console.warn('TLE', url, e.message); }
    }

    all.forEach(item => {
      const id = item.NORAD_CAT_ID || item.norad_cat_id;
      if (!wanted.has(id)) return;
      const meta = wanted.get(id);
      try {
        let rec = null;
        if (item.EPOCH && item.MEAN_MOTION) rec = satellite.json2satrec(item);
        else if (item.TLE_LINE1 && item.TLE_LINE2) rec = satellite.twoline2satrec(item.TLE_LINE1, item.TLE_LINE2);
        if (!rec || rec.error) return;
        satRecords[id] = {
          satrec: rec, name: meta.name, color: meta.color,
          enabled: true, primary: !!meta.primary, pos: null, path: []
        };
      } catch (e) { console.warn('satrec', id, e); }
    });

    // Build toggles
    const tog = $('#sat-toggles');
    tog.innerHTML = '<div class="hd">OTHER SATELLITES</div>' + CONFIG.sats.map(s => {
      const on = satRecords[s.id] || s.id === 25544;
      return `<label data-id="${s.id}">
        <input type="checkbox" ${on && (satRecords[s.id]?.enabled !== false) ? 'checked' : ''} ${on ? '' : 'disabled'}>
        <i class="dot" style="background:${s.color}"></i>${s.name}
      </label>`;
    }).join('');

    tog.querySelectorAll('label').forEach(lab => {
      const id = +lab.dataset.id;
      lab.querySelector('input').onchange = e => {
        if (satRecords[id]) {
          satRecords[id].enabled = e.target.checked;
          updateGlobe();
        }
      };
    });

    $('#sat-count').textContent = Object.keys(satRecords).length + ' SATS';
    updateGlobe();
  }

  function updateGlobe() {
    if (!world) return;
    const now = new Date();
    const points = [];
    const paths = [];
    const labels = [];
    const barRows = [];

    Object.keys(satRecords).forEach(idStr => {
      const id = +idStr;
      const rec = satRecords[id];
      if (!rec || !rec.enabled) return;

      const pos = propPos(rec.satrec, now);
      if (!pos) return;
      rec.pos = pos;

      // Full orbit ring (~1–2 periods)
      const pathPts = orbitPath(rec.satrec, 3, 110);
      rec.path = pathPts;

      points.push({ lat: pos.lat, lng: pos.lon, color: rec.color, name: rec.name, id });
      labels.push({ lat: pos.lat, lng: pos.lon, name: rec.name, color: rec.color });
      if (pathPts.length > 2) {
        paths.push({ coords: pathPts.map(p => [p[0], p[1]]), color: rec.color, id });
      }

      barRows.push({ id, name: rec.name, color: rec.color, ...pos });
    });

    // ISS high-accuracy overlay from WTIA
    updateISSOverlay(points, paths, labels, barRows).then(() => {
      world.pointsData(points)
        .pointColor(d => d.color)
        .pathsData(paths)
        .pathColor(d => d.color)
        .labelsData(labels)
        .labelColor(d => d.color);

      // Bottom bar
      const bar = $('#sat-bar');
      bar.innerHTML = barRows.map(s => `
        <div class="sb ${s.id === focusId ? 'active' : ''}" data-id="${s.id}">
          <i class="dot" style="background:${s.color}"></i>
          <span class="nm">${s.name}</span>
          <span class="tv">Lat ${s.lat.toFixed(2)}°</span>
          <span class="tv">Lon ${s.lon.toFixed(2)}°</span>
          <span class="tv">Alt ${s.alt.toFixed(0)} km</span>
          <span class="tv">Vel ${Math.round(s.vel).toLocaleString()} km/h</span>
        </div>`).join('');

      bar.querySelectorAll('.sb').forEach(el => {
        el.onclick = () => {
          focusId = +el.dataset.id;
          const s = barRows.find(x => x.id === focusId);
          if (s) openSatDetail(s);
          updateGlobe();
        };
      });
    });
  }

  async function updateISSOverlay(points, paths, labels, barRows) {
    try {
      const d = await get(CONFIG.endpoints.iss);
      const lat = d.latitude, lon = d.longitude, alt = d.altitude, vel = d.velocity;
      // Replace ISS point if present
      const ix = points.findIndex(p => p.id === 25544);
      const issPt = { lat, lng: lon, color: '#ffffff', name: 'ISS', id: 25544 };
      if (ix >= 0) points[ix] = issPt; else points.push(issPt);

      const li = labels.findIndex(l => l.name === 'ISS');
      const issLab = { lat, lng: lon, name: 'ISS', color: '#ffffff' };
      if (li >= 0) labels[li] = issLab; else labels.push(issLab);

      const bi = barRows.findIndex(b => b.id === 25544);
      const issBar = { id: 25544, name: 'ISS', color: '#ffffff', lat, lon, alt, vel };
      if (bi >= 0) barRows[bi] = issBar; else barRows.push(issBar);

      if (satRecords[25544]) {
        satRecords[25544].pos = { lat, lon, alt, vel };
      } else {
        satRecords[25544] = { satrec: null, name: 'ISS', color: '#ffffff', enabled: true, primary: true, pos: { lat, lon, alt, vel }, path: [] };
      }
    } catch (e) { console.warn('WTIA ISS', e.message); }
  }

  function openSatDetail(s) {
    openFloat('sat-' + s.id, s.name + ' · TELEMETRY', `
      <table class="float-table">
        <tr><th>Satellite</th><td>${s.name}</td></tr>
        <tr><th>NORAD ID</th><td>${s.id}</td></tr>
        <tr><th>Latitude</th><td>${s.lat.toFixed(4)}°</td></tr>
        <tr><th>Longitude</th><td>${s.lon.toFixed(4)}°</td></tr>
        <tr><th>Altitude</th><td>${s.alt.toFixed(2)} km</td></tr>
        <tr><th>Velocity</th><td>${Math.round(s.vel).toLocaleString()} km/h</td></tr>
      </table>
      <p style="margin-top:10px">Orbital path shown on 3D globe. ISS position refined via WhereTheISS.at; others via Celestrak TLE + SGP4.</p>
    `, 360, 320);
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

  function drawNeoGlobe() {
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
    for (let i = 0; i < 50; i++) {
      ctx.globalAlpha = 0.3; ctx.fillRect((i * 97) % w, (i * 53) % h, 1, 1);
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
      ctx.beginPath(); ctx.arc(cx + p.x, cy + p.y, n.haz ? 3 : 2, 0, Math.PI * 2);
      ctx.fillStyle = n.haz ? '#ff3b30' : '#00e5ff'; ctx.fill();
    });
  }

  function startNeoAnim() {
    if (neoAnim) return;
    const tick = () => { neoRot = (neoRot + 0.12) % 360; drawNeoGlobe(); neoAnim = requestAnimationFrame(tick); };
    neoAnim = requestAnimationFrame(tick);
  }

  function openNeoDetail(n) {
    openFloat('neo-' + n.id, 'NEO · ' + n.name, `
      <table class="float-table">
        <tr><th>Name</th><td>${n.name}</td></tr>
        <tr><th>Approach</th><td>${n.date}</td></tr>
        <tr><th>Miss distance</th><td>${n.ld.toFixed(3)} LD (${(n.ld * 384400).toFixed(0)} km)</td></tr>
        <tr><th>Velocity</th><td>${n.vel.toFixed(2)} km/s</td></tr>
        <tr><th>Est. size</th><td>~${n.size} m</td></tr>
        <tr><th>Hazardous</th><td class="${n.haz ? 'pha' : ''}">${n.haz ? 'YES' : 'No'}</td></tr>
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
            date: a.close_approach_date, ld, vel, size: Math.round((dmin + dmax) / 2), haz,
            abs: n.absolute_magnitude_h,
            vizLat: ((hash % 140) - 70) * 0.85, vizLon: ((hash * 13) % 360) - 180
          });
        });
      });
      neoData.sort((a, b) => a.ld - b.ld);
      $('#neo-tot').textContent = neoData.length;
      $('#neo-pha').textContent = pha;
      $('#neo-close').textContent = isFinite(minLd) ? minLd.toFixed(2) : '—';
      $('#neo-n').textContent = neoData.length + ' OBJ';
      $('#neo-list').innerHTML = neoData.slice(0, 40).map(n =>
        `<div class="ni ${n.haz ? 'pha' : ''}" data-id="${n.id}">
          <div class="nm">${n.name}</div>
          <div class="mt">${n.date} · ${n.ld.toFixed(2)} LD${n.haz ? ' · PHA' : ''}</div>
        </div>`
      ).join('');
      $$('#neo-list .ni').forEach(el => {
        el.onclick = e => {
          e.stopPropagation();
          const n = neoData.find(x => x.id === el.dataset.id);
          if (n) openNeoDetail(n);
        };
      });
      drawNeoGlobe(); startNeoAnim();
    } catch (e) { console.error('NEO', e); }
  }

  /* ========== EPIC ========== */
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
      const dist = Math.sqrt((dsc.x || 0) ** 2 + (dsc.y || 0) ** 2 + (dsc.z || 0) ** 2) / 1e6;
      $('#epic-prev').innerHTML = `
        <img src="${src}" alt="EPIC" id="epic-img">
        <div class="epic-meta">
          <div class="row"><span class="k">DATE</span><span class="v">${epicCache.date}</span></div>
          <div class="row"><span class="k">CENTROID</span><span class="v">${(c.lat || 0).toFixed(2)}° ${(c.lon || 0).toFixed(2)}°</span></div>
          <div class="row"><span class="k">DSCOVR</span><span class="v">L1 · ${dist.toFixed(2)} M km</span></div>
          <div class="row"><span class="k">FRAMES</span><span class="v">${imgs.length}</span></div>
          <div class="row"><span class="k">CAPTION</span><span class="v" style="color:var(--text);font-family:var(--font);font-size:9px">${(epicCache.caption || '').slice(0, 100)}</span></div>
        </div>`;
      $('#epic-img')?.addEventListener('click', openEPIC);
    } catch (e) { $('#epic-prev').innerHTML = `<div class="list-item">${e.message}</div>`; }
  }

  function openEPIC() {
    if (!epicCache) return;
    const [y, m, d] = epicCache.date.split(' ')[0].split('-');
    const src = `${CONFIG.endpoints.epicImg}/${y}/${m}/${d}/png/${epicCache.image}.png?api_key=${CONFIG.API_KEY}`;
    const c = epicCache.centroid_coordinates || {};
    openFloat('epic', 'EPIC · DSCOVR L1', `
      <img src="${src}" style="width:100%;max-width:340px;border-radius:50%;display:block;margin:0 auto" alt="">
      <table class="float-table" style="margin-top:12px">
        <tr><th>Date</th><td>${epicCache.date}</td></tr>
        <tr><th>Centroid</th><td>${(c.lat || 0).toFixed(3)}°, ${(c.lon || 0).toFixed(3)}°</td></tr>
        <tr><th>Caption</th><td>${epicCache.caption || '—'}</td></tr>
      </table>`, 420, 500);
  }

  /* ========== DONKI ========== */
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
      (notes || []).slice(0, 8).forEach(n => donkiCache.push({
        type: (n.messageType || 'NOTE').toUpperCase(),
        title: n.messageID || n.messageType,
        time: (n.messageIssueTime || '').replace('T', ' ').slice(0, 16),
        body: (n.messageBody || '').slice(0, 300)
      }));
      (cmes || []).slice(0, 5).forEach(c => {
        const sp = c.cmeAnalyses?.[0]?.speed;
        donkiCache.push({ type: 'CME', title: `CME${sp ? ' · ' + Math.round(sp) + ' km/s' : ''}`, time: (c.startTime || '').replace('T', ' ').slice(0, 16), body: (c.note || '').slice(0, 200) });
      });
      (flrs || []).slice(0, 5).forEach(f => donkiCache.push({
        type: 'FLARE ' + (f.classType || ''),
        title: f.sourceLocation || f.flrID || 'Solar Flare',
        time: (f.beginTime || '').replace('T', ' ').slice(0, 16),
        body: `Class ${f.classType || '—'} · Peak ${(f.peakTime || '').slice(11, 16)}`
      }));
      (gsts || []).slice(0, 4).forEach(g => {
        const kp = g.allKpIndex?.[0]?.kpIndex;
        donkiCache.push({ type: 'GST', title: `Geomagnetic Storm${kp != null ? ' · Kp ' + kp : ''}`, time: (g.startTime || '').replace('T', ' ').slice(0, 16), body: '' });
      });
      donkiCache.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
      $('#donki-n').textContent = donkiCache.length;
      $('#donki-prev').innerHTML = donkiCache.slice(0, 10).map((e, i) =>
        `<div class="list-item" data-idx="${i}"><div class="t">${e.type} · ${e.time}</div><div class="n">${e.title}</div></div>`
      ).join('') || '<div class="list-item">No recent events</div>';
      $$('#donki-prev .list-item[data-idx]').forEach(el => {
        el.onclick = () => {
          const e = donkiCache[+el.dataset.idx];
          if (!e) return;
          openFloat('donki-' + el.dataset.idx, e.type, `
            <table class="float-table">
              <tr><th>Type</th><td>${e.type}</td></tr>
              <tr><th>Time</th><td>${e.time} UTC</td></tr>
              <tr><th>Title</th><td>${e.title}</td></tr>
            </table>
            <p style="margin-top:10px">${e.body || 'No additional detail.'}</p>`, 420, 320);
        };
      });
    } catch (e) { $('#donki-prev').innerHTML = `<div class="list-item">${e.message}</div>`; }
  }

  /* ========== EONET ========== */
  async function loadEONET() {
    try {
      const data = await get(`${CONFIG.endpoints.eonet}?status=open&limit=30`);
      eonetCache = (data.events || []).map(ev => {
        const g = ev.geometry?.[ev.geometry.length - 1];
        const cat = ev.categories?.[0];
        return {
          title: ev.title, cat: cat?.title || 'Event', id: cat?.id || '',
          date: g?.date?.slice(0, 10) || '', coords: g?.coordinates,
          sources: (ev.sources || []).map(s => s.id).join(', '),
          link: (ev.sources || [])[0]?.url || ''
        };
      });
      $('#eonet-n').textContent = eonetCache.length + ' OPEN';
      $('#eonet-prev').innerHTML = eonetCache.slice(0, 12).map((e, i) =>
        `<div class="list-item" data-idx="${i}">
          <div class="t">${e.cat.toUpperCase()} · ${e.date}</div>
          <div class="n">${e.title}</div>
        </div>`
      ).join('') || '<div class="list-item">No open events</div>';
      $$('#eonet-prev .list-item[data-idx]').forEach(el => {
        el.onclick = () => {
          const e = eonetCache[+el.dataset.idx];
          if (!e) return;
          openFloat('eonet-' + el.dataset.idx, e.cat.toUpperCase(), `
            <table class="float-table">
              <tr><th>Event</th><td>${e.title}</td></tr>
              <tr><th>Category</th><td>${e.cat}</td></tr>
              <tr><th>Date</th><td>${e.date}</td></tr>
              <tr><th>Location</th><td>${e.coords ? e.coords[1].toFixed(3) + '°, ' + e.coords[0].toFixed(3) + '°' : '—'}</td></tr>
              <tr><th>Sources</th><td>${e.sources || '—'}</td></tr>
            </table>
            ${e.link ? `<p style="margin-top:10px"><a href="${e.link}" target="_blank" rel="noopener" style="color:var(--cyan)">Open source →</a></p>` : ''}`, 420, 340);
        };
      });
    } catch (e) { console.error(e); }
  }

  /* ========== Missions ========== */
  async function loadMissions() {
    try {
      const [issNews, crew] = await Promise.all([
        get(`${CONFIG.endpoints.news}?limit=15&search=ISS&ordering=-published_at`),
        get('https://api.open-notify.org/astros.json').catch(() => null)
      ]);
      newsCache = issNews.results || [];
      let html = '';
      if (crew?.people) {
        const issCrew = crew.people.filter(p => (p.craft || '').toUpperCase().includes('ISS'));
        html += `<div class="list-item" data-crew="1"><div class="t">CREW ONBOARD · ${issCrew.length || crew.number}</div>
          <div class="n" style="white-space:normal">${issCrew.map(p => p.name).join(' · ') || '—'}</div></div>`;
      }
      html += newsCache.slice(0, 8).map((i, idx) =>
        `<div class="list-item" data-news="${idx}"><div class="t">${(i.published_at || '').slice(0, 10)} · ${(i.news_site || '').slice(0, 12)}</div><div class="n">${i.title}</div></div>`
      ).join('');
      $('#mis-n').textContent = newsCache.length;
      $('#mis-prev').innerHTML = html;
      $$('#mis-prev .list-item[data-news]').forEach(el => {
        el.onclick = () => {
          const i = newsCache[+el.dataset.news];
          if (!i) return;
          openFloat('news-' + el.dataset.news, 'ISS UPDATE', `
            <h3>${i.title}</h3>
            <p style="color:var(--muted);font-size:10px;margin:6px 0">${(i.published_at || '').slice(0, 16)} · ${i.news_site || ''}</p>
            <p>${i.summary || ''}</p>
            <p style="margin-top:10px"><a href="${i.url}" target="_blank" rel="noopener" style="color:var(--cyan)">Read full article →</a></p>`, 460, 380);
        };
      });
      $$('#mis-prev .list-item[data-crew]').forEach(el => {
        el.onclick = () => {
          if (!crew?.people) return;
          const issCrew = crew.people.filter(p => (p.craft || '').toUpperCase().includes('ISS'));
          openFloat('crew', 'ISS CREW', `
            <table class="float-table">
              ${issCrew.map(p => `<tr><th>${p.craft || 'ISS'}</th><td>${p.name}</td></tr>`).join('')}
            </table>
            <p style="margin-top:8px">Total people in space: ${crew.number}</p>`, 360, 300);
        };
      });

      const jpl = await get(`${CONFIG.endpoints.news}?limit=10&search=JPL&ordering=-published_at`);
      const jplItems = jpl.results || [];
      $('#jpl-prev').innerHTML = jplItems.slice(0, 8).map((i, idx) =>
        `<div class="list-item" data-jpl="${idx}"><div class="t">JPL · ${(i.published_at || '').slice(0, 10)}</div><div class="n">${i.title}</div></div>`
      ).join('') || '<div class="list-item">—</div>';
      $$('#jpl-prev .list-item[data-jpl]').forEach(el => {
        el.onclick = () => {
          const i = jplItems[+el.dataset.jpl];
          if (!i) return;
          openFloat('jpl-' + el.dataset.jpl, 'JPL UPDATE', `
            <h3>${i.title}</h3>
            <p style="color:var(--muted);font-size:10px;margin:6px 0">${(i.published_at || '').slice(0, 16)} · ${i.news_site || ''}</p>
            <p>${i.summary || ''}</p>
            <p style="margin-top:10px"><a href="${i.url}" target="_blank" rel="noopener" style="color:var(--cyan)">Read full article →</a></p>`, 460, 380);
        };
      });
    } catch (e) { console.error(e); }
  }

  function bindCams() {
    $$('.cam-slot').forEach(slot => {
      slot.addEventListener('click', () => {
        const src = (slot.dataset.src || '') + '&controls=1';
        const label = slot.querySelector('.cam-label')?.textContent || 'CAMERA';
        openFloat('cam-' + slot.dataset.cam, 'LIVE · ' + label, `
          <iframe src="${src}" style="width:100%;aspect-ratio:16/9;border:0;background:#000" allow="autoplay; encrypted-media" allowfullscreen></iframe>
        `, 640, 400);
      });
    });
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
    initGlobe();
    bindCams();
    loadSatTLEs();
    setInterval(updateGlobe, CONFIG.satMs);
    refresh();
    setInterval(refresh, CONFIG.refreshMs);
    window.addEventListener('resize', drawNeoGlobe);
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
