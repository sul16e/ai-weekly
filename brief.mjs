#!/usr/bin/env node
/**
 * AI Weekly — 일요일 방송용 브리핑(대본 초안) 생성기
 * public/data.json → briefings/YYYY-MM-DD.md
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(ROOT, "public", "data.json"), "utf8"));
const enrichPath = join(ROOT, "public", "enrich.json");
const enrich = existsSync(enrichPath) ? JSON.parse(readFileSync(enrichPath, "utf8")) : {};
const koOf = (x) => (x.lang === "ko" ? null : enrich[x.title]?.ko || null);
const bulletsOf = (x) => enrich[x.title]?.bullets || null;

const today = new Date();
const dateStr = today.toISOString().slice(0, 10);
const top = data.items.slice(0, 10);
const koTop = data.items.filter((x) => x.lang === "ko").slice(0, 5);
const papers = data.items.filter((x) => x.sourceType === "paper").slice(0, 3);

const rel = (ts) => (ts ? Math.round((Date.now() - ts) / 86400000) + "일 전" : "");

const md = `# AI Weekly 브리핑 — ${dateStr}

> 방송 전 체크: 각 항목 링크 열어서 사실 확인 → 멘트 메모 채우기 → 방송 모드(B키) 켜고 녹화

## 이번 주 TOP 10

${top.map((x, i) => {
  const ko = koOf(x);
  const bullets = bulletsOf(x);
  return `### ${i + 1}. ${ko || x.title}
${ko ? `> ${x.title}` : ""}
- 출처: ${x.source}${x.engagement != null ? ` · ▲${x.engagement}` : ""}${x.comments ? ` · 💬${x.comments}` : ""} · ${rel(x.publishedAt)}
- 링크: ${x.url}
${bullets ? bullets.map((b) => `- ${b}`).join("\n") : ""}
- 멘트 메모:
  -
`;
}).join("\n")}

## 국내 소식 픽

${koTop.map((x) => `- [${x.title}](${x.url}) — ${x.source}`).join("\n")}

## 이번 주 주목 논문

${papers.map((x) => `- [${x.title}](${x.url})${x.summary ? `\n  - ${x.summary.slice(0, 150)}…` : ""}`).join("\n")}

---
*자동 생성: ${new Date().toLocaleString("ko-KR")} · 데이터 ${data.count}건 기준*
`;

mkdirSync(join(ROOT, "briefings"), { recursive: true });
const out = join(ROOT, "briefings", `${dateStr}.md`);
writeFileSync(out, md);
console.log(`브리핑 생성 완료: briefings/${dateStr}.md`);
