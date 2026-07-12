#!/usr/bin/env node
/**
 * AI Weekly — 문장형 완성 대본 생성기 (일요일 방송 전 실행: npm run script)
 * data.json + enrich.json → public/script.json + briefings/YYYY-MM-DD-script.md
 * 인트로 → 뉴스별 읽기용 문단 → 아웃트로. 유튜브 영상 제목/썸네일 문구 후보 포함.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));

function findClaude() {
  for (const p of ["/opt/homebrew/bin/claude", "/usr/local/bin/claude", `${process.env.HOME}/.local/bin/claude`]) {
    if (existsSync(p)) return p;
  }
  try { return execSync("which claude", { encoding: "utf8" }).trim() || null; } catch { return null; }
}
const claude = findClaude();
if (!claude) { console.error("claude CLI 필요"); process.exit(1); }

const data = JSON.parse(readFileSync(join(ROOT, "public", "data.json"), "utf8"));
const enrichPath = join(ROOT, "public", "enrich.json");
const enrich = existsSync(enrichPath) ? JSON.parse(readFileSync(enrichPath, "utf8")) : {};

// 대시보드 TOP 10과 동일 규칙 (소스당 최대 3개)
const top = [], counts = {};
for (const x of data.items) {
  if ((counts[x.source] || 0) >= 3) continue;
  counts[x.source] = (counts[x.source] || 0) + 1;
  top.push(x);
  if (top.length === 10) break;
}

const payload = top.map((x, i) => {
  const e = enrich[x.title] || {};
  return { rank: i + 1, title: x.title, url: x.url, ko: e.ko, hook: e.hook, tldr: e.tldr, detail: e.detail, bullets: e.bullets, source: x.source, engagement: x.engagement, comments: x.comments };
});

const instruction = `너는 한국의 주간 AI 뉴스 유튜브 채널의 방송 작가다. stdin의 TOP 10 뉴스 데이터로 "그대로 소리내어 읽으면 되는" 완성 대본을 만들어라.

톤: 차분하고 신뢰감 있는 아나운서체. 과장·주관적 단정 금지 (채널 차별점 = 정확성). 사실은 데이터에 있는 것만 사용. 청자는 IT에 관심 있는 일반인이라 전문용어는 한 줄 풀이를 곁들여라.

출력은 순수 JSON 하나만:
{
 "videoTitles": ["유튜브 영상 제목 후보 3개 (한국어, 60자 이내, 이번 주 가장 큰 뉴스 중심)"],
 "thumbnailTexts": ["썸네일 문구 후보 3개 (한국어, 12자 이내, 임팩트)"],
 "intro": "오프닝 멘트 3~4문장 (인사 + 이번 주 하이라이트 예고)",
 "items": [{"rank":1, "para":"해당 뉴스 읽기용 문단 4~7문장 (전환 멘트 포함, detail의 사실 기반)"}],
 "outro": "클로징 멘트 2~3문장 (구독 유도 포함, 짧게)"
}
코드 블록 마커·설명 금지.`;

console.error("대본 생성 중... (1~2분)");
let out;
try {
  out = execFileSync(claude, ["-p", instruction], {
    input: JSON.stringify(payload),
    encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000,
    env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}` },
  });
} catch (e) { console.error(`claude 실행 실패: ${(e.message || "").slice(0, 200)}`); process.exit(1); }

const m = out.match(/\{[\s\S]*\}/);
if (!m) { console.error("응답 JSON 없음"); process.exit(1); }
const script = JSON.parse(m[0]);

const dateStr = new Date().toISOString().slice(0, 10);

// 예상 낭독 길이 (한국어 낭독 ≈ 분당 330자)
const CHARS_PER_MIN = 330;
const secOf = (t) => Math.round(((t || "").length / CHARS_PER_MIN) * 60);
script.items.forEach((it) => { it.sec = secOf(it.para); });
const totalSec = secOf(script.intro) + secOf(script.outro) + script.items.reduce((a, b) => a + b.sec, 0);
const fmtDur = (s) => `${Math.floor(s / 60)}분 ${s % 60}초`;

// 유튜브 설명란 (출처 전체 공개 — 채널 차별점)
const description = `이번 주 AI·IT 핵심 뉴스 TOP 10을 정리했습니다.
모든 출처를 아래에 공개합니다. 자세한 내용은 링크에서 확인하세요.

${payload.map((p) => `${String(p.rank).padStart(2, "0")}. ${p.hook || p.ko || p.title}\n    ${p.url}`).join("\n")}

📊 뉴스 선정 기준: 커뮤니티 반응(Hacker News·Reddit)과 공식 발표를 종합한 자동 수집 + 직접 검증
#AI뉴스 #인공지능 #IT뉴스 #위클리AI #테크뉴스`;

const result = { date: dateStr, generatedAt: Date.now(), durationSec: totalSec, description, top: payload.map((p) => ({ rank: p.rank, title: p.title })), ...script };
writeFileSync(join(ROOT, "public", "script.json"), JSON.stringify(result, null, 1));
mkdirSync(join(ROOT, "briefings"), { recursive: true });
writeFileSync(join(ROOT, "briefings", `${dateStr}-description.txt`), description);

// 마크다운 버전
const md = `# AI Weekly 완성 대본 — ${dateStr}

**예상 방송 길이: ${fmtDur(totalSec)}** (분당 330자 낭독 기준 · 정확한 측정: \`npm run rehearse\`)

## 🎬 영상 제목 후보
${script.videoTitles.map((t, i) => `${i + 1}. ${t}`).join("\n")}

## 🖼 썸네일 문구 후보
${script.thumbnailTexts.map((t, i) => `${i + 1}. ${t}`).join("\n")}

## 📋 영상 설명란 (복사용)
\`\`\`
${description}
\`\`\`

---

## 인트로
${script.intro}

${script.items.map((it) => {
  const p = payload.find((x) => x.rank === it.rank);
  return `## ${it.rank}. ${p?.hook || p?.ko || p?.title} *(≈${fmtDur(it.sec)})*\n${it.para}`;
}).join("\n\n")}

## 아웃트로
${script.outro}

---
*자동 생성 ${new Date().toLocaleString("ko-KR")} — 방송 전 각 뉴스 원문 링크로 사실 확인 필수*
`;
mkdirSync(join(ROOT, "briefings"), { recursive: true });
writeFileSync(join(ROOT, "briefings", `${dateStr}-script.md`), md);
console.error(`완료: public/script.json + briefings/${dateStr}-script.md`);
console.error(`예상 방송 길이: ${fmtDur(totalSec)}`);
