# NASA Mission Control — Compact Console

Single-monitor, dense Mission Control UI inspired by Territory Studio’s *The Martian* screens.

## Design
- Official NASA meatball logo
- Helvetica for all UI text
- Dark panels, blue / cyan / red hierarchy
- Fits one monitor — no scrolling required on typical 1080p+
- Every tile is clickable → opens a **draggable floating window**
- ISS ground track in **red** on dark basemap
- NEO objects plotted on zoomable Earth map; click marker or table row for details

## Panels
1. ISS Track + telemetry  
2. Near-Earth Objects (map + list)  
3. APOD  
4. EPIC Earth  
5. Space Weather (DONKI)  
6. Natural Events (EONET)  
7. Mission Digest (ISS / Artemis / fleet)  
8. JPL / Robotic + clean-room cam  
9. Live cameras  
10. Media library search  

## Deploy
Push folder to GitHub → Settings → Pages → Deploy from branch.

Local: open `index.html` or `python -m http.server 8080`.

API key in `js/config.js`.
EOF
cd /home/workdir/artifacts && zip -r nasa-mission-control-dashboard.zip nasa-mission-control -x "*.DS_Store" && ls -lh nasa-mission-control-dashboard.zip
