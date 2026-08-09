(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  let world = null, slWorld = null;
  let satRecords = {};
  let starlinkSats = []; // {id, name, satrec, raan, inc, color, trainId, pos}
  let starlinkTrains = []; // {id, label, color, raan, inc, count, sats[]}
  let activeTrainId = null;
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
        g.gain.linearRampToValueAtTime(0.1 - i * 0.02, s + 0.04);
        g.gain.exponentialRampToValueAtTime(0.001, s + 0.5);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(s); o.stop(s + 0.55);
      });
    } catch (_) {}
  }

  setInterval(() => { $('#utc').textContent = utc(); $('#loc').textContent = loc(); }, 1000);

  function openFloat(id, title, html, w = 460, h = 380) {
    let el = document.getElementById('f-' + id);
    if (el) { el.style.zIndex = ++zTop; return el; }
    el = document.createElement('div');
    el.className = 'float';
    el.id = 'f-' + id;
    el.style.cssText = `width:${w}px;height:${h}px;left:${Math.max(20,(innerWidth-w)/2+(Math.random()*40-20))}px;top:${Math.max(48,(innerHeight-h)/2+(Math.random()*30-15))}px;z-index:${++zTop}`;
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
      el.style.left = Math.max(0, Math.min(innerWidth - 60, e.clientX - ox)) + 'px';
      el.style.top = Math.max(0, Math.min(innerHeight - 30, e.clientY - oy)) + 'px';
    });
    window.addEventListener('mouseup', () => { drag = false; });
    return el;
  }

  /* ========== SGP4 helpers ========== */
  function propPos(satrec, date) {
    try {
      const pv = satellite.propagate(satrec, date);
      if (!pv.position) return null;
      const gmst = satellite.gstime(date);
      const gd = satellite.eciToGeodetic(pv.position, gmst);
      let vel = 0;
      if (pv.velocity) {
        const v = pv.velocity;
        vel = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) * 3600;
      }
      return {
        lat: satellite.degreesLat(gd.latitude),
        lon: satellite.degreesLong(gd.longitude),
        alt: gd.height,
        vel
      };
    } catch (_) { return null; }
  }

  function orbitPathSplit(satrec, stepMin, halfMin) {
    const past = [], future = [];
    const now = new Date();
    for (let m = -halfMin; m <= 0; m += stepMin) {
      const p = propPos(satrec, new Date(now.getTime() + m * 60000));
      if (p) past.push([p.lat, p.lon]);
    }
    for (let m = 0; m <= halfMin; m += stepMin) {
      const p = propPos(satrec, new Date(now.getTime() + m * 60000));
      if (p) future.push([p.lat, p.lon]);
    }
    return { past, future };
  }

  function makeSatrec(item) {
    try {
      if (!item) return null;
      if (item.EPOCH && (item.MEAN_MOTION || item.mean_motion)) {
        return satellite.json2satrec(item);
      }
      const l1 = item.TLE_LINE1 || item.tle1 || item.line1;
      const l2 = item.TLE_LINE2 || item.tle2 || item.line2;
      if (l1 && l2) return satellite.twoline2satrec(l1, l2);
      // ivanstanojevic format
      if (item.line1 && item.line2) return satellite.twoline2satrec(item.line1, item.line2);
    } catch (e) { console.warn('makeSatrec', e); }
    return null;
  }

  async function fetchTLE(noradId) {
    const id = String(noradId);
    const sources = [
      `https://celestrak.org/NORAD/elements/gp.php?CATNR=${id}&FORMAT=JSON`,
      `https://tle.ivanstanojevic.me/api/tle/${id}`
    ];
    for (const url of sources) {
      try {
        const data = await get(url);
        // Celestrak returns array of OMM objects
        if (Array.isArray(data) && data.length) {
          const rec = makeSatrec(data[0]);
          if (rec && !rec.error) return rec;
        }
        // Single OMM object
        if (data && data.NORAD_CAT_ID) {
          const rec = makeSatrec(data);
          if (rec && !rec.error) return rec;
        }
        // ivanstanojevic: { line1, line2, name, satelliteId }
        if (data && (data.line1 || data.TLE_LINE1)) {
          const rec = makeSatrec(data);
          if (rec && !rec.error) return rec;
        }
      } catch (e) {
        console.warn('TLE source failed', url, e.message);
      }
    }
    return null;
  }

  /* ========== MAJOR SATS GLOBE ========== */
  function initGlobe() {
    const el = $('#globe-container');
    if (!el || world) return;
    world = Globe()(el)
      .width(el.clientWidth || 400)
      .height(el.clientHeight || 280)
      .backgroundColor('#000000')
      .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
      .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
      .atmosphereColor('#4a9eff')
      .atmosphereAltitude(0.14)
      .pointsData([])
      .pointAltitude(0.015)
      .pointRadius(0.55)
      .pointColor('color')
      .pathsData([])
      .pathPoints('coords')
      .pathPointLat(p => p[0])
      .pathPointLng(p => p[1])
      .pathPointAlt(0.012)
      .pathColor('color')
      .pathStroke('stroke')
      .pathDashLength('dash')
      .pathDashGap(d => d.dash ? 0.8 : 0)
      .pathDashAnimateTime(0)
      .labelsData([])
      .labelText('name')
      .labelSize(1.15)
      .labelColor('color')
      .labelDotRadius(0.3)
      .labelAltitude(0.02);
    world.controls().autoRotate = true;
    world.controls().autoRotateSpeed = 0.3;
  }

  function initSlGlobe() {
    const el = $('#sl-globe-container');
    if (!el || slWorld) return;
    slWorld = Globe()(el)
      .width(el.clientWidth || 300)
      .height(el.clientHeight || 200)
      .backgroundColor('#000000')
      .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-night.jpg')
      .atmosphereColor('#00e8ff')
      .atmosphereAltitude(0.12)
      .pointsData([])
      .pointAltitude(0.01)
      .pointRadius(0.28)
      .pointColor('color')
      .pathsData([])
      .pathPoints('coords')
      .pathPointLat(p => p[0])
      .pathPointLng(p => p[1])
      .pathPointAlt(0.008)
      .pathColor('color')
      .pathStroke(0.45)
      .pathDashLength(0)
      .pathDashGap(0);
    slWorld.controls().autoRotate = true;
    slWorld.controls().autoRotateSpeed = 0.4;
  }

  async function ensureSat(meta) {
    if (satRecords[meta.id] && satRecords[meta.id].satrec) return satRecords[meta.id];
    const rec = await fetchTLE(meta.id);
    if (rec) {
      satRecords[meta.id] = {
        satrec: rec,
        name: meta.name,
        color: meta.color,
        enabled: true,
        primary: !!meta.primary
      };
      return satRecords[meta.id];
    }
    // Placeholder so toggle UI works; ISS can still use WTIA
    if (!satRecords[meta.id]) {
      satRecords[meta.id] = {
        satrec: null,
        name: meta.name,
        color: meta.color,
        enabled: meta.id === 25544,
        primary: !!meta.primary,
        noTle: true
      };
    }
    return satRecords[meta.id];
  }

  async function loadMajorSats() {
    initGlobe();
    // Fetch every configured sat individually (more reliable than group files + CORS)
    await Promise.all(CONFIG.sats.map(s => ensureSat(s)));

    const tog = $('#sat-toggles');
    tog.innerHTML = '<div class="hd">ASSETS</div>' + CONFIG.sats.map(s => {
      const rec = satRecords[s.id];
      const hasData = rec && (rec.satrec || s.id === 25544);
      const checked = rec && rec.enabled !== false && hasData;
      return `<label data-id="${s.id}">
        <input type="checkbox" ${checked ? 'checked' : ''} ${hasData ? '' : 'disabled'} title="${hasData ? s.name : 'TLE unavailable'}">
        <i class="dot" style="background:${s.color}"></i>${s.name}
      </label>`;
    }).join('');

    tog.querySelectorAll('label').forEach(lab => {
      const input = lab.querySelector('input');
      input.onchange = async e => {
        const id = +lab.dataset.id;
        const meta = CONFIG.sats.find(s => s.id === id);
        if (!satRecords[id] || !satRecords[id].satrec) {
          if (meta) {
            input.disabled = true;
            await ensureSat(meta);
            input.disabled = false;
          }
        }
        if (satRecords[id]) {
          satRecords[id].enabled = e.target.checked;
          if (!satRecords[id].satrec && id !== 25544) {
            e.target.checked = false;
            satRecords[id].enabled = false;
          }
        }
        updateMajorGlobe();
      };
    });

    const ready = Object.values(satRecords).filter(r => r.satrec || r.primary).length;
    $('#sat-count').textContent = ready + ' SATS';
    updateMajorGlobe();
  }

  function updateMajorGlobe() {
    if (!world) return;
    const now = new Date();
    const points = [], paths = [], labels = [], barRows = [];

    Object.keys(satRecords).forEach(idStr => {
      const id = +idStr;
      const rec = satRecords[id];
      if (!rec || !rec.enabled) return;

      let pos = null;
      if (rec.satrec) pos = propPos(rec.satrec, now);
      if (!pos && id !== 25544) return;

      if (pos) {
        points.push({ lat: pos.lat, lng: pos.lon, color: rec.color, name: rec.name, id });
        labels.push({ lat: pos.lat, lng: pos.lon, name: rec.name, color: rec.color });
        barRows.push({ id, name: rec.name, color: rec.color, ...pos });
      }

      if (rec.satrec) {
        const { past, future } = orbitPathSplit(rec.satrec, 2, 50);
        // Solid past track
        if (past.length > 2) {
          paths.push({ coords: past, color: rec.color, stroke: rec.primary ? 1.2 : 0.7, dash: 0 });
        }
        // Dashed future track
        if (future.length > 2) {
          paths.push({ coords: future, color: rec.color, stroke: rec.primary ? 1.0 : 0.55, dash: 0.6 });
        }
      }
    });

    // ISS high-accuracy position + optional future from WTIA timestamps
    get(CONFIG.endpoints.iss).then(async d => {
      const lat = d.latitude, lon = d.longitude, alt = d.altitude, vel = d.velocity;
      const ix = points.findIndex(p => p.id === 25544);
      const pt = { lat, lng: lon, color: '#ffffff', name: 'ISS', id: 25544 };
      if (ix >= 0) points[ix] = pt; else points.push(pt);

      const li = labels.findIndex(l => l.name === 'ISS');
      const lab = { lat, lng: lon, name: 'ISS', color: '#ffffff' };
      if (li >= 0) labels[li] = lab; else labels.push(lab);

      const bi = barRows.findIndex(b => b.id === 25544);
      const row = { id: 25544, name: 'ISS', color: '#ffffff', lat, lon, alt, vel };
      if (bi >= 0) barRows[bi] = row; else barRows.push(row);

      // If no TLE path for ISS yet, synthesize future from positions API
      const hasIssPath = paths.some(p => p.color === '#ffffff');
      if (!hasIssPath) {
        try {
          const nowTs = Math.floor(Date.now() / 1000);
          const ts = [];
          for (let i = -15; i <= 18; i++) ts.push(nowTs + i * 300);
          const fut = await get(`https://api.wheretheiss.at/v1/satellites/25544/positions?timestamps=${ts.join(',')}`);
          if (Array.isArray(fut) && fut.length > 2) {
            const past = fut.filter(p => p.timestamp <= nowTs).map(p => [p.latitude, p.longitude]);
            const future = fut.filter(p => p.timestamp >= nowTs).map(p => [p.latitude, p.longitude]);
            if (past.length > 1) paths.push({ coords: past, color: '#ffffff', stroke: 1.3, dash: 0 });
            if (future.length > 1) paths.push({ coords: future, color: '#ffffff', stroke: 1.1, dash: 0.6 });
          }
        } catch (_) {}
      }

      if (satRecords[25544]) {
        satRecords[25544].enabled = true;
        satRecords[25544].pos = { lat, lon, alt, vel };
      }
      paintMajor(points, paths, labels, barRows);
    }).catch(() => paintMajor(points, paths, labels, barRows));
  }

  function paintMajor(points, paths, labels, barRows) {
    world
      .pointsData(points)
      .pointColor(d => d.color)
      .pathsData(paths)
      .pathColor(d => d.color)
      .pathStroke(d => d.stroke || 0.7)
      .pathDashLength(d => d.dash || 0)
      .pathDashGap(d => d.dash ? 0.9 : 0)
      .labelsData(labels)
      .labelColor(d => d.color);

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
      };
    });
  }

  function openSatDetail(s) {
    openFloat('sat-' + s.id, s.name + ' · TELEMETRY', `
      <table class="float-table">
        <tr><th>Satellite</th><td>${s.name}</td></tr>
        <tr><th>NORAD</th><td>${s.id}</td></tr>
        <tr><th>Latitude</th><td>${s.lat.toFixed(4)}°</td></tr>
        <tr><th>Longitude</th><td>${s.lon.toFixed(4)}°</td></tr>
        <tr><th>Altitude</th><td>${s.alt.toFixed(2)} km</td></tr>
        <tr><th>Velocity</th><td>${Math.round(s.vel).toLocaleString()} km/h</td></tr>
      </table>
      <p style="margin-top:8px">Solid path = past · Dashed path = predicted future (~50 min each side).</p>`, 340, 310);
  }

  /* ========== STARLINK TRAINS ========== */
  async function loadStarlink() {
    initSlGlobe();
    try {
      const data = await get(CONFIG.endpoints.tleStarlink);
      if (!Array.isArray(data) || !data.length) {
        $('#sl-count').textContent = 'UNAVAILABLE';
        $('#sl-trains').innerHTML = '<div class="sl-train"><div class="tm">Celestrak unavailable (CORS or rate limit). Retry later.</div></div>';
        return;
      }

      // Limit for performance — sample up to 600 active
      const sample = data.filter(d => {
        const name = (d.OBJECT_NAME || d.object_name || '').toUpperCase();
        return name.includes('STARLINK');
      }).slice(0, 800);

      starlinkSats = [];
      sample.forEach(item => {
        const rec = makeSatrec(item);
        if (!rec || rec.error) return;
        const id = item.NORAD_CAT_ID || item.norad_cat_id;
        const name = (item.OBJECT_NAME || item.object_name || 'STARLINK').replace('STARLINK ', 'SL-');
        const raan = item.RA_OF_ASC_NODE ?? item.ra_of_asc_node ?? 0;
        const inc = item.INCLINATION ?? item.inclination ?? 53;
        const mm = item.MEAN_MOTION ?? item.mean_motion ?? 15.1;
        starlinkSats.push({ id, name, satrec: rec, raan, inc, mm, pos: null });
      });

      // Cluster into trains by RAAN (10°) + inclination (0.5°) + mean motion band
      const bins = new Map();
      starlinkSats.forEach(s => {
        const raanBin = Math.round(s.raan / 10) * 10;
        const incBin = Math.round(s.inc * 2) / 2;
        const shell = s.mm > 15.2 ? 'SHELL-A' : s.mm > 14.8 ? 'SHELL-B' : 'SHELL-C';
        const key = `${shell}|${incBin}|${raanBin}`;
        if (!bins.has(key)) bins.set(key, []);
        bins.get(key).push(s);
      });

      // Keep trains with at least 3 sats
      starlinkTrains = [];
      let ti = 0;
      [...bins.entries()]
        .filter(([, sats]) => sats.length >= 3)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 40)
        .forEach(([key, sats]) => {
          const color = CONFIG.starlinkColors[ti % CONFIG.starlinkColors.length];
          const [shell, inc, raan] = key.split('|');
          const train = {
            id: 'T' + ti,
            label: `${shell} · i${inc}° · Ω${raan}°`,
            color,
            shell, inc: +inc, raan: +raan,
            count: sats.length,
            sats
          };
          sats.forEach(s => { s.trainId = train.id; s.color = color; });
          starlinkTrains.push(train);
          ti++;
        });

      $('#sl-count').textContent = starlinkSats.length + ' / ' + starlinkTrains.length + ' TRAINS';
      renderTrainList();
      // Default: show densest train
      if (starlinkTrains.length) isolateTrain(starlinkTrains[0].id);
    } catch (e) {
      console.error('Starlink', e);
      $('#sl-count').textContent = 'ERROR';
      $('#sl-trains').innerHTML = `<div class="sl-train"><div class="tm">${e.message}</div></div>`;
    }
  }

  function renderTrainList() {
    const el = $('#sl-trains');
    el.innerHTML = starlinkTrains.map(t => `
      <div class="sl-train ${t.id === activeTrainId ? 'active' : ''}" data-id="${t.id}">
        <div class="tn"><i class="dot" style="background:${t.color}"></i>${t.label}</div>
        <div class="tm">${t.count} sats · i=${t.inc}° · Ω=${t.raan}°</div>
      </div>`).join('');
    el.querySelectorAll('.sl-train').forEach(row => {
      row.onclick = () => isolateTrain(row.dataset.id);
    });
  }

  function isolateTrain(trainId) {
    activeTrainId = trainId;
    renderTrainList();
    updateStarlinkGlobe();
  }

  function updateStarlinkGlobe() {
    if (!slWorld) return;
    const train = starlinkTrains.find(t => t.id === activeTrainId);
    if (!train) {
      slWorld.pointsData([]).pathsData([]);
      $('#sl-telem').innerHTML = '<div class="sl-telem-h">SELECT A TRAIN</div><div class="sl-telem-b">Click a train to isolate and view telemetry.</div>';
      return;
    }

    const now = new Date();
    const points = [];
    const paths = [];
    const telemRows = [];

    // Limit path rendering to first 12 sats in train for perf
    train.sats.forEach((s, idx) => {
      const pos = propPos(s.satrec, now);
      if (!pos) return;
      s.pos = pos;
      points.push({ lat: pos.lat, lng: pos.lon, color: train.color, name: s.name, id: s.id });
      if (idx < 10) {
        const { past, future } = orbitPathSplit(s.satrec, 4, 48);
        if (past.length > 2) paths.push({ coords: past, color: train.color, stroke: 0.4, dash: 0 });
        if (future.length > 2) paths.push({ coords: future, color: train.color, stroke: 0.35, dash: 0.5 });
      }
      telemRows.push({ ...s, ...pos });
    });

    slWorld.pointsData(points).pointColor(d => d.color)
      .pathsData(paths)
      .pathColor(d => d.color)
      .pathStroke(d => d.stroke || 0.4)
      .pathDashLength(d => d.dash || 0)
      .pathDashGap(d => d.dash ? 0.8 : 0);

    $('#sl-telem').innerHTML = `
      <div class="sl-telem-h">${train.label} · ${telemRows.length} SATS</div>
      ${telemRows.slice(0, 24).map(s => `
        <div class="sl-sat-row" data-id="${s.id}">
          <span class="sn">${s.name.replace('STARLINK-', 'SL-').slice(0, 12)}</span>
          <span>${s.lat.toFixed(1)}°</span>
          <span>${s.lon.toFixed(1)}°</span>
          <span>${s.alt.toFixed(0)}km</span>
        </div>`).join('')}
      ${telemRows.length > 24 ? `<div class="sl-telem-b">+${telemRows.length - 24} more</div>` : ''}`;

    $$('#sl-telem .sl-sat-row').forEach(row => {
      row.onclick = e => {
        e.stopPropagation();
        const s = telemRows.find(x => x.id === +row.dataset.id);
        if (s) openSatDetail({ id: s.id, name: s.name, color: train.color, lat: s.lat, lon: s.lon, alt: s.alt, vel: s.vel });
      };
    });
  }

  /* ========== NEO ========== */
  function project(lat, lon, R, rot) {
    const lonR = (lon + rot) * Math.PI / 180;
    const latR = lat * Math.PI / 180;
    return {
      x: R * Math.cos(latR) * Math.sin(lonR),
      y: -R * Math.sin(latR),
      z: R * Math.cos(latR) * Math.cos(lonR),
      visible: R * Math.cos(latR) * Math.cos(lonR) > -R * 0.12
    };
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
    for (let i = 0; i < 40; i++) {
      ctx.globalAlpha = 0.3; ctx.fillStyle = '#8af';
      ctx.fillRect((i * 97) % w, (i * 53) % h, 1, 1);
    }
    ctx.globalAlpha = 1;
    const grd = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
    grd.addColorStop(0, '#1a6a9a'); grd.addColorStop(0.55, '#0d4a6e'); grd.addColorStop(1, '#062030');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = grd; ctx.fill();
    ctx.strokeStyle = 'rgba(0,232,255,0.3)'; ctx.lineWidth = 1; ctx.stroke();
    neoData.forEach(n => {
      const alt = Math.min(0.5, 0.08 + n.ld * 0.04);
      const p = project(n.vizLat, n.vizLon, R * (1 + alt), neoRot);
      if (!p.visible) return;
      ctx.beginPath(); ctx.arc(cx + p.x, cy + p.y, n.haz ? 3 : 2, 0, Math.PI * 2);
      ctx.fillStyle = n.haz ? '#ff3b30' : '#00e8ff'; ctx.fill();
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
        <tr><th>Miss</th><td>${n.ld.toFixed(3)} LD (${(n.ld * 384400).toFixed(0)} km)</td></tr>
        <tr><th>Velocity</th><td>${n.vel.toFixed(2)} km/s</td></tr>
        <tr><th>Size</th><td>~${n.size} m</td></tr>
        <tr><th>PHA</th><td class="${n.haz ? 'pha' : ''}">${n.haz ? 'YES' : 'No'}</td></tr>
      </table>`, 340, 280);
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
            vizLat: ((hash % 140) - 70) * 0.85, vizLon: ((hash * 13) % 360) - 180
          });
        });
      });
      neoData.sort((a, b) => a.ld - b.ld);
      $('#neo-tot').textContent = neoData.length;
      $('#neo-pha').textContent = pha;
      $('#neo-close').textContent = isFinite(minLd) ? minLd.toFixed(2) : '—';
      $('#neo-n').textContent = neoData.length + ' OBJ';
      $('#neo-list').innerHTML = neoData.slice(0, 35).map(n =>
        `<div class="ni ${n.haz ? 'pha' : ''}" data-id="${n.id}">
          <div class="nm">${n.name}</div>
          <div class="mt">${n.date} · ${n.ld.toFixed(2)} LD</div>
        </div>`).join('');
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

  /* ========== EPIC / DONKI / EONET / MISSIONS ========== */
  async function loadEPIC() {
    try {
      const imgs = await get(`${CONFIG.endpoints.epic}?api_key=${CONFIG.API_KEY}`);
      if (!imgs?.length) return;
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
        </div>`;
      $('#epic-img')?.addEventListener('click', () => {
        openFloat('epic', 'EPIC · L1', `
          <img src="${src}" style="width:100%;max-width:320px;border-radius:50%;display:block;margin:0 auto" alt="">
          <table class="float-table" style="margin-top:10px">
            <tr><th>Date</th><td>${epicCache.date}</td></tr>
            <tr><th>Centroid</th><td>${(c.lat || 0).toFixed(3)}°, ${(c.lon || 0).toFixed(3)}°</td></tr>
            <tr><th>Caption</th><td>${epicCache.caption || '—'}</td></tr>
          </table>`, 400, 480);
      });
    } catch (e) { $('#epic-prev').innerHTML = `<div class="list-item">${e.message}</div>`; }
  }

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
        body: (n.messageBody || '').slice(0, 280)
      }));
      (cmes || []).slice(0, 4).forEach(c => {
        const sp = c.cmeAnalyses?.[0]?.speed;
        donkiCache.push({ type: 'CME', title: `CME${sp ? ' · ' + Math.round(sp) + ' km/s' : ''}`, time: (c.startTime || '').replace('T', ' ').slice(0, 16), body: (c.note || '').slice(0, 180) });
      });
      (flrs || []).slice(0, 4).forEach(f => donkiCache.push({
        type: 'FLARE ' + (f.classType || ''),
        title: f.sourceLocation || f.flrID || 'Flare',
        time: (f.beginTime || '').replace('T', ' ').slice(0, 16),
        body: `Class ${f.classType || '—'}`
      }));
      (gsts || []).slice(0, 3).forEach(g => {
        const kp = g.allKpIndex?.[0]?.kpIndex;
        donkiCache.push({ type: 'GST', title: `Geomagnetic${kp != null ? ' · Kp ' + kp : ''}`, time: (g.startTime || '').replace('T', ' ').slice(0, 16), body: '' });
      });
      donkiCache.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
      $('#donki-n').textContent = donkiCache.length;
      $('#donki-prev').innerHTML = donkiCache.slice(0, 9).map((e, i) =>
        `<div class="list-item" data-idx="${i}"><div class="t">${e.type} · ${e.time}</div><div class="n">${e.title}</div></div>`
      ).join('') || '<div class="list-item">Quiet</div>';
      $$('#donki-prev .list-item[data-idx]').forEach(el => {
        el.onclick = () => {
          const e = donkiCache[+el.dataset.idx];
          if (!e) return;
          openFloat('donki-' + el.dataset.idx, e.type, `
            <table class="float-table">
              <tr><th>Type</th><td>${e.type}</td></tr>
              <tr><th>Time</th><td>${e.time}</td></tr>
              <tr><th>Title</th><td>${e.title}</td></tr>
            </table>
            <p style="margin-top:8px">${e.body || '—'}</p>`, 400, 300);
        };
      });
    } catch (e) { $('#donki-prev').innerHTML = `<div class="list-item">${e.message}</div>`; }
  }

  async function loadEONET() {
    try {
      const data = await get(`${CONFIG.endpoints.eonet}?status=open&limit=25`);
      eonetCache = (data.events || []).map(ev => {
        const g = ev.geometry?.[ev.geometry.length - 1];
        const cat = ev.categories?.[0];
        return {
          title: ev.title, cat: cat?.title || 'Event',
          date: g?.date?.slice(0, 10) || '', coords: g?.coordinates,
          sources: (ev.sources || []).map(s => s.id).join(', '),
          link: (ev.sources || [])[0]?.url || ''
        };
      });
      $('#eonet-n').textContent = eonetCache.length + ' OPEN';
      $('#eonet-prev').innerHTML = eonetCache.slice(0, 10).map((e, i) =>
        `<div class="list-item" data-idx="${i}"><div class="t">${e.cat.toUpperCase()} · ${e.date}</div><div class="n">${e.title}</div></div>`
      ).join('') || '<div class="list-item">None</div>';
      $$('#eonet-prev .list-item[data-idx]').forEach(el => {
        el.onclick = () => {
          const e = eonetCache[+el.dataset.idx];
          if (!e) return;
          openFloat('eonet-' + el.dataset.idx, e.cat.toUpperCase(), `
            <table class="float-table">
              <tr><th>Event</th><td>${e.title}</td></tr>
              <tr><th>Category</th><td>${e.cat}</td></tr>
              <tr><th>Date</th><td>${e.date}</td></tr>
              <tr><th>Location</th><td>${e.coords ? e.coords[1].toFixed(2) + '°, ' + e.coords[0].toFixed(2) + '°' : '—'}</td></tr>
              <tr><th>Sources</th><td>${e.sources || '—'}</td></tr>
            </table>
            ${e.link ? `<p style="margin-top:8px"><a href="${e.link}" target="_blank" rel="noopener" style="color:var(--cyan)">Source →</a></p>` : ''}`, 400, 320);
        };
      });
    } catch (e) { console.error(e); }
  }

  async function loadMissions() {
    try {
      const [issNews, crew] = await Promise.all([
        get(`${CONFIG.endpoints.news}?limit=12&search=ISS&ordering=-published_at`),
        get('https://api.open-notify.org/astros.json').catch(() => null)
      ]);
      newsCache = issNews.results || [];
      let html = '';
      if (crew?.people) {
        const issCrew = crew.people.filter(p => (p.craft || '').toUpperCase().includes('ISS'));
        html += `<div class="list-item" data-crew="1"><div class="t">CREW · ${issCrew.length || crew.number}</div>
          <div class="n" style="white-space:normal">${issCrew.map(p => p.name).join(' · ') || '—'}</div></div>`;
      }
      html += newsCache.slice(0, 7).map((i, idx) =>
        `<div class="list-item" data-news="${idx}"><div class="t">${(i.published_at || '').slice(0, 10)}</div><div class="n">${i.title}</div></div>`
      ).join('');
      $('#mis-n').textContent = newsCache.length;
      $('#mis-prev').innerHTML = html;
      $$('#mis-prev .list-item[data-news]').forEach(el => {
        el.onclick = () => {
          const i = newsCache[+el.dataset.news];
          if (!i) return;
          openFloat('news-' + el.dataset.news, 'ISS UPDATE', `
            <h3>${i.title}</h3>
            <p style="font-size:9px;color:var(--muted)">${(i.published_at || '').slice(0, 16)} · ${i.news_site || ''}</p>
            <p>${i.summary || ''}</p>
            <p style="margin-top:8px"><a href="${i.url}" target="_blank" rel="noopener" style="color:var(--cyan)">Full article →</a></p>`, 440, 360);
        };
      });
      $$('#mis-prev .list-item[data-crew]').forEach(el => {
        el.onclick = () => {
          if (!crew?.people) return;
          const issCrew = crew.people.filter(p => (p.craft || '').toUpperCase().includes('ISS'));
          openFloat('crew', 'ISS CREW', `
            <table class="float-table">${issCrew.map(p => `<tr><th>${p.craft || 'ISS'}</th><td>${p.name}</td></tr>`).join('')}</table>
            <p style="margin-top:6px">People in space: ${crew.number}</p>`, 340, 280);
        };
      });

      const jpl = await get(`${CONFIG.endpoints.news}?limit=8&search=JPL&ordering=-published_at`);
      const jplItems = jpl.results || [];
      $('#jpl-prev').innerHTML = jplItems.slice(0, 7).map((i, idx) =>
        `<div class="list-item" data-jpl="${idx}"><div class="t">JPL · ${(i.published_at || '').slice(0, 10)}</div><div class="n">${i.title}</div></div>`
      ).join('') || '<div class="list-item">—</div>';
      $$('#jpl-prev .list-item[data-jpl]').forEach(el => {
        el.onclick = () => {
          const i = jplItems[+el.dataset.jpl];
          if (!i) return;
          openFloat('jpl-' + el.dataset.jpl, 'JPL', `
            <h3>${i.title}</h3>
            <p style="font-size:9px;color:var(--muted)">${(i.published_at || '').slice(0, 16)}</p>
            <p>${i.summary || ''}</p>
            <p style="margin-top:8px"><a href="${i.url}" target="_blank" rel="noopener" style="color:var(--cyan)">Full article →</a></p>`, 440, 360);
        };
      });
    } catch (e) { console.error(e); }
  }

  function bindCams() {
    $$('.cam-slot').forEach(slot => {
      slot.addEventListener('click', () => {
        const src = (slot.dataset.src || '') + '&controls=1';
        const label = slot.querySelector('.cam-label')?.textContent || 'CAM';
        openFloat('cam-' + slot.dataset.cam, 'LIVE · ' + label, `
          <iframe src="${src}" style="width:100%;aspect-ratio:16/9;border:0;background:#000" allow="autoplay;encrypted-media" allowfullscreen></iframe>
        `, 620, 380);
      });
    });
  }

  async function refresh() {
    $('#btn-refresh').style.opacity = '0.5';
    await Promise.allSettled([loadNEO(), loadEPIC(), loadDONKI(), loadEONET(), loadMissions()]);
    $('#last-upd').textContent = 'UPD ' + utc();
    $('#btn-refresh').style.opacity = '1';
  }

  function onResize() {
    if (world) {
      const c = $('#globe-container');
      if (c) world.width(c.clientWidth).height(c.clientHeight);
    }
    if (slWorld) {
      const c = $('#sl-globe-container');
      if (c) slWorld.width(c.clientWidth).height(c.clientHeight);
    }
    drawNeoGlobe();
  }

  function init() {
    $('#utc').textContent = utc();
    $('#loc').textContent = loc();
    initGlobe();
    initSlGlobe();
    bindCams();
    loadMajorSats();
    loadStarlink();
    setInterval(updateMajorGlobe, CONFIG.satMs);
    setInterval(updateStarlinkGlobe, CONFIG.starlinkMs);
    refresh();
    setInterval(refresh, CONFIG.refreshMs);
    window.addEventListener('resize', onResize);
    $('#btn-refresh').onclick = () => { refresh(); loadStarlink(); };
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
