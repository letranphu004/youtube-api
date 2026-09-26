'use strict';

// Zero-dependency server (works on Node 11+).
// - Serves the landing page from ./public
// - GET /api/channels returns channel info + live status for the channels in config.js
//
// Live detection:
//   * Channels come from config.js.
//   * With YOUTUBE_API_KEY: channels.list for info, channel RSS feed for recent video ids,
//     then videos.list (1 quota unit per 50 videos) to find liveBroadcastContent === 'live'.
//   * Without a key: reads the public https://www.youtube.com/<channel>/live page.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.YOUTUBE_API_KEY || '';
const CONFIG_PATH = path.join(__dirname, 'config.js');
const PUBLIC_DIR = path.join(__dirname, 'public');

const INFO_TTL_MS = 6 * 60 * 60 * 1000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const infoCache = new Map(); // key (handle or id) -> { at, info }
let statusCache = null; // { at, payload }
let inflight = null;

// ---------- utils ----------

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(function (line) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

function readConfig() {
  // Re-require on every read so edits to config.js apply without a restart.
  delete require.cache[require.resolve(CONFIG_PATH)];
  const cfg = require(CONFIG_PATH);
  return {
    refreshSeconds: Math.max(30, Number(cfg.refreshSeconds) || 60),
    channels: (cfg.channels || []).map(function (c) {
      if (typeof c === 'string') c = c.startsWith('UC') ? { id: c } : { handle: c };
      if (c.handle && c.handle[0] !== '@') c.handle = '@' + c.handle;
      return c;
    }),
  };
}

function get(target, redirects) {
  redirects = redirects || 0;
  return new Promise(function (resolve, reject) {
    const req = https.get(target, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' },
      timeout: 15000,
    }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume();
        return resolve(get(url.resolve(target, res.headers.location), redirects + 1));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', function (d) { body += d; });
      res.on('end', function () { resolve({ status: res.statusCode, body: body }); });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout: ' + target)); });
    req.on('error', reject);
  });
}

function getJson(target) {
  return get(target).then(function (r) {
    const data = JSON.parse(r.body);
    if (data.error) throw new Error('YouTube API: ' + data.error.message);
    return data;
  });
}

function api(resource, params) {
  const qs = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  return getJson('https://www.googleapis.com/youtube/v3/' + resource + '?' + qs + '&key=' + API_KEY);
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function meta(html, prop) {
  const re = new RegExp('<meta[^>]+(?:property|name|itemprop)="' + prop + '"[^>]+content="([^"]*)"');
  const m = html.match(re);
  return m ? decodeHtml(m[1]) : '';
}

function channelKey(c) { return c.id || c.handle; }

function channelUrl(c) {
  return c.handle ? 'https://www.youtube.com/' + c.handle : 'https://www.youtube.com/channel/' + c.id;
}

// ---------- channel info ----------

function infoFromApiItem(item, c) {
  const s = item.snippet || {};
  const st = item.statistics || {};
  const thumbs = s.thumbnails || {};
  const thumb = thumbs.high || thumbs.medium || thumbs.default || {};
  const banner = item.brandingSettings && item.brandingSettings.image && item.brandingSettings.image.bannerExternalUrl;
  return {
    id: item.id,
    handle: s.customUrl ? (s.customUrl[0] === '@' ? s.customUrl : '@' + s.customUrl) : c.handle || '',
    title: s.title || c.handle || item.id,
    description: s.description || '',
    avatar: thumb.url || '',
    banner: banner ? banner + '=w1060-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj' : '',
    subscribers: st.hiddenSubscriberCount ? null : Number(st.subscriberCount || 0),
    videos: Number(st.videoCount || 0),
  };
}

function fetchInfoApi(channels) {
  const parts = 'snippet,statistics,brandingSettings';
  const byId = channels.filter(function (c) { return c.id; });
  const byHandle = channels.filter(function (c) { return !c.id; });
  const out = new Map();

  const idJobs = chunk(byId, 50).map(function (group) {
    return api('channels', { part: parts, id: group.map(function (c) { return c.id; }).join(',') }).then(function (d) {
      (d.items || []).forEach(function (item) {
        const c = group.find(function (g) { return g.id === item.id; });
        out.set(channelKey(c), infoFromApiItem(item, c));
      });
    });
  });
  const handleJobs = byHandle.map(function (c) {
    return api('channels', { part: parts, forHandle: c.handle }).then(function (d) {
      if (d.items && d.items[0]) out.set(channelKey(c), infoFromApiItem(d.items[0], c));
    }).catch(function (e) { console.warn('[info]', c.handle, e.message); });
  });

  return Promise.all(idJobs.concat(handleJobs)).then(function () { return out; });
}

function fetchInfoScrape(c) {
  return get(channelUrl(c)).then(function (r) {
    const html = r.body;
    const idMatch = html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})/);
    // The channel header's own metadata row; other counts on the page belong to related channels.
    const subMatch = html.match(/"content":"([\d.,]+[KMB]?) subscribers?"/);
    return {
      id: c.id || (idMatch ? idMatch[1] : ''),
      handle: c.handle || '',
      title: meta(html, 'og:title') || c.handle || c.id,
      description: meta(html, 'og:description'),
      avatar: meta(html, 'og:image'),
      banner: '',
      subscribersText: subMatch ? subMatch[1] : '',
      subscribers: null,
      videos: null,
    };
  });
}

function getInfos(channels) {
  const now = Date.now();
  const missing = channels.filter(function (c) {
    const hit = infoCache.get(channelKey(c));
    return !hit || now - hit.at > INFO_TTL_MS;
  });
  if (!missing.length) return Promise.resolve();

  const job = API_KEY
    ? fetchInfoApi(missing)
    : Promise.all(missing.map(function (c) {
      return fetchInfoScrape(c).then(function (info) { return [channelKey(c), info]; })
        .catch(function (e) { console.warn('[info]', channelKey(c), e.message); return null; });
    })).then(function (pairs) { return new Map(pairs.filter(Boolean)); });

  return job.then(function (map) {
    map.forEach(function (info, key) { infoCache.set(key, { at: now, info: info }); });
  });
}

// ---------- live status ----------

function recentVideoIds(channelId) {
  return get('https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId).then(function (r) {
    const ids = [];
    const re = /<yt:videoId>([\w-]{11})<\/yt:videoId>/g;
    let m;
    while ((m = re.exec(r.body)) && ids.length < 15) ids.push(m[1]);
    return ids;
  }).catch(function () { return []; });
}

function fetchLiveApi(infos) {
  return Promise.all(infos.map(function (i) { return recentVideoIds(i.id); })).then(function (lists) {
    const all = [].concat.apply([], lists);
    return Promise.all(chunk(all, 50).map(function (ids) {
      return api('videos', { part: 'snippet,liveStreamingDetails', id: ids.join(',') });
    })).then(function (pages) {
      const live = new Map(); // channelId -> live info
      pages.forEach(function (p) {
        (p.items || []).forEach(function (v) {
          if (v.snippet.liveBroadcastContent !== 'live') return;
          const d = v.liveStreamingDetails || {};
          const cur = live.get(v.snippet.channelId);
          const viewers = d.concurrentViewers ? Number(d.concurrentViewers) : null;
          // Several simultaneous streams: keep the one with most viewers.
          if (cur && (cur.viewers || 0) >= (viewers || 0)) return;
          const t = v.snippet.thumbnails || {};
          live.set(v.snippet.channelId, {
            videoId: v.id,
            title: v.snippet.title,
            thumbnail: (t.maxres || t.high || t.medium || {}).url || 'https://i.ytimg.com/vi/' + v.id + '/hqdefault_live.jpg',
            viewers: viewers,
            startedAt: d.actualStartTime || null,
          });
        });
      });
      return live;
    });
  });
}

function fetchLiveScrape(c, info) {
  const target = (info && info.id ? 'https://www.youtube.com/channel/' + info.id : channelUrl(c)) + '/live';
  return get(target).then(function (r) {
    const html = r.body;
    // Scheduled (upcoming) streams also resolve to a watch page, so require isLive and exclude isUpcoming.
    if (!/"isLive":true/.test(html) || /"isUpcoming":true/.test(html)) return null;
    const vid = (html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/) || [])[1];
    if (!vid) return null;
    const viewers = (html.match(/"viewCount":\{"runs":\[\{"text":"([\d,.]+)"\},\{"text":" watching now"\}/) || [])[1];
    const started = (html.match(/"startTimestamp":"([^"]+)"/) || [])[1];
    return {
      videoId: vid,
      title: meta(html, 'og:title') || meta(html, 'title'),
      thumbnail: 'https://i.ytimg.com/vi/' + vid + '/hqdefault_live.jpg',
      viewers: viewers ? Number(viewers.replace(/[,.]/g, '')) : null,
      startedAt: started || null,
    };
  }).catch(function (e) { console.warn('[live]', channelKey(c), e.message); return null; });
}

function buildPayload() {
  const cfg = readConfig();
  return getInfos(cfg.channels).then(function () {
    const infos = cfg.channels.map(function (c) {
      const hit = infoCache.get(channelKey(c));
      return hit ? hit.info : { id: c.id || '', handle: c.handle || '', title: c.handle || c.id, avatar: '' };
    });

    const liveJob = API_KEY
      ? fetchLiveApi(infos.filter(function (i) { return i.id; })).then(function (map) {
        return infos.map(function (i) { return map.get(i.id) || null; });
      })
      : Promise.all(cfg.channels.map(function (c, idx) { return fetchLiveScrape(c, infos[idx]); }));

    return liveJob.then(function (lives) {
      return {
        source: API_KEY ? 'youtube-data-api' : 'public-pages',
        refreshSeconds: cfg.refreshSeconds,
        updatedAt: new Date().toISOString(),
        channels: infos.map(function (info, idx) {
          const c = cfg.channels[idx];
          return Object.assign({}, info, {
            tag: c.tag || '',
            url: info.handle ? 'https://www.youtube.com/' + info.handle : channelUrl(c),
            live: lives[idx],
          });
        }),
      };
    });
  });
}

function getPayload(force) {
  const ttl = readConfig().refreshSeconds * 1000 - 5000;
  if (!force && statusCache && Date.now() - statusCache.at < ttl) return Promise.resolve(statusCache.payload);
  if (inflight) return inflight;
  inflight = buildPayload().then(function (payload) {
    statusCache = { at: Date.now(), payload: payload };
    return payload;
  }).then(function (p) { inflight = null; return p; }, function (e) { inflight = null; throw e; });
  return inflight;
}

// ---------- http ----------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};

http.createServer(function (req, res) {
  const u = url.parse(req.url, true);

  if (u.pathname === '/api/channels') {
    getPayload(u.query.force === '1').then(function (payload) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(payload));
    }).catch(function (e) {
      console.error('[api]', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    });
    return;
  }

  const rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (file.indexOf(PUBLIC_DIR) !== 0) { res.writeHead(403); return res.end(); }
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, function () {
  console.log('YouTube Live Grid → http://localhost:' + PORT);
  console.log('Data source: ' + (API_KEY ? 'YouTube Data API v3' : 'public YouTube pages (set YOUTUBE_API_KEY for the API)'));
});
