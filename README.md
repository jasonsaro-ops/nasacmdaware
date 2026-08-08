# NASA Mission Control Dashboard

Professional dark-themed Mission Control dashboard aggregating live NASA open data, ISS tracking, live camera feeds, mission digests, and JPL updates.

## Features

- **APOD** – Astronomy Picture of the Day
- **Near-Earth Objects** – NeoWs close approaches + PHA flags
- **ISS Live Tracker** – Real-time position, velocity, altitude, footprint, ground track trail on dark world map
- **ISS Live Cameras** – Official NASA HD external camera streams (YouTube embeds)
- **EPIC** – Latest full-disk Earth from DSCOVR L1
- **Space Weather (DONKI)** – CMEs & notifications
- **EONET** – Active natural events + map
- **Mission Digest** – ISS, Artemis, and fleet updates (filterable tabs) via Spaceflight News API
- **JPL Section** – Robotic mission news + High Bay / clean-room camera embed
- **NASA Media Library** – Searchable image collection
- **NASA Meatball logo** in header
- **Audible NASA-style chime** when new mission updates arrive (toggleable)
- Auto-refresh (ISS every ~8 s, everything else every 5 min)

## Deploy (GitHub Pages)

1. Create a repo and push the contents of this folder to the root (or `/docs`).
2. Settings → Pages → Deploy from branch → `main` / root.
3. Live at `https://<user>.github.io/<repo>/`.

Local: open `index.html` or `python -m http.server 8080`.

## API Key

Stored in `js/config.js`. Visible client-side (normal for NASA demo keys). Rotate at [api.nasa.gov](https://api.nasa.gov/) if desired.

## Notes

- ISS position/velocity from [Where The ISS At](https://wheretheiss.at).
- Mission news from [Spaceflight News API](https://spaceflightnewsapi.net).
- Live camera video IDs can change; update the YouTube embed URLs in `index.html` if a stream goes offline.
- Audio requires a user gesture first (browser autoplay policy); click anywhere once.
- Clean-room feed uses the NASA JPL YouTube channel live stream (availability varies with operations).

## License

Dashboard code for educational / personal use. NASA data generally public domain.
