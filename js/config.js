// ============================================================
// NASA Mission Control Dashboard - Configuration
// ============================================================
const CONFIG = {
  API_KEY: 'oYhu85OxVjc3FEWj7KW4A8ToSTK2vWkcxN4FM1Z8',

  endpoints: {
    apod: 'https://api.nasa.gov/planetary/apod',
    neoFeed: 'https://api.nasa.gov/neo/rest/v1/feed',
    donkiNotifications: 'https://api.nasa.gov/DONKI/notifications',
    donkiCME: 'https://api.nasa.gov/DONKI/CME',
    epicNatural: 'https://api.nasa.gov/EPIC/api/natural',
    epicArchive: 'https://api.nasa.gov/EPIC/archive/natural',
    eonetEvents: 'https://eonet.gsfc.nasa.gov/api/v3/events',
    imagesSearch: 'https://images-api.nasa.gov/search',
    issNow: 'https://api.wheretheiss.at/v1/satellites/25544',
    spaceflightNews: 'https://api.spaceflightnewsapi.net/v4/articles'
  },

  autoRefreshMs: 5 * 60 * 1000,
  issRefreshMs: 8 * 1000,
  neoDaysAhead: 7,
  audioEnabled: true
};
