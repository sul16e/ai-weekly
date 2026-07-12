#!/usr/bin/env node
/**
 * AI Weekly — TTS 리허설: 완성 대본을 macOS 음성으로 합성해 실제 방송 길이 측정
 * npm run rehearse → briefings/YYYY-MM-DD-rehearsal.aiff + 길이 리포트
 */
import { readFileSync, mkdirSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const script = JSON.parse(readFileSync(join(ROOT, "public", "script.json"), "utf8"));

// 한국어 음성 선택 (Yuna 우선, 없으면 첫 ko_KR)
let voice = null;
try {
  const list = execSync("say -v '?'", { encoding: "utf8" }).split("\n").filter((l) => l.includes("ko_KR"));
  voice = (list.find((l) => l.startsWith("Yuna")) || list[0])?.split(/\s{2,}/)[0]?.trim() || null;
} catch {}
if (!voice) { console.error("한국어 TTS 음성 없음 — 시스템 설정 > 손쉬운 사용 > 음성 콘텐츠에서 추가"); process.exit(1); }

const fullText = [script.intro, ...script.items.map((it) => it.para), script.outro].join("\n\n");
mkdirSync(join(ROOT, "briefings"), { recursive: true });
const out = join(ROOT, "briefings", `${script.date}-rehearsal.aiff`);

console.error(`음성 합성 중 (${voice}, ${fullText.length}자)...`);
execFileSync("say", ["-v", voice, "-o", out, fullText], { timeout: 600000 });

const info = execSync(`afinfo "${out}"`, { encoding: "utf8" });
const dur = parseFloat(info.match(/estimated duration:\s*([\d.]+)/)?.[1] || "0");
const min = Math.floor(dur / 60), sec = Math.round(dur % 60);

console.log(`실측 낭독 길이: ${min}분 ${sec}초 (TTS 기준 — 사람은 보통 5~15% 느림)`);
console.log(`대본 추정치: ${Math.floor(script.durationSec / 60)}분 ${script.durationSec % 60}초`);
console.log(`리허설 오디오: briefings/${script.date}-rehearsal.aiff (들어보기: afplay 명령 또는 더블클릭)`);
if (dur > 12 * 60) console.log("⚠ 12분 초과 — 대본 축약 고려");
