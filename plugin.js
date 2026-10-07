const SOURCE_ORIGINS = new Set([
  "https://rbtvplus17.lat",
  "https://www.rbtvplus17.lat",
  "https://rbtvplus18.buzz",
  "https://www.rbtvplus18.buzz",
  "https://rbtvplus18.beer",
  "https://www.rbtvplus18.beer",
  "https://rbtvplus18.casa",
  "https://www.rbtvplus18.casa",
]);

const DEFAULT_SOURCE = "https://www.rbtvplus18.casa/es";
const AGENDA_TTL_MS = 5 * 60 * 1000;
const AGENDA_CACHE_VERSION = "v5";
const PAGE_SIZE = 50;

const CATEGORIES = [
  ["live", "En vivo", "/es"],
  ["football", "Fútbol", "/es/football.html"],
  ["basketball", "Baloncesto", "/es/basketball.html"],
  ["baseball", "Béisbol", "/es/baseball.html"],
  ["american-football", "Fútbol americano", "/es/american-football.html"],
  ["tennis", "Tenis", "/es/tennis.html"],
  ["motorsport", "Motor", "/es/motorsport.html"],
  ["hockey", "Hockey", "/es/hockey.html"],
  ["fighting", "Combate", "/es/fighting.html"],
];

const SECTION_TABS = [
  ...CATEGORIES.slice(0, 7).map(([id, label]) => ({ id, label })),
  { id: "more", label: "Más deportes" },
];

function normalizeSourceUrl(raw, base = DEFAULT_SOURCE) {
  try {
    const url = new URL(String(raw || "").trim(), base);
    if (url.protocol !== "https:" || !SOURCE_ORIGINS.has(url.origin)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function text(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function stableId(url) {
  let hash = 2166136261;
  for (const character of url) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `event-${(hash >>> 0).toString(16)}`;
}

function imageData(block) {
  const images = [...String(block).matchAll(/<img\b([^>]*)>/gi)].map((match) => {
    const attrs = match[1];
    const src = (attrs.match(/\bsrc=(?:"([^"]+)"|'([^']+)')/i) || [])
      .slice(1)
      .find(Boolean);
    const alt = (attrs.match(/\balt=(?:"([^"]*)"|'([^']*)')/i) || [])
      .slice(1)
      .find((value) => value !== undefined);
    let logo;
    try {
      const url = new URL(src);
      if (url.protocol === "https:") logo = url.toString();
    } catch {
      logo = undefined;
    }
    return { name: text(alt), logo };
  });
  const teamImages = images.filter(({ logo }) => {
    if (!logo) return false;
    const url = new URL(logo);
    return url.hostname.startsWith("logos") || /\/(?:team|club)\//i.test(url.pathname);
  });
  return (teamImages.length >= 2 ? teamImages : images.filter(({ logo }) => logo)).slice(0, 2);
}

function humanizeSlug(value) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(value || ""));
  } catch {
    decoded = String(value || "");
  }
  return decoded
    .replace(/-\d+$/i, "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.toLowerCase() === "vs"
      ? "vs"
      : `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function eventPathData(sourcePage) {
  const segments = new URL(sourcePage).pathname.split("/").filter(Boolean);
  const filename = segments[segments.length - 1] || "";
  if (segments.length < 4 || !filename.endsWith(".html")) return null;
  const eventSlug = filename.slice(0, -".html".length);
  const teams = eventSlug.split(/-vs-/i);
  return {
    title: teams.length === 2
      ? `${humanizeSlug(teams[0])} vs ${humanizeSlug(teams[1])}`
      : humanizeSlug(eventSlug),
    league: humanizeSlug(segments[segments.length - 2]),
    homeName: teams.length === 2 ? humanizeSlug(teams[0]) : undefined,
    awayName: teams.length === 2 ? humanizeSlug(teams[1]) : undefined,
  };
}

function parseAgendaHtml(html, category, baseUrl = DEFAULT_SOURCE) {
  const matches = String(html || "").match(
    /<a\b[^>]*href=(?:"([^"]+)"|'([^']+)')[^>]*>[\s\S]*?<\/a>/gi,
  ) || [];
  const seen = new Set();
  const events = [];
  for (const block of matches) {
    const href = (block.match(/href=(?:"([^"]+)"|'([^']+)')/i) || [])
      .slice(1)
      .find(Boolean);
    const sourcePage = normalizeSourceUrl(href, baseUrl);
    if (!sourcePage || seen.has(sourcePage)) continue;
    const pathData = eventPathData(sourcePage);
    const title = text((block.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i) || [])[1])
      || (pathData && pathData.title);
    if (!title) continue;
    const [home = {}, away = {}] = imageData(block);
    const startTime = text((block.match(/<time\b[^>]*>([\s\S]*?)<\/time>/i) || [])[1])
      || ((text(block).match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/) || [])[0] || "");
    const scoreValues = [...block.matchAll(
      /class=["'][^"']*\bADVrU5\b[^"']*["'][^>]*>\s*([^<]*)/gi,
    )].map((match) => text(match[1])).filter(Boolean);
    const liveClock = text((block.match(
      /class=["'][^"']*\b_1xh4DS\b[^"']*["'][^>]*>\s*([^<]*)/i,
    ) || [])[1]);
    const isLive = /icon_live_stream_active\.webp/i.test(block)
      || scoreValues.length >= 2;
    seen.add(sourcePage);
    events.push({
      id: stableId(sourcePage),
      ref: `event:${sourcePage}`,
      category,
      title,
      league: text((block.match(/class="league"[^>]*>([\s\S]*?)<\//i) || [])[1])
        || (pathData && pathData.league) || "",
      startTime,
      homeName: home.name || (pathData && pathData.homeName) || undefined,
      awayName: away.name || (pathData && pathData.awayName) || undefined,
      homeLogo: home.logo,
      awayLogo: away.logo,
      isLive,
      homeScore: scoreValues.length >= 2 ? scoreValues[0] : undefined,
      awayScore: scoreValues.length >= 2 ? scoreValues[1] : undefined,
      liveClock: liveClock || undefined,
      sourcePage,
    });
  }
  return events;
}

function toKinoItem(event) {
  const teams = event.homeName && event.awayName
    ? event.isLive && event.homeScore !== undefined && event.awayScore !== undefined
      ? `${event.homeName} ${event.homeScore}–${event.awayScore} ${event.awayName}`
      : `${event.homeName} VS ${event.awayName}`
    : event.title.replace(/\s+vs\s+/i, " VS ");
  const title = event.isLive
    ? `🔴 EN VIVO · ${teams}${event.liveClock ? ` · ${event.liveClock}` : ""}`
    : `${event.startTime ? `${event.startTime} · ` : ""}${teams}`;
  const badges = [
    event.isLive ? "EN VIVO" : event.startTime,
    event.homeScore !== undefined && event.awayScore !== undefined
      ? `${event.homeScore}–${event.awayScore}`
      : undefined,
    event.liveClock,
  ].filter(Boolean);
  return {
    id: event.id,
    ref: event.ref,
    title,
    originalTitle: event.league || undefined,
    kind: "movie",
    poster: event.homeLogo || event.awayLogo || undefined,
    badges: badges.length ? badges : undefined,
  };
}

function categoryById(category) {
  return CATEGORIES.find(([id]) => id === category) || CATEGORIES[0];
}

function readEvents(key) {
  const saved = kino.storage.get(key);
  if (!saved) return null;
  try {
    const value = JSON.parse(saved);
    return Array.isArray(value) && value.length ? value : null;
  } catch {
    kino.storage.remove(key);
    return null;
  }
}

async function loadAgenda(category, { force = false } = {}) {
  const selected = categoryById(category);
  const freshKey = `agenda:${selected[0]}:${AGENDA_CACHE_VERSION}:fresh`;
  const lastKey = `agenda:${selected[0]}:${AGENDA_CACHE_VERSION}:last`;
  if (!force) {
    const cached = readEvents(freshKey);
    if (cached) return cached;
  }
  try {
    const pageUrl = new URL(selected[2], DEFAULT_SOURCE).toString();
    const response = await kino.fetch(pageUrl);
    if (!response.ok) {
      throw kino.error("unavailable", `Agenda HTTP ${response.status}`);
    }
    const finalPageUrl = normalizeSourceUrl(response.url, pageUrl) || pageUrl;
    let events = parseAgendaHtml(response.text(), selected[0], finalPageUrl);
    if (
      !events.length
      && kino.browser
      && typeof kino.browser.page === "function"
    ) {
      try {
        const rendered = await kino.browser.page(pageUrl, {
          timeoutMs: 12000,
          waitFor: "match-list[\\s\\S]*href=[\"']/es/[^/\"']+/[^/\"']+/[^/\"']+\\.html",
        });
        const renderedBaseUrl = normalizeSourceUrl(rendered.finalUrl, finalPageUrl)
          || finalPageUrl;
        events = parseAgendaHtml(rendered.html, selected[0], renderedBaseUrl);
        if (typeof kino.log === "function") {
          const detailLinks = (String(rendered.html).match(
            /href=["'][^"']*\/es\/[^/"']+\/[^/"']+\/[^/"']+\.html/gi,
          ) || []).length;
          kino.log(
            `agenda ${selected[0]}: ${events.length} eventos, ${detailLinks} enlaces, ${String(rendered.html).length} caracteres`,
          );
        }
      } catch (error) {
        if (typeof kino.log === "function") {
          kino.log(`agenda ${selected[0]} falló: ${error && error.message ? error.message : error}`);
        }
        // A rendered page is only a fallback; an empty fetched agenda remains valid.
      }
    }
    if (selected[0] === "live") {
      events = events.filter((event) => event.isLive);
    }
    const serialized = JSON.stringify(events);
    kino.storage.set(freshKey, serialized, { ttlMs: AGENDA_TTL_MS });
    kino.storage.set(lastKey, serialized);
    return events;
  } catch (error) {
    const last = readEvents(lastKey);
    if (last) return last;
    throw error;
  }
}

function rowForCategory(category, events) {
  const [, label] = categoryById(category);
  return {
    id: `sports-${category}`,
    title: label,
    ref: `category:${category}`,
    items: events.slice(0, 20).map(toKinoItem),
  };
}

function embeddedHeader(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(html || "").match(
    new RegExp(`["']${escaped}["']\\s*:\\s*["']([^"']+)["']`, "i"),
  );
  return match ? match[1] : null;
}

function extractDirectStreams(html, pageUrl) {
  const source = String(html || "");
  const urls = [...source.matchAll(
    /https?:\\?\/\\?\/[^"'\s<>]+?(?:\.m3u8|\.mpd|\.mp4)(?:\?[^"'\s<>]*)?/gi,
  )].map((match) => match[0].replace(/\\\//g, "/").replace(/&amp;/g, "&"));
  const origin = new URL(pageUrl).origin;
  const headers = {
    Referer: embeddedHeader(source, "Referer") || pageUrl,
    Origin: embeddedHeader(source, "Origin") || origin,
  };
  const userAgent = embeddedHeader(source, "User-Agent");
  if (userAgent) headers["User-Agent"] = userAgent;
  const unique = [...new Set(urls)].map((url) => ({
    url,
    mime: /\.m3u8(?:\?|$)/i.test(url)
      ? "application/vnd.apple.mpegurl"
      : /\.mpd(?:\?|$)/i.test(url)
        ? "application/dash+xml"
        : "video/mp4",
    headers: { ...headers },
  }));
  const priority = {
    "application/vnd.apple.mpegurl": 0,
    "application/dash+xml": 1,
    "video/mp4": 2,
  };
  return unique.sort((left, right) => priority[left.mime] - priority[right.mime]);
}

async function captureStream(pageUrl) {
  const page = await kino.browser.capture(pageUrl, {
    timeoutMs: 15000,
    match: "(?:\\.m3u8|\\.mpd|\\.mp4)(?:\\?|$)",
    autoplay: true,
  });
  const media = Array.isArray(page && page.media) ? page.media : [];
  if (!media.length) {
    throw kino.error("unavailable", "El servidor no entregó una señal");
  }
  const [first, ...rest] = media;
  return {
    url: first.url,
    mime: first.mime,
    headers: first.headers,
    alternatives: rest.slice(0, 4).map((item, index) => ({
      label: `Señal ${index + 2}`,
      url: item.url,
      mime: item.mime,
      headers: item.headers,
    })),
  };
}

export async function home() {
  const events = await loadAgenda("live");
  return events.length ? [rowForCategory("live", events)] : [];
}

export async function browse(ref, cursor) {
  const match = /^category:([a-z-]+)$/.exec(String(ref || ""));
  const category = match && CATEGORIES.some(([id]) => id === match[1]) ? match[1] : null;
  if (!category) throw kino.error("not_found", "Categoría deportiva desconocida");
  const events = await loadAgenda(category);
  const offset = /^\d+$/.test(String(cursor || "")) ? Number(cursor) : 0;
  const items = events.slice(offset, offset + PAGE_SIZE).map(toKinoItem);
  const nextOffset = offset + items.length;
  return {
    items,
    next: nextOffset < events.length ? String(nextOffset) : undefined,
  };
}

export async function resolve(ref) {
  const raw = String(ref || "");
  const pageUrl = raw.startsWith("event:")
    ? normalizeSourceUrl(raw.slice("event:".length))
    : null;
  if (!pageUrl) throw kino.error("not_found", "Enlace de evento inválido");
  const response = await kino.fetch(pageUrl);
  if (!response.ok) {
    throw kino.error("unavailable", `Evento HTTP ${response.status}`);
  }
  const streams = extractDirectStreams(response.text(), pageUrl);
  if (!streams.length) {
    try {
      return await captureStream(pageUrl);
    } catch (error) {
      if (["blocked", "timeout", "busy", "browser_unavailable"].includes(error && error.code)) {
        throw kino.error(
          "unavailable",
          "Esta señal necesita una WebView compatible o no respondió a tiempo",
        );
      }
      throw error;
    }
  }
  const [first, ...rest] = streams;
  return {
    ...first,
    alternatives: rest.slice(0, 8).map((stream, index) => ({
      label: `Servidor ${index + 2}`,
      ...stream,
    })),
  };
}

export async function section({ tab } = {}) {
  const selected = SECTION_TABS.some((item) => item.id === tab) ? tab : "live";
  let rows;
  if (selected === "more") {
    const [hockey, fighting] = await Promise.all([
      loadAgenda("hockey"),
      loadAgenda("fighting"),
    ]);
    rows = [
      rowForCategory("hockey", hockey),
      rowForCategory("fighting", fighting),
    ].filter((row) => row.items.length);
  } else {
    const events = await loadAgenda(selected);
    rows = events.length ? [rowForCategory(selected, events)] : [];
  }
  return {
    tab: selected,
    tabs: SECTION_TABS,
    rows,
  };
}

export async function action(key) {
  if (key !== "refreshAgenda") {
    throw kino.error("not_found", "Acción desconocida");
  }
  for (const storageKey of kino.storage.keys()) {
    if (storageKey.startsWith("agenda:")) kino.storage.remove(storageKey);
  }
  return { message: "La agenda se actualizará al abrir Deportes" };
}

export const __testing = {
  normalizeSourceUrl,
  parseAgendaHtml,
  toKinoItem,
  loadAgenda,
  extractDirectStreams,
};
