const CONFIG = {
  API_KEY: 'oYhu85OxVjc3FEWj7KW4A8ToSTK2vWkcxN4FM1Z8',
  endpoints: {
    neoFeed: 'https://api.nasa.gov/neo/rest/v1/feed',
    donkiN: 'https://api.nasa.gov/DONKI/notifications',
    donkiCME: 'https://api.nasa.gov/DONKI/CME',
    donkiFLR: 'https://api.nasa.gov/DONKI/FLR',
    donkiGST: 'https://api.nasa.gov/DONKI/GST',
    epic: 'https://api.nasa.gov/EPIC/api/natural',
    epicImg: 'https://api.nasa.gov/EPIC/archive/natural',
    eonet: 'https://eonet.gsfc.nasa.gov/api/v3/events',
    iss: 'https://api.wheretheiss.at/v1/satellites/25544',
    issPos: 'https://api.wheretheiss.at/v1/satellites/25544/positions',
    news: 'https://api.spaceflightnewsapi.net/v4/articles',
    // Celestrak GP JSON for multi-sat TLEs
    tleStations: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json',
    tleVisual: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=json',
    tleWeather: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=json',
    tleResource: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=resource&FORMAT=json'
  },
  // Major public sats to track (NORAD IDs)
  sats: [
    { id: 25544, name: 'ISS', color: '#ff3b30', primary: true },
    { id: 48274, name: 'TIANGONG', color: '#ff9800' },
    { id: 20580, name: 'HUBBLE', color: '#00e5ff' },
    { id: 49260, name: 'LANDSAT 9', color: '#69f0ae' },
    { id: 43013, name: 'NOAA-20', color: '#ea80fc' },
    { id: 43226, name: 'NOAA-21', color: '#b388ff' },
    { id: 39084, name: 'LANDSAT 8', color: '#80cbc4' },
    { id: 25994, name: 'TERRA', color: '#81d4fa' },
    { id: 27424, name: 'AQUA', color: '#4fc3f7' }
  ],
  satMs: 2000,
  refreshMs: 5 * 60 * 1000,
  audio: true
};
