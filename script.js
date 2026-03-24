'use strict';

// ══════════════════════════════════════════════════════════════════════════════
// RadioNews – script.js
// ══════════════════════════════════════════════════════════════════════════════

// ── Sources RSS par défaut ────────────────────────────────────────────────────

const DEFAULT_SOURCES = [
    { id: 'rtbf',       name: 'RTBF Info',   url: 'https://news.google.com/rss/search?q=site:rtbf.be+info&hl=fr&gl=BE&ceid=BE:fr', color: '#e74c3c', active: true,  custom: false },
    { id: 'rtl',        name: 'RTL Info',    url: 'https://www.rtl.be/rss/articles/info/belgique.xml',             color: '#ff7043', active: false, custom: false },
    { id: 'lesoir',     name: 'Le Soir',     url: 'https://www.lesoir.be/rss',                                     color: '#c0392b', active: false, custom: false },
    { id: 'lalibre',    name: 'La Libre',    url: 'https://www.lalibre.be/arc/outboundfeeds/rss/',                 color: '#2980b9', active: false, custom: false },
    { id: 'rfi',        name: 'RFI',         url: 'https://news.google.com/rss/search?q=site:rfi.fr+actualit%C3%A9s&hl=fr&gl=FR&ceid=FR:fr', color: '#0088cc', active: true,  custom: false },
    { id: 'franceinfo', name: 'France Info', url: 'https://www.francetvinfo.fr/titres.rss',                        color: '#e84b3a', active: true,  custom: false },
    { id: 'lemonde',    name: 'Le Monde',    url: 'https://www.lemonde.fr/rss/une.xml',                            color: '#1a6ebd', active: true,  custom: false },
    { id: 'lefigaro',   name: 'Le Figaro',   url: 'https://www.lefigaro.fr/rss/figaro_actualites.xml',             color: '#cc2200', active: false, custom: false },
    { id: '20min',      name: '20 Minutes',  url: 'https://www.20min.ch/rss/rss.tmpl?type=channel&get=1',          color: '#e31e26', active: false, custom: false },
    { id: 'bfmtv',      name: 'BFM TV',      url: 'https://www.bfmtv.com/rss/news-24-7/',                          color: '#003f7e', active: false, custom: false },
    { id: 'lobs',       name: "L'Obs",       url: 'https://www.nouvelobs.com/rss.xml',                             color: '#e67e22', active: false, custom: false },
    { id: 'euronews',   name: 'Euronews FR', url: 'https://fr.euronews.com/rss',                                   color: '#0f4c81', active: true,  custom: false },
];

// ── État global ───────────────────────────────────────────────────────────────

let sources         = loadSources();       // liste complète des sources
let allArticles     = [];                  // articles fusionnés et dédupliqués
let refreshMins     = loadRefreshMins();   // intervalle de rafraîchissement (min)
let refreshTimer    = null;                // timeout handle pour le rafraîchissement
let nextRefreshTime = 0;                   // timestamp de la prochaine actualisation
let customCity      = localStorage.getItem('rn_custom_city') || ''; // Ville météo personnalisée
let appZoom         = parseFloat(localStorage.getItem('rn_zoom')) || 100; // Niveau de zoom (%)

document.body.style.zoom = appZoom / 100; // S'applique immédiatement au chargement

// ══════════════════════════════════════════════════════════════════════════════
// PERSISTANCE – localStorage
// ══════════════════════════════════════════════════════════════════════════════

function loadSources() {
    try {
        const saved = JSON.parse(localStorage.getItem('rn_sources'));
        if (!saved || !Array.isArray(saved)) throw new Error();

        // Migration transparente pour les flux originaux décédés (RTBF & RFI)
        saved.forEach(s => {
            if (s.id === 'rfi' && s.url.includes('rss-rfi.xml')) {
                s.url = 'https://news.google.com/rss/search?q=site:rfi.fr+actualit%C3%A9s&hl=fr&gl=FR&ceid=FR:fr';
            }
            if (s.id === 'rtbf' && s.url.includes('rtbf.be/rss')) {
                s.url = 'https://news.google.com/rss/search?q=site:rtbf.be+info&hl=fr&gl=BE&ceid=BE:fr';
            }
        });

        // Fusionner : conserver les défauts + états actifs sauvegardés + sources perso
        const result = DEFAULT_SOURCES.map(def => {
            const s = saved.find(x => x.id === def.id);
            return { ...def, active: s ? s.active : def.active };
        });

        // Ajouter les sources personnalisées
        saved.filter(s => s.custom).forEach(s => {
            if (!result.find(r => r.id === s.id)) result.push({ ...s });
        });

        return result;
    } catch {
        return DEFAULT_SOURCES.map(s => ({ ...s }));
    }
}

function saveSources() {
    localStorage.setItem('rn_sources', JSON.stringify(sources));
}

function loadRefreshMins() {
    return parseInt(localStorage.getItem('rn_refresh_mins') || '5', 10);
}

function saveRefreshMins(v) {
    refreshMins = v;
    localStorage.setItem('rn_refresh_mins', String(v));
    resetRefreshTimer();
}

// ══════════════════════════════════════════════════════════════════════════════
// RÉCUPÉRATION DES FLUX RSS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Tente un fetch de l'URL (direct ou via proxy) et retourne le texte XML.
 * Étape 1 : fetch direct.
 * Étape 2 : fallback vers rss_proxy.php si CORS ou réseau bloque.
 * Retourne null si les deux échouent.
 */
async function fetchXml(rssUrl) {
    // Étape 1 – proxy PHP local d'abord (évite les alertes rouges CORS dans la console)
    try {
        const proxyUrl = `rss_proxy.php?url=${encodeURIComponent(rssUrl)}`;
        const resp = await fetch(proxyUrl, { cache: 'no-store' });
        if (resp.ok) return await resp.text();
    } catch { /* proxy inaccessible (ex: localhost ou file://) */ }

    // Étape 2 – fetch direct en fallback
    try {
        const resp = await fetch(rssUrl, { cache: 'no-store' });
        if (resp.ok) return await resp.text();
    } catch { /* CORS ou requête bloquée */ }

    return null;
}

/**
 * Parse un texte XML RSS/Atom et retourne un tableau d'articles normalisés.
 */
function parseXml(xmlText, source) {
    try {
        const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
        if (doc.querySelector('parsererror')) return [];

        // RSS 2.0 → <item> ; Atom → <entry>
        const nodes = Array.from(doc.querySelectorAll('item, entry'));
        if (!nodes.length) return [];

        return nodes.slice(0, 25).map(item => {
            const title = item.querySelector('title')?.textContent?.trim() || '';
            if (!title) return null;

            // <link> en RSS 2.0 est un nœud texte ; en Atom c'est href=""
            const linkEl  = item.querySelector('link');
            const link    = linkEl?.getAttribute('href') || linkEl?.textContent?.trim() || '#';

            const dateStr = item.querySelector('pubDate, published, updated')?.textContent?.trim() || '';
            const desc    = item.querySelector('description, summary, content')?.textContent?.trim() || '';

            // Image : enclosure > media:content/thumbnail > <content> (Atom) > img dans description
            const image =
                item.querySelector('enclosure')?.getAttribute('url') ||
                item.querySelector('media\\:content, media\\:thumbnail')?.getAttribute('url') ||
                item.querySelector('content')?.getAttribute('url') ||
                extractFirstImg(desc) ||
                null;

            const guid = item.querySelector('guid, id')?.textContent?.trim() || link || title;

            return {
                id:       guid,
                title,
                desc:     stripHtml(desc),
                link,
                pubDate:  dateStr ? new Date(dateStr) : new Date(0),
                thumb:    normalizeThumbUrl(image),
                source:   source.name,
                srcColor: source.color,
            };
        }).filter(Boolean);
    } catch {
        return [];
    }
}

/** Extrait la première URL d'image d'un texte HTML. */
function extractFirstImg(html) {
    const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    return m ? m[1] : null;
}

/**
 * Récupère et parse les articles d'une source.
 * Échec silencieux si les deux tentatives échouent.
 */
async function fetchFeed(source) {
    const xmlText = await fetchXml(source.url);
    if (!xmlText) return [];
    return parseXml(xmlText, source);
}

/**
 * Rafraîchit tous les flux actifs, déduplique et re-rend le feed.
 */
async function fetchAllFeeds() {
    const active = sources.filter(s => s.active);
    if (!active.length) {
        allArticles = [];
        renderFeed();
        return;
    }

    showRefreshIndicator(true);

    // Mémoriser les IDs déjà connus avant le fetch
    const prevIds = new Set(allArticles.map(a => a.id));

    const results  = await Promise.allSettled(active.map(fetchFeed));
    const newItems = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

    // Dédupliquer tous les articles (anciens + nouveaux) par ID
    const seenIds = new Set();
    const merged  = [...newItems, ...allArticles].filter(a => {
        if (seenIds.has(a.id)) return false;
        seenIds.add(a.id);
        return true;
    });

    // Trier du plus récent au plus ancien, conserver au maximum 40 articles (optimisation TV)
    const sorted = merged.sort((a, b) => b.pubDate - a.pubDate).slice(0, 40);

    // IDs réellement nouveaux (absents du cycle précédent)
    const freshIds = new Set(sorted.filter(a => !prevIds.has(a.id)).map(a => a.id));

    allArticles = sorted;
    renderFeed(freshIds);

    // Heure de la dernière actualisation
    const t = atomicNow();
    const el = document.getElementById('last-refresh');
    if (el) el.textContent = `Màj ${pad2(t.getHours())}:${pad2(t.getMinutes())}`;

    resetRefreshTimer(); // Relance le timer et le décompte

    updateHeaderBadges();
    showRefreshIndicator(false);
}

function showRefreshIndicator(show) {
    document.getElementById('refresh-indicator').classList.toggle('visible', show);
}

function resetRefreshTimer() {
    if (refreshTimer) clearTimeout(refreshTimer);
    nextRefreshTime = Date.now() + refreshMins * 60 * 1000;
    refreshTimer = setTimeout(fetchAllFeeds, refreshMins * 60 * 1000);
}

// Boucle pour l'affichage du décompte d'actualisation
setInterval(() => {
    if (!nextRefreshTime) return;
    const remaining = Math.max(0, nextRefreshTime - Date.now());
    const min = Math.floor(remaining / 60000);
    const sec = Math.floor((remaining % 60000) / 1000);
    const el = document.getElementById('next-refresh');
    if (el) el.textContent = `- Prochaine: ${pad2(min)}:${pad2(sec)}`;
}, 1000);

// ══════════════════════════════════════════════════════════════════════════════
// RENDU DU FEED
// ══════════════════════════════════════════════════════════════════════════════

function renderFeed(freshIds = new Set()) {
    const inner = document.getElementById('feed-inner');

    // État vide / chargement
    if (allArticles.length === 0) {
        const active = sources.filter(s => s.active);
        const msg = active.length
            ? '<div class="spinner"></div>Chargement des actualités…'
            : 'Aucune source active.<br>Ouvrez ⚙ pour en activer une.';
        inner.innerHTML = `<div class="feed-empty">${msg}</div>`;
        return;
    }

    inner.innerHTML = allArticles.map(a => buildCardHtml(a, freshIds.has(a.id))).join('');

    // Remonter en haut si de nouvelles actus sont arrivées
    if (freshIds.size > 0) {
        document.getElementById('feed-viewport').scrollTop = 0;
    }
}

function buildCardHtml(article, isNew = false) {
    const thumbHtml = article.thumb
        ? `<img class="article-thumb" src="${esc(article.thumb)}" alt="" loading="lazy" onerror="this.style.display='none'">`
        : '';

    return `
        <a href="${esc(article.link)}" target="_blank" class="article-card${isNew ? ' article-card--new' : ''}">
            <div class="article-main">
                <div class="article-meta">
                    <span class="article-source-badge" style="background:${esc(article.srcColor)}">${esc(article.source)}</span>
                    <span class="article-time">${formatRelTime(article.pubDate)}</span>
                </div>
                <div class="article-title">${esc(article.title)}</div>
                ${article.desc ? `<div class="article-desc">${esc(article.desc)}</div>` : ''}
            </div>
            ${thumbHtml}
        </a>`;
}

function updateHeaderBadges() {
    const container = document.getElementById('active-badges');
    const active    = sources.filter(s => s.active);
    container.innerHTML = active.map(s =>
        `<span class="source-badge-header" style="background:${s.color}">${esc(s.name)}</span>`
    ).join('');
}

// ── Utilitaires texte ─────────────────────────────────────────────────────────

/** Échappe les caractères HTML pour prévenir les injections. */
function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Supprime les balises HTML et tronque à 200 caractères. */
function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return (tmp.textContent || tmp.innerText || '').trim().slice(0, 200);
}

/** Normalise les URLs de miniatures (protocol-relative, http). */
function normalizeThumbUrl(url) {
    if (!url || typeof url !== 'string') return null;
    if (url.startsWith('//'))   return 'https:' + url;
    if (url.startsWith('http')) return url;
    return null;
}

/** Formatte une date en temps relatif (ex : "Il y a 12 min"). */
function formatRelTime(date) {
    if (!(date instanceof Date) || isNaN(date)) return '';
    const diffMin = Math.floor((Date.now() - date) / 60000);
    if (diffMin < 1)   return "À l'instant";
    if (diffMin < 60)  return `Il y a ${diffMin} min`;
    const h = pad2(date.getHours());
    const m = pad2(date.getMinutes());
    const dayDiff = Math.floor((Date.now() - date) / 86400000);
    if (dayDiff === 0) return `${h}:${m}`;
    if (dayDiff === 1) return `Hier ${h}:${m}`;
    return `${date.getDate()}/${date.getMonth() + 1} ${h}:${m}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// HORLOGE CANVAS (identique RadioClock v1.1)
// ══════════════════════════════════════════════════════════════════════════════

const DAYS_FR   = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
                   'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const canvas = document.getElementById('clock-canvas');
const ctx    = canvas.getContext('2d');
const DPR    = window.devicePixelRatio || 1;

let S = 300; // taille logique du canvas, mis à jour par resizeClock()

function resizeClock() {
    const panel = document.getElementById('clock-panel');
    const size  = Math.max(140, Math.min(panel.clientWidth, panel.clientHeight) - 12);
    if (size === S) return;
    S = size;
    canvas.width        = S * DPR;
    canvas.height       = S * DPR;
    canvas.style.width  = S + 'px';
    canvas.style.height = S + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

new ResizeObserver(resizeClock).observe(document.getElementById('clock-panel'));
resizeClock();

function drawClock(now) {
    const cx = S / 2, cy = S / 2;
    const R  = S / 2 - 14; // rayon de l'anneau LED

    const h = now.getHours();
    const m = now.getMinutes();
    const s = now.getSeconds();

    ctx.clearRect(0, 0, S, S);

    // Fond (dégradé radial identique RadioClock)
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R + 14);
    bg.addColorStop(0,   '#27272c');
    bg.addColorStop(0.6, '#1e1e22');
    bg.addColorStop(1,   '#161619');
    ctx.beginPath();
    ctx.arc(cx, cy, R + 14, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();

    // Anneau extérieur décoratif
    ctx.beginPath();
    ctx.arc(cx, cy, R + 12, 0, Math.PI * 2);
    ctx.strokeStyle = '#3a3a42';
    ctx.lineWidth   = 1;
    ctx.stroke();

    // Anneau intérieur décoratif
    const innerR = R - 22;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.strokeStyle = '#28282f';
    ctx.lineWidth   = 1;
    ctx.stroke();

    // 60 points LED (rouges pour les secondes écoulées, éteints sinon)
    const ledR = Math.max(3.5, S / 115);
    for (let i = 0; i < 60; i++) {
        const angle  = (i / 60) * Math.PI * 2 - Math.PI / 2;
        const x      = cx + R * Math.cos(angle);
        const y      = cy + R * Math.sin(angle);
        const isFive = i % 5 === 0;
        const r      = isFive ? ledR * 1.5 : ledR;
        const isLit  = i <= s;

        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        if (isLit) {
            ctx.shadowColor = '#ff2020';
            ctx.shadowBlur  = isFive ? 22 : 13;
            ctx.fillStyle   = isFive ? '#ff5555' : '#ff2020';
        } else {
            ctx.shadowBlur = 0;
            ctx.fillStyle  = isFive ? '#3d1a1a' : '#241010';
        }
        ctx.fill();
        ctx.restore();
    }

    // Repères des heures
    for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx + (innerR - 4)  * Math.cos(angle), cy + (innerR - 4)  * Math.sin(angle));
        ctx.lineTo(cx + (innerR - 12) * Math.cos(angle), cy + (innerR - 12) * Math.sin(angle));
        ctx.strokeStyle = i === 0 ? '#8888a0' : '#52525e';
        ctx.lineWidth   = i === 0 ? 2.5 : 1.5;
        ctx.lineCap     = 'round';
        ctx.stroke();
        ctx.restore();
    }

    // Heure digitale centrale
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    const tpx = Math.max(22, Math.round(S * 0.10));
    const dpx = Math.max(10, Math.round(S * 0.032));

    ctx.save();
    ctx.font        = `900 ${tpx}px 'Orbitron', monospace`;
    ctx.fillStyle   = '#f5f5f5';
    ctx.shadowColor = 'rgba(255,255,255,0.07)';
    ctx.shadowBlur  = 16;
    ctx.fillText(`${pad2(h)}:${pad2(m)}:${pad2(s)}`, cx, cy - tpx * 0.30);
    ctx.restore();

    // Ligne date
    ctx.font      = `500 ${dpx}px 'Inter', system-ui, sans-serif`;
    ctx.fillStyle = '#72728a';
    ctx.fillText(`${DAYS_FR[now.getDay()]} ${now.getDate()} ${MONTHS_FR[now.getMonth()]}`, cx, cy + tpx * 0.56);

    // Année
    ctx.font      = `400 ${Math.max(9, Math.round(dpx * 0.82))}px 'Inter', system-ui, sans-serif`;
    ctx.fillStyle = '#4a4a5a';
    ctx.fillText(now.getFullYear(), cx, cy + tpx * 0.56 + dpx * 1.45);
}

function pad2(n) { return String(n).padStart(2, '0'); }

// ── Synchronisation NTP (3 serveurs en cascade) ───────────────────────────────

const TIME_SERVERS = [
    {
        url:     'https://www.cloudflare.com/cdn-cgi/trace',
        extract: async r => {
            const text = await r.text();
            const m = text.match(/ts=([\d.]+)/);
            if (!m) throw new Error('champ ts absent');
            return parseFloat(m[1]) * 1000;
        }
    },
    {
        url:     'https://timeapi.io/api/time/current/zone?timeZone=Etc/UTC',
        extract: async r => {
            const d = await r.json();
            return Date.UTC(d.year, d.month - 1, d.day, d.hour, d.minute, d.seconds, d.milliSeconds);
        }
    },
    {
        url:     'https://worldtimeapi.org/api/timezone/Etc/UTC',
        extract: async r => { const d = await r.json(); return d.unixtime * 1000; }
    }
];

let timeOffset = 0; // ms à ajouter à Date.now() pour obtenir l'heure atomique

async function syncClock() {
    for (const srv of TIME_SERVERS) {
        try {
            const t0 = Date.now();
            const r  = await fetch(srv.url, { cache: 'no-store' });
            const t1 = Date.now();
            if (!r.ok) continue;
            timeOffset = (await srv.extract(r)) - (t0 + t1) / 2; // compensation RTT
            return;
        } catch { /* essayer le suivant */ }
    }
}

function atomicNow() { return new Date(Date.now() + timeOffset); }

syncClock();
setInterval(syncClock, 30 * 60 * 1000);

// ── Boucle d'animation de l'horloge ──────────────────────────────────────────

function clockTick() {
    drawClock(atomicNow());
    requestAnimationFrame(clockTick);
}

document.fonts.ready.then(() => clockTick());

// ══════════════════════════════════════════════════════════════════════════════
// MÉTÉO – Open-Meteo (sans clé API) · Prévisions 3 jours
// ══════════════════════════════════════════════════════════════════════════════

const DAYS_FR_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

const WEATHER_CODES = {
    0:  { label: 'Ciel dégagé',              day: '☀️',  night: '🌙' },
    1:  { label: 'Principalement clair',     day: '🌤️', night: '🌙' },
    2:  { label: 'Partiellement nuageux',    day: '⛅',  night: '☁️' },
    3:  { label: 'Couvert',                  day: '☁️',  night: '☁️' },
    45: { label: 'Brouillard',               day: '🌫️', night: '🌫️' },
    48: { label: 'Brouillard givrant',       day: '🌫️', night: '🌫️' },
    51: { label: 'Bruine légère',            day: '🌦️', night: '🌧️' },
    53: { label: 'Bruine modérée',           day: '🌦️', night: '🌧️' },
    55: { label: 'Bruine dense',             day: '🌧️', night: '🌧️' },
    61: { label: 'Pluie légère',             day: '🌧️', night: '🌧️' },
    63: { label: 'Pluie modérée',            day: '🌧️', night: '🌧️' },
    65: { label: 'Pluie forte',              day: '🌧️', night: '🌧️' },
    71: { label: 'Neige légère',             day: '❄️',  night: '❄️' },
    73: { label: 'Neige modérée',            day: '❄️',  night: '❄️' },
    75: { label: 'Neige forte',              day: '❄️',  night: '❄️' },
    77: { label: 'Grains de neige',          day: '🌨️', night: '🌨️' },
    80: { label: 'Averses légères',          day: '🌦️', night: '🌧️' },
    81: { label: 'Averses modérées',         day: '🌧️', night: '🌧️' },
    82: { label: 'Averses violentes',        day: '⛈️',  night: '⛈️' },
    85: { label: 'Averses de neige',         day: '🌨️', night: '🌨️' },
    86: { label: 'Averses de neige fortes',  day: '🌨️', night: '🌨️' },
    95: { label: 'Orage',                    day: '⛈️',  night: '⛈️' },
    96: { label: 'Orage avec grêle',         day: '⛈️',  night: '⛈️' },
    99: { label: 'Orage violent avec grêle', day: '⛈️',  night: '⛈️' },
};

function tempColor(t) {
    if (t <= 0)  return '#60a5fa';
    if (t <= 10) return '#93c5fd';
    if (t <= 20) return '#f5f5f5';
    if (t <= 28) return '#fbbf24';
    return '#f87171';
}

function windDir(deg) {
    return ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(deg / 45) % 8];
}

async function loadWeather() {
    let lat, lon, city;

    try {
        if (customCity) {
            const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(customCity)}&format=json&limit=1`, { headers: { 'Accept-Language': 'fr' } });
            const geoData = await geoRes.json();
            if (geoData && geoData.length > 0) {
                lat = parseFloat(geoData[0].lat);
                lon = parseFloat(geoData[0].lon);
                city = geoData[0].name || customCity;
            } else {
                throw new Error("Ville introuvable");
            }
        } else {
            // 1. Browser geolocation
            try {
                const pos = await new Promise((resolve, reject) =>
                    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 7000 })
                );
                lat = pos.coords.latitude;
                lon = pos.coords.longitude;

                const geoRes  = await fetch(
                    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`,
                    { headers: { 'Accept-Language': 'fr' } }
                );
                const geoData = await geoRes.json();
                city = geoData.address?.city
                    || geoData.address?.town
                    || geoData.address?.village
                    || geoData.address?.municipality
                    || 'Localité inconnue';
            } catch {
                // 2. Fallback: IP geolocation
                const ip  = await fetch('https://ipapi.co/json/');
                const ipd = await ip.json();
                lat  = ipd.latitude;
                lon  = ipd.longitude;
                city = ipd.city || 'Localité inconnue';
            }
        }

        document.getElementById('weather-city').textContent = city;

        // Open-Meteo (5 days)
        const wUrl = 'https://api.open-meteo.com/v1/forecast'
            + `?latitude=${lat}&longitude=${lon}`
            + '&current_weather=true'
            + '&hourly=relativehumidity_2m'
            + '&daily=weathercode,temperature_2m_max,temperature_2m_min'
            + '&timezone=auto&forecast_days=5';

        const wData = await (await fetch(wUrl)).json();
        const cw    = wData.current_weather;
        const entry = WEATHER_CODES[cw.weathercode] ?? { label: 'Inconnu', day: '🌡️', night: '🌡️' };
        const icon  = cw.is_day ? entry.day : entry.night;
        const temp  = Math.round(cw.temperature);
        const t     = atomicNow();
        const hum   = wData.hourly?.relativehumidity_2m?.[t.getHours()] ?? '--';
        const wind  = `${Math.round(cw.windspeed)} km/h ${windDir(cw.winddirection)}`;

        document.getElementById('weather-icon').textContent  = icon;
        const tempEl = document.getElementById('weather-temp');
        tempEl.textContent = `${temp}°C`;
        tempEl.style.color = tempColor(temp);
        document.getElementById('weather-desc').textContent  = entry.label;
        document.getElementById('weather-wind').textContent  = wind;
        document.getElementById('weather-hum').textContent   = `${hum}%`;

        // Prévisions 5 jours
        const forecastEl = document.getElementById('weather-forecast');
        forecastEl.innerHTML = [0, 1, 2, 3, 4].map(i => {
            const dateStr  = wData.daily.time?.[i];
            const dayLabel = i === 0 ? 'Auj.' : (dateStr
                ? DAYS_FR_SHORT[new Date(dateStr + 'T12:00:00').getDay()]
                : '—');
            const code     = wData.daily.weathercode?.[i] ?? 0;
            const dayEntry = WEATHER_CODES[code] ?? { day: '🌡️' };
            const maxT     = Math.round(wData.daily.temperature_2m_max[i]);
            const minT     = Math.round(wData.daily.temperature_2m_min[i]);
            return `<div class="forecast-day">
                <span class="forecast-label">${dayLabel}</span>
                <span class="forecast-icon">${dayEntry.day}</span>
                <span class="forecast-temps">
                    <span style="color:${tempColor(maxT)}">${maxT}°</span>
                    <span class="forecast-min">${minT}°</span>
                </span>
            </div>`;
        }).join('');

        document.getElementById('weather-updated').textContent =
            `Màj ${pad2(t.getHours())}:${pad2(t.getMinutes())}`;

        document.getElementById('weather-loading').style.display  = 'none';
        document.getElementById('weather-content').style.display  = 'flex';

    } catch (err) {
        console.error('[RadioNews] Météo:', err);
        document.getElementById('weather-loading').textContent = '⚠️ Météo indisponible';
    }
}

loadWeather();
setInterval(loadWeather, 10 * 60 * 1000);

// ══════════════════════════════════════════════════════════════════════════════
// PANNEAU DE CONFIGURATION
// ══════════════════════════════════════════════════════════════════════════════

/** Reconstruit la liste des sources dans le panneau de config. */
function renderSourcesList() {
    const container = document.getElementById('sources-list');

    container.innerHTML = sources.map(s => `
        <div class="source-row">
            <span class="source-dot" style="background:${s.color}"></span>
            <span class="source-name">${esc(s.name)}</span>
            <label class="toggle">
                <input type="checkbox" data-id="${s.id}" ${s.active ? 'checked' : ''}>
                <span class="toggle-track"></span>
            </label>
            ${s.custom
                ? `<button class="source-delete" data-id="${s.id}" title="Supprimer">✕</button>`
                : ''}
        </div>
    `).join('');

    // Toggles actif/inactif
    container.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', () => {
            const src = sources.find(s => s.id === cb.dataset.id);
            if (!src) return;
            src.active = cb.checked;
            saveSources();
            updateHeaderBadges();
            fetchAllFeeds();
        });
    });

    // Suppression (sources perso seulement)
    container.querySelectorAll('.source-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            sources = sources.filter(s => s.id !== btn.dataset.id);
            saveSources();
            renderSourcesList();
            updateHeaderBadges();
            fetchAllFeeds();
        });
    });
}

// Ouvrir / fermer le panneau
document.getElementById('btn-config').addEventListener('click', () => {
    renderSourcesList();
    document.getElementById('config-overlay').classList.add('open');
});

document.getElementById('config-close').addEventListener('click', () =>
    document.getElementById('config-overlay').classList.remove('open')
);

// Clic sur le fond semi-transparent
document.getElementById('config-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('config-overlay'))
        document.getElementById('config-overlay').classList.remove('open');
});

// Touche Échap
document.addEventListener('keydown', e => {
    if (e.key === 'Escape')
        document.getElementById('config-overlay').classList.remove('open');
});

// ── Échelle / Zoom (Spécial TV) ─────────────────────────────────────────────
const zoomBtns = document.querySelectorAll('.zoom-btn');
if (zoomBtns.length > 0) {
    const updateZoomBtns = (currentZoom) => {
        zoomBtns.forEach(btn => {
            if (parseInt(btn.dataset.zoom, 10) === currentZoom) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    };
    
    updateZoomBtns(appZoom);
    
    zoomBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const v = parseInt(btn.dataset.zoom, 10);
            appZoom = v;
            document.body.style.zoom = v / 100;
            localStorage.setItem('rn_zoom', v);
            updateZoomBtns(v);
        });
    });
}

// ── Slider intervalle de rafraîchissement ─────────────────────────────────────
const refreshSlider = document.getElementById('refresh-interval-slider');
refreshSlider.value = refreshMins;
document.getElementById('refresh-interval-val').textContent = refreshMins;

refreshSlider.addEventListener('input', () => {
    const v = parseInt(refreshSlider.value, 10);
    document.getElementById('refresh-interval-val').textContent = v;
    saveRefreshMins(v);
});

// ── Ville Météo ─────────────────────────────────────────────────────────────
const cityInput = document.getElementById('weather-city-input');
cityInput.value = customCity;

document.getElementById('save-city-btn').addEventListener('click', () => {
    const val = cityInput.value.trim();
    customCity = val;
    localStorage.setItem('rn_custom_city', val);
    const msgEl = document.getElementById('save-city-msg');
    
    msgEl.className = 'success';
    msgEl.textContent = '✓ Enregistré.';
    setTimeout(() => { msgEl.textContent = ''; }, 3000);
    
    document.getElementById('weather-loading').style.display  = 'flex';
    document.getElementById('weather-content').style.display  = 'none';
    loadWeather();
});

// ── Ajout d'une source personnalisée ─────────────────────────────────────────
document.getElementById('add-source-btn').addEventListener('click', () => {
    const nameEl = document.getElementById('custom-name');
    const urlEl  = document.getElementById('custom-url');
    const msgEl  = document.getElementById('add-source-msg');

    const name = nameEl.value.trim();
    const url  = urlEl.value.trim();

    msgEl.className = 'error';
    msgEl.textContent = '';

    if (!name) { msgEl.textContent = 'Entrez un nom de source.'; return; }
    if (!url)  { msgEl.textContent = 'Entrez une URL RSS.';      return; }

    try { new URL(url); } catch { msgEl.textContent = 'URL invalide.'; return; }

    // Palette tournante pour les sources personnalisées
    const palette = ['#9b59b6', '#1abc9c', '#3498db', '#e67e22', '#2ecc71', '#e91e63'];
    const color   = palette[sources.filter(s => s.custom).length % palette.length];

    sources.push({ id: 'custom_' + Date.now(), name, url, color, active: true, custom: true });
    saveSources();
    renderSourcesList();
    updateHeaderBadges();
    fetchAllFeeds();

    nameEl.value = '';
    urlEl.value  = '';
    msgEl.className   = 'success';
    msgEl.textContent = '✓ Source ajoutée.';
    setTimeout(() => { msgEl.textContent = ''; }, 3000);
});

// ══════════════════════════════════════════════════════════════════════════════
// PLEIN ÉCRAN
// ══════════════════════════════════════════════════════════════════════════════

document.getElementById('btn-fullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    } else {
        document.exitFullscreen().catch(() => {});
    }
});

document.addEventListener('fullscreenchange', () => {
    document.getElementById('btn-fullscreen').textContent =
        document.fullscreenElement ? '⊡' : '⛶';
});

// ══════════════════════════════════════════════════════════════════════════════
// INITIALISATION
// ══════════════════════════════════════════════════════════════════════════════

updateHeaderBadges();
fetchAllFeeds();       // premier chargement immédiat et reset timer
