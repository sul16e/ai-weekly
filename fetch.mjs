#!/usr/bin/env node
/**
 * AI Weekly — 뉴스/트렌드 수집기
 * 소스: Hacker News(Algolia), Reddit, HuggingFace Daily Papers, RSS(해외/국내)
 * 결과: public/data.json
 */

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "public", "data.json");
const UA = "ai-weekly-dashboard/1.0 (personal news aggregator)";

const WEEK_MS = 7 * 24 * 3600 * 1000;
const now = Date.now();
const weekAgoSec = Math.floor((now - WEEK_MS) / 1000);

// ---------- 유틸 ----------

async function getJSON(url, headers = {}) {
  const res = await fetch(url, { headers: { "User-Agent": UA, ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .trim();
}

function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// 아주 단순한 RSS/Atom 파서 (외부 의존성 없이)
function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/g) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/g) || [];
  for (const b of blocks) {
    const pick = (tag) => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return m ? decodeEntities(m[1]) : "";
    };
    let link = pick("link");
    if (!link || /^</.test(link)) {
      const m = b.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = m ? m[1] : "";
    }
    const title = stripTags(pick("title"));
    const desc = stripTags(pick("description") || pick("summary") || pick("content")).slice(0, 300);
    const dateStr = pick("pubDate") || pick("published") || pick("updated") || pick("dc:date");
    const ts = dateStr ? Date.parse(dateStr) : NaN;
    if (title && link) items.push({ title, url: link.trim(), summary: desc, publishedAt: Number.isFinite(ts) ? ts : null });
  }
  return items;
}

const AI_RE = /\b(AI|A\.I\.|LLM|GPT|OpenAI|Anthropic|Claude|Gemini|DeepSeek|Mistral|Llama|Qwen|Grok|xAI|Hugging\s?Face|diffusion|transformer|neural|AGI|chatbot|copilot|agent|inference|모델|인공지능|생성형)\b/i;

// HN용 넓은 IT 필터 — AI가 아니어도 중요한 테크 이슈는 통과
const TECH_RE = /\b(chip|semiconductor|NVIDIA|Intel|AMD|TSMC|Apple|Google|Meta|Microsoft|Amazon|Samsung|startup|software|hardware|app|API|cloud|data\s?center|server|security|breach|hack|encryption|privacy|quantum|robot|browser|Linux|Windows|macOS|iOS|Android|open[\s-]?source|programming|developer|database|SQL|JavaScript|Python|Rust|compiler|kernel|GPU|CPU|internet|web|crypto|blockchain|SaaS|IPO|acquisition|antitrust|regulation|EU|FTC)\b/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 소스별 수집 ----------

async function fetchHackerNews() {
  const items = [];
  for (let page = 0; page < 3; page++) {
    const url = `https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=points%3E100,created_at_i%3E${weekAgoSec}&hitsPerPage=100&page=${page}`;
    const data = await getJSON(url);
    for (const h of data.hits) {
      if (!AI_RE.test(h.title) && !TECH_RE.test(h.title)) continue; // 비-IT 일반 뉴스 제외
      items.push({
        title: h.title,
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        commentsUrl: `https://news.ycombinator.com/item?id=${h.objectID}`,
        source: "Hacker News",
        sourceType: "community",
        lang: "en",
        engagement: h.points,
        comments: h.num_comments,
        publishedAt: h.created_at_i * 1000,
        isAI: AI_RE.test(h.title),
      });
    }
    if (data.hits.length < 100) break;
  }
  return items;
}

async function fetchReddit() {
  // JSON API는 스크립트 차단(403), RSS는 허용. top 정렬이므로 순위를 인기도 근사치로 사용.
  const subs = [
    ["LocalLLaMA", 34],
    ["singularity", 28],
    ["MachineLearning", 30],
  ];
  const items = [];
  for (const [sub, topWeight] of subs) {
    try {
      let xml;
      for (let attempt = 0; ; attempt++) {
        try {
          xml = await getText(`https://www.reddit.com/r/${sub}/top.rss?t=week&limit=15`);
          break;
        } catch (e) {
          if (attempt >= 2 || !e.message.startsWith("429")) throw e;
          await sleep(6000);
        }
      }
      parseFeed(xml).forEach((it, rank) => {
        items.push({
          title: it.title,
          url: it.url,
          source: `r/${sub}`,
          sourceType: "community",
          lang: "en",
          engagement: null,
          baseWeight: Math.max(12, topWeight - rank * 1.6),
          publishedAt: it.publishedAt,
          isAI: true,
        });
      });
      console.error(`  ✓ r/${sub}`);
    } catch (e) {
      console.error(`  ! r/${sub} 실패: ${e.message}`);
    }
    await sleep(8000);
  }
  return items;
}

async function fetchHuggingFacePapers() {
  const data = await getJSON("https://huggingface.co/api/daily_papers?limit=50");
  return data
    .filter((d) => d.paper)
    .map((d) => ({
      title: d.paper.title.replace(/\s+/g, " ").trim(),
      url: `https://huggingface.co/papers/${d.paper.id}`,
      source: "HF Daily Papers",
      sourceType: "paper",
      lang: "en",
      engagement: d.paper.upvotes ?? 0,
      summary: (d.paper.summary || "").replace(/\s+/g, " ").slice(0, 300),
      publishedAt: Date.parse(d.publishedAt || d.paper.publishedAt) || null,
      isAI: true,
    }));
}

const RSS_FEEDS = [
  // [이름, url, sourceType, lang, 가중치, 키워드필터 스킵 여부(전부 수록)]
  ["OpenAI Blog", "https://openai.com/news/rss.xml", "official", "en", 50, true],
  ["Google AI Blog", "https://blog.google/technology/ai/rss/", "official", "en", 45, true],
  ["TechCrunch AI", "https://techcrunch.com/category/artificial-intelligence/feed/", "media", "en", 32, true],
  ["The Verge", "https://www.theverge.com/rss/index.xml", "media", "en", 26, false],
  ["Ars Technica", "https://feeds.arstechnica.com/arstechnica/index", "media", "en", 26, false],
  ["GeekNews", "https://news.hada.io/rss/news", "community", "ko", 42, true], // 큐레이션 사이트 → 전부 IT 관련
  ["AI타임스", "https://www.aitimes.com/rss/allArticle.xml", "media", "ko", 26, true],
];

async function fetchRSS() {
  const items = [];
  for (const [name, url, sourceType, lang, weight, aiOnly] of RSS_FEEDS) {
    try {
      const xml = await getText(url);
      for (const it of parseFeed(xml)) {
        if (it.publishedAt && now - it.publishedAt > WEEK_MS) continue;
        const isAI = AI_RE.test(it.title) || AI_RE.test(it.summary || "");
        // 종합 피드(Verge/Ars)는 AI 또는 IT 키워드가 있어야 수록. 한국어 제목은 \b 매치가 안 되므로 keepAll 피드는 필터 없음
        if (!aiOnly && !isAI && !TECH_RE.test(it.title) && !TECH_RE.test(it.summary || "")) continue;
        items.push({ ...it, source: name, sourceType, lang, engagement: null, baseWeight: weight, isAI });
      }
      console.error(`  ✓ ${name}`);
    } catch (e) {
      console.error(`  ! ${name} 실패: ${e.message}`);
    }
  }
  return items;
}

// ---------- 스코어링 ----------

function score(item) {
  const ageH = item.publishedAt ? (now - item.publishedAt) / 3600000 : 84;
  const recency = Math.exp(-ageH / 60); // 60시간 반감 느낌의 감쇠
  const eng = item.engagement != null ? Math.log10(1 + item.engagement) * 22 : (item.baseWeight ?? 15);
  const aiBoost = item.isAI ? 8 : 0;
  return Math.round((eng + aiBoost) * (0.35 + 0.65 * recency) * 10) / 10;
}

function dedupe(items) {
  const seen = new Map();
  for (const it of items) {
    const key = it.title.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "").slice(0, 60);
    const prev = seen.get(key);
    if (!prev || (it.engagement ?? 0) > (prev.engagement ?? 0)) seen.set(key, it);
  }
  return [...seen.values()];
}

// ---------- 메인 ----------

console.error("수집 시작...");
const results = await Promise.allSettled([
  fetchHackerNews(),
  fetchReddit(),
  fetchHuggingFacePapers(),
  fetchRSS(),
]);

const names = ["HackerNews", "Reddit", "HF Papers", "RSS"];
let all = [];
results.forEach((r, i) => {
  if (r.status === "fulfilled") {
    console.error(`  ✓ ${names[i]}: ${r.value.length}건`);
    all = all.concat(r.value);
  } else {
    console.error(`  ! ${names[i]} 실패: ${r.reason?.message}`);
  }
});

// hot: 24시간 내 엔게이지먼트 150+ (커뮤니티) 또는 12시간 내 고신뢰 소스(공식 블로그·GeekNews) 신규 글
function isHot(it) {
  if (!it.publishedAt) return false;
  const age = now - it.publishedAt;
  if (age < 24 * 3600000 && (it.engagement ?? 0) > 150) return true;
  if (age < 12 * 3600000 && (it.baseWeight ?? 0) >= 40) return true;
  return false;
}

// 이전 데이터의 hot 목록 (새 hot 항목 macOS 알림용)
let prevHot = new Set();
try {
  prevHot = new Set(JSON.parse(readFileSync(OUT, "utf8")).items.filter((x) => x.hot).map((x) => x.title));
} catch {}

all = dedupe(all)
  .map((it) => ({ ...it, score: score(it), hot: isHot(it) }))
  .sort((a, b) => b.score - a.score)
  .slice(0, 300);

mkdirSync(join(ROOT, "public"), { recursive: true });
writeFileSync(OUT, JSON.stringify({ updatedAt: now, count: all.length, items: all }, null, 1));
console.error(`완료: ${all.length}건 → public/data.json`);

// 주간 아카이브: 그 주의 최신 스냅샷을 계속 덮어씀 → 주가 끝나면 최종본이 남음
function isoWeek(ts) {
  const d = new Date(ts);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
const weekKey = isoWeek(now);
const archiveDir = join(ROOT, "public", "archive");
mkdirSync(archiveDir, { recursive: true });
writeFileSync(join(archiveDir, `${weekKey}.json`), JSON.stringify({ updatedAt: now, week: weekKey, items: all.slice(0, 100) }, null, 1));
const idxPath = join(archiveDir, "index.json");
let weeks = [];
try { weeks = JSON.parse(readFileSync(idxPath, "utf8")); } catch {}
if (!weeks.includes(weekKey)) weeks.push(weekKey);
writeFileSync(idxPath, JSON.stringify(weeks.sort()));
console.error(`아카이브: ${weekKey}.json`);

// 새로 hot이 된 항목 macOS 알림 (최대 3개)
const newHot = all.filter((x) => x.hot && !prevHot.has(x.title)).slice(0, 3);
for (const h of newHot) {
  const msg = h.title.replace(/["\\]/g, "").slice(0, 120);
  try {
    execFileSync("osascript", ["-e", `display notification "${msg}" with title "AI Weekly 🔥 급상승" subtitle "${h.source}"`]);
  } catch {}
}
if (newHot.length) console.error(`알림: 새 급상승 ${newHot.length}건`);
