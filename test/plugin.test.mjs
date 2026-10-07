import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validate } from "../sdk/validate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = await import(pathToFileURL(join(root, "plugin.js")).href + `?v=${Date.now()}`);
const agenda = readFileSync(join(root, "test/fixtures/agenda.html"), "utf8");
const renderedAgenda = readFileSync(
  join(root, "test/fixtures/agenda-rendered.html"),
  "utf8",
);

test("Kino accepts the Deportes manifest and required exports", async () => {
  const result = await validate(root);
  assert.deepEqual(result.problems, []);
});

test("published package has a valid small PNG icon and stable identity", () => {
  const manifest = JSON.parse(readFileSync(join(root, "kino-plugin.json"), "utf8"));
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const icon = readFileSync(join(root, manifest.icon));
  assert.equal(manifest.id, "kino-deportes");
  assert.equal(manifest.version, "0.1.3");
  assert.equal(manifest.author, "CRONOS");
  assert.equal(
    manifest.homepage,
    "https://github.com/b7vzq9my8w-source/kino-plugin-deportes",
  );
  assert.match(readme, /b7vzq9my8w-source\/kino-plugin-deportes/);
  assert.doesNotMatch(readme, /usuario-de-github/);
  assert.deepEqual([...icon.subarray(1, 4)], [80, 78, 71]);
  assert.ok(statSync(join(root, manifest.icon)).size <= 128 * 1024);
});

test("URL policy accepts only HTTPS RBTV event pages", () => {
  const normalize = plugin.__testing.normalizeSourceUrl;
  assert.equal(
    normalize("/es/football/a.html", "https://www.rbtvplus18.beer/es"),
    "https://www.rbtvplus18.beer/es/football/a.html",
  );
  assert.equal(
    normalize("/es/football/a.html", "https://www.rbtvplus18.casa/es"),
    "https://www.rbtvplus18.casa/es/football/a.html",
  );
  assert.equal(normalize("http://www.rbtvplus18.beer/es/a.html"), null);
  assert.equal(normalize("javascript:alert(1)"), null);
  assert.equal(normalize("https://evil.example/a"), null);
});

test("agenda parser rejects unsafe entries, deduplicates and keeps stable ids", () => {
  const first = plugin.__testing.parseAgendaHtml(
    agenda,
    "live",
    "https://www.rbtvplus18.beer/es",
  );
  const second = plugin.__testing.parseAgendaHtml(
    agenda,
    "live",
    "https://www.rbtvplus18.beer/es",
  ).reverse();
  assert.equal(first.length, 2);
  assert.equal(new Set(first.map((event) => event.sourcePage)).size, 2);
  assert.deepEqual(
    first.map((event) => event.id).sort(),
    second.map((event) => event.id).sort(),
  );
  assert.equal(first[0].league, "Estados Unidos: MLB");
  assert.equal(first[0].startTime, "16:35");
  assert.equal(first[0].homeName, "Boston Red Sox");
  assert.equal(first[0].awayName, "Chicago Cubs");
  assert.equal(first[0].homeLogo, "https://static.example.org/red-sox.png");
});

test("agenda parser supports the current rendered RBTV match markup", () => {
  const [event] = plugin.__testing.parseAgendaHtml(
    renderedAgenda,
    "football",
    "https://www.rbtvplus18.casa/es",
  );
  assert.equal(event.title, "Grenada vs Cuba");
  assert.equal(event.league, "Concacaf Nations League");
  assert.equal(event.startTime, "16:00");
  assert.equal(event.homeName, "Grenada");
  assert.equal(event.awayName, "Cuba");
  assert.equal(event.homeLogo, "https://logos1.tcllu137fien.ru/team/grenada.png");
  assert.equal(event.awayLogo, "https://logos1.tcllu137fien.ru/team/cuba.png");
});

function fakeKino({ body = agenda, fail = false } = {}) {
  const values = new Map();
  let fetches = 0;
  const api = {
    fetch: async () => {
      fetches += 1;
      if (fail) throw Object.assign(new Error("offline"), { code: "network" });
      return {
        ok: true,
        status: 200,
        url: "https://www.rbtvplus18.beer/es",
        headers: { "content-type": "text/html; charset=utf-8" },
        text: () => body,
      };
    },
    storage: {
      get: (key) => values.get(key) ?? null,
      set: (key, value) => values.set(key, String(value)),
      remove: (key) => values.delete(key),
      keys: () => [...values.keys()],
    },
    error: (code, message) => Object.assign(
      new Error(message),
      { code, userMessage: message },
    ),
  };
  globalThis.kino = api;
  return { kino: api, values, fetches: () => fetches };
}

test("section reuses agenda cache and returns native live cards", async () => {
  const fake = fakeKino();
  const first = await plugin.section({ tab: "live" });
  const second = await plugin.section({ tab: "live" });
  assert.equal(fake.fetches(), 1);
  assert.equal(first.tab, "live");
  assert.ok(first.tabs.some((tab) => tab.id === "football"));
  assert.equal(first.rows[0].items[0].kind, "live");
  assert.deepEqual(second, first);
});

test("agenda uses one bounded rendered-page fallback when the fetched HTML is empty", async () => {
  const fake = fakeKino({ body: "<html><body><div id=app></div></body></html>" });
  const pages = [];
  fake.kino.browser = {
    page: async (url, options) => {
      pages.push({ url, options });
      return { html: agenda, finalUrl: url, status: 200, truncated: false };
    },
  };
  const events = await plugin.__testing.loadAgenda("live");
  assert.equal(events.length, 2);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].options.timeoutMs, 12000);
  assert.match(pages[0].options.waitFor, /match-list/);
});

test("agenda waits for a real detail link instead of a footer link", async () => {
  const fake = fakeKino({ body: "<html><body><div id=app></div></body></html>" });
  const prematureHtml = `
    <div class="match-list"></div>
    <footer><a href="/es/about-us.html">Acerca de</a></footer>
  `;
  fake.kino.browser = {
    page: async (url, options) => {
      const ready = new RegExp(options.waitFor, "i");
      const html = ready.test(prematureHtml) ? prematureHtml : renderedAgenda;
      return { html, finalUrl: url, status: 200, truncated: false };
    },
  };
  const events = await plugin.__testing.loadAgenda("tennis");
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Grenada vs Cuba");
});

test("agenda keeps the approved RBTV base after WebView redirects to a mirror", async () => {
  const fake = fakeKino({ body: "<html><body><div id=app></div></body></html>" });
  fake.kino.browser = {
    page: async () => ({
      html: renderedAgenda,
      finalUrl: "https://lola59.example-mirror.invalid/es/football.html",
      status: 200,
      truncated: false,
    }),
  };
  const events = await plugin.__testing.loadAgenda("football");
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Grenada vs Cuba");
  assert.equal(new URL(events[0].sourcePage).hostname, "www.rbtvplus18.beer");
});

test("agenda update ignores an empty cache written by the broken selector", async () => {
  const fake = fakeKino({ body: "<html><body><div id=app></div></body></html>" });
  fake.values.set("agenda:tennis:fresh", "[]");
  fake.values.set("agenda:tennis:last", "[]");
  fake.kino.browser = {
    page: async (url) => ({
      html: renderedAgenda,
      finalUrl: url,
      status: 200,
      truncated: false,
    }),
  };
  const events = await plugin.__testing.loadAgenda("tennis");
  assert.equal(events.length, 1);
  assert.equal(fake.fetches(), 1);
});

test("section stays within eight tabs and exposes hockey and combat under more sports", async () => {
  const fake = fakeKino();
  const result = await plugin.section({ tab: "more" });
  assert.equal(result.tabs.length, 8);
  assert.deepEqual(result.rows.map((row) => row.title), ["Hockey", "Combate"]);
  assert.equal(fake.fetches(), 2);
});

test("last good agenda survives a network failure after TTL cache is removed", async () => {
  const fake = fakeKino();
  await plugin.__testing.loadAgenda("live");
  fake.values.delete("agenda:live:fresh");
  globalThis.kino.fetch = async () => {
    throw Object.assign(new Error("offline"), { code: "network" });
  };
  const events = await plugin.__testing.loadAgenda("live");
  assert.equal(events.length, 2);
});

test("refresh action clears all agenda keys", async () => {
  const fake = fakeKino();
  fake.values.set("agenda:live:fresh", "[]");
  fake.values.set("agenda:live:last", "[]");
  assert.deepEqual(
    await plugin.action("refreshAgenda"),
    { message: "La agenda se actualizará al abrir Deportes" },
  );
  assert.deepEqual([...fake.values.keys()], []);
});

test("direct resolver prefers HLS and preserves allowed headers", async () => {
  const html = readFileSync(join(root, "test/fixtures/event-direct.html"), "utf8");
  globalThis.kino = {
    ...fakeKino().kino,
    fetch: async () => ({
      ok: true,
      status: 200,
      url: "https://www.rbtvplus18.beer/es/baseball/game.html",
      headers: { "content-type": "text/html; charset=utf-8" },
      text: () => html,
    }),
    error: (code, message) => Object.assign(
      new Error(message),
      { code, userMessage: message },
    ),
  };
  const stream = await plugin.resolve(
    "event:https://www.rbtvplus18.beer/es/baseball/game.html",
  );
  assert.equal(stream.url, "https://cdn.example.net/live/master.m3u8");
  assert.equal(stream.mime, "application/vnd.apple.mpegurl");
  assert.equal(stream.headers.Referer, "https://www.rbtvplus18.beer/");
  assert.equal(stream.headers.Origin, "https://www.rbtvplus18.beer");
  assert.equal(stream.headers["User-Agent"], "KinoTV/1");
});

test("resolve rejects a ref outside approved HTTPS sources before fetch", async () => {
  let called = false;
  globalThis.kino = {
    fetch: async () => { called = true; },
    error: (code, message) => Object.assign(new Error(message), { code, userMessage: message }),
  };
  await assert.rejects(
    plugin.resolve("event:https://evil.example/game"),
    (error) => error.code === "not_found" && error.userMessage === "Enlace de evento inválido",
  );
  assert.equal(called, false);
});

test("resolve captures only after no direct stream is found", async () => {
  const html = readFileSync(join(root, "test/fixtures/event-embed.html"), "utf8");
  const calls = [];
  globalThis.kino = {
    fetch: async () => ({
      ok: true,
      status: 200,
      url: "https://www.rbtvplus18.beer/es/football/game.html",
      headers: { "content-type": "text/html; charset=utf-8" },
      text: () => html,
    }),
    browser: {
      capture: async (url) => {
        calls.push(url);
        return {
          media: [{
            url: "https://edge.example/live.m3u8",
            mime: "application/vnd.apple.mpegurl",
            headers: { Referer: url, Cookie: "session=ok" },
          }],
          subtitles: [],
          finalUrl: url,
        };
      },
    },
    error: (code, message) => Object.assign(
      new Error(message),
      { code, userMessage: message },
    ),
  };
  const stream = await plugin.resolve(
    "event:https://www.rbtvplus18.beer/es/football/game.html",
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "https://www.rbtvplus18.beer/es/football/game.html");
  assert.equal(stream.headers.Cookie, "session=ok");
});

test("browser_unavailable fails clearly after one bounded capture", async () => {
  const html = readFileSync(join(root, "test/fixtures/event-embed.html"), "utf8");
  let attempts = 0;
  globalThis.kino = {
    fetch: async () => ({
      ok: true,
      status: 200,
      url: "https://www.rbtvplus18.beer/es/football/game.html",
      headers: { "content-type": "text/html; charset=utf-8" },
      text: () => html,
    }),
    browser: {
      capture: async () => {
        attempts += 1;
        throw Object.assign(new Error("no webview"), { code: "browser_unavailable" });
      },
    },
    error: (code, message) => Object.assign(
      new Error(message),
      { code, userMessage: message },
    ),
  };
  await assert.rejects(
    plugin.resolve("event:https://www.rbtvplus18.beer/es/football/game.html"),
    (error) => error.code === "unavailable" && /WebView/.test(error.userMessage),
  );
  assert.equal(attempts, 1);
});
