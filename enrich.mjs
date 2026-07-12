#!/usr/bin/env node
/**
 * AI Weekly — 번역 + 방송 해설 + 원문 요약 생성기 (Claude CLI 사용)
 * public/data.json → public/enrich.json 에 { 제목: { ko, hook, tldr, bullets[], detail } } 캐시 누적
 *  - ko: 한국어 제목 번역
 *  - hook: 썸네일식 후킹 제목 (방송 메인 타이틀)
 *  - tldr: 한 문장 핵심 결론
 *  - bullets: 방송 해설 2~3개
 *  - detail: 원문 기반 상세 요약 (4~8문장, 결론 우선)
 * Claude CLI가 없거나 실패하면 조용히 종료 (대시보드는 원문 표시로 폴백)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(ROOT, "public", "enrich.json");
const TOP_TRANSLATE = 80; // 상위 N개: 제목 번역 + tldr
const TOP_DEEP = 20;      // 상위 N개: hook + bullets + 원문 상세 요약

function findClaude() {
  if (process.env.CLAUDE_BIN && existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN;
  for (const p of ["/opt/homebrew/bin/claude", "/usr/local/bin/claude", `${process.env.HOME}/.local/bin/claude`]) {
    if (existsSync(p)) return p;
  }
  try { return execSync("which claude", { encoding: "utf8" }).trim() || null; } catch { return null; }
}

const claude = findClaude();
if (!claude) {
  console.error("claude CLI 없음 — 번역 생략 (설치: npm i -g @anthropic-ai/claude-code)");
  process.exit(0);
}

const data = JSON.parse(readFileSync(join(ROOT, "public", "data.json"), "utf8"));
const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, "utf8")) : {};

// 원문 텍스트 추출 (상세 요약용) — 실패해도 무방
async function fetchArticle(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh) ai-weekly-reader/1.0" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok || !/text\/html|text\/plain/.test(res.headers.get("content-type") || "")) return null;
    const html = (await res.text()).slice(0, 400000);
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 400 ? text.slice(0, 3500) : null; // 너무 짧으면 무의미
  } catch { return null; }
}

const jobs = [];
const deepTargets = [];
data.items.slice(0, TOP_TRANSLATE).forEach((it, i) => {
  const c = cache[it.title] || {};
  const deep = i < TOP_DEEP;
  const needKo = it.lang !== "ko" && !c.ko;
  const needTldr = !c.tldr;
  const needHook = deep && !c.hook;
  const needBullets = deep && !c.bullets;
  const needDetail = deep && !c.detail;
  if (needKo || needTldr || needHook || needBullets || needDetail) {
    const job = { title: it.title, summary: (it.summary || "").slice(0, 300), source: it.source, needKo, needTldr, needHook, needBullets, needDetail };
    jobs.push(job);
    if (needDetail) deepTargets.push({ job, url: it.url });
  }
});

if (!jobs.length) {
  console.error("번역/해설 최신 상태 — 할 일 없음");
  process.exit(0);
}

// 상세 요약 대상은 원문 텍스트 동시 수집
console.error(`원문 수집: ${deepTargets.length}건...`);
await Promise.all(deepTargets.map(async (t) => {
  const article = await fetchArticle(t.url);
  if (article) t.job.article = article;
}));
console.error(`  원문 확보 ${deepTargets.filter((t) => t.job.article).length}/${deepTargets.length}건`);

const instruction = `너는 한국의 주간 AI 뉴스 유튜브 방송의 작가다. stdin으로 주어지는 JSON 배열의 뉴스 항목들을 처리하라.

각 항목의 need* 플래그가 true인 필드만 생성:
- "ko" (needKo): 자연스러운 한국어 제목 번역. 직역 말고 한국 뉴스 헤드라인 스타일, 고유명사는 원문 유지.
- "hook" (needHook): 유튜브 썸네일식 후킹 제목. 한국어 25자 이내, 호기심 자극하되 사실 왜곡·과장 금지 (이 채널의 차별점은 정확성이다). 예: "애플이 OpenAI를 고소한 진짜 이유".
- "tldr" (needTldr): 한 문장 핵심 결론 (한국어). 이 뉴스가 결국 무슨 얘기인지 한 줄로.
- "bullets" (needBullets): 방송에서 말할 해설 2~3개 (한국어, 각 한 문장). article/summary의 사실에 근거하고, 근거 없으면 "~로 보임" 명시, 확인 필요한 주장엔 "방송 전 체크:" 접두어.
- "detail" (needDetail): 상세 요약 4~8문장 (한국어). 첫 문장은 결론. 이어서 주요 내용·수치·맥락·반응. article이 있으면 그것을 근거로, 없으면 summary와 제목에서 확실한 것만 쓰고 추측은 명시.

출력은 반드시 순수 JSON 배열만: [{"title":"<원문 제목 그대로>", ...생성한 필드들}]
설명 문장, 코드 블록 마커 금지. title은 입력의 title과 정확히 동일해야 한다.`;

console.error(`Claude에 ${jobs.length}건 요청 중...`);
let out;
try {
  out = execFileSync(claude, ["-p", instruction], {
    input: JSON.stringify(jobs),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 900000,
    env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}` },
  });
} catch (e) {
  console.error(`claude 실행 실패: ${(e.message || "").slice(0, 200)}`);
  process.exit(0);
}

const m = out.match(/\[[\s\S]*\]/);
if (!m) {
  console.error("응답에서 JSON을 못 찾음 — 생략");
  process.exit(0);
}

let results;
try { results = JSON.parse(m[0]); } catch { console.error("JSON 파싱 실패 — 생략"); process.exit(0); }

let updated = 0;
for (const r of results) {
  if (!r?.title) continue;
  const prev = cache[r.title] || {};
  const merged = { ...prev };
  for (const f of ["ko", "hook", "tldr", "detail"]) if (r[f]) merged[f] = r[f];
  if (r.bullets?.length) merged.bullets = r.bullets;
  cache[r.title] = merged;
  updated++;
}

// 캐시가 충분히 커졌을 때만 오래된 항목 정리 (일시적 수집 실패로 번역이 날아가는 것 방지)
if (Object.keys(cache).length > 500) {
  const live = new Set(data.items.map((x) => x.title));
  for (const k of Object.keys(cache)) if (!live.has(k)) delete cache[k];
}

writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
console.error(`완료: ${updated}건 갱신, 캐시 ${Object.keys(cache).length}건`);
