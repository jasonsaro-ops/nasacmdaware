const CONFIG = {
  API_KEY: 'oYhu85OxVjc3FEWj7KW4A8ToSTK2vWkcxN4FM1Z8',
  endpoints: {
    apod: 'https://api.nasa.gov/planetary/apod',
    neoFeed: 'https://api.nasa.gov/neo/rest/v1/feed',
    donkiN: 'https://api.nasa.gov/DONKI/notifications',
    epic: 'https://api.nasa.gov/EPIC/api/natural',
    epicImg: 'https://api.nasa.gov/EPIC/archive/natural',
    eonet: 'https://eonet.gsfc.nasa.gov/api/v3/events',
    iss: 'https://api.wheretheiss.at/v1/satellites/25544',
    issPos: 'https://api.wheretheiss.at/v1/satellites/25544/positions',
    news: 'https://api.spaceflightnewsapi.net/v4/articles'
  },
  issMs: 6000,
  refreshMs: 5 * 60 * 1000,
  audio: true
};
