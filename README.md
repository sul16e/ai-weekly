# AI Weekly — 주간 AI·IT 트렌드 대시보드

유튜브 위클리 AI 뉴스 방송용 자동 수집·번역·대본 파이프라인.

- **웹 (폰에서도)**: https://sul16e.github.io/ai-weekly/
- **로컬**: `npm run serve` → http://localhost:4173

## 일요일 방송 루틴

1. `npm run script` — 완성 대본 생성 (영상 제목·썸네일 문구 후보 포함)
2. 대시보드 하단 "완성 대본" 읽으며 각 뉴스 원문 링크 사실 확인
3. **B 키** → 방송 모드 → 화면 녹화 + `←→`로 넘기며 대본 낭독 (`O` = 원문 열기)
4. 업로드 (제목·썸네일 문구는 대본 상단 후보에서 선택)

## 자동화 구조

```
[GitHub Actions] 매시간: fetch.mjs → GitHub Pages 배포 (맥 꺼져 있어도 동작)
[로컬 launchd]   매시간: update.sh = fetch → enrich(Claude 번역·해설) → git push
                          └ 새 급상승 뉴스는 macOS 알림
```

- 로컬 자동화 제어: `launchctl bootout gui/$(id -u)/com.aiweekly.update` (끄기)
- 로그: `logs/update.log`
- Actions는 번역을 못 만들므로(API 키 없음) 번역은 로컬 맥이 push한 `enrich.json` 사용

## 데이터 파일

| 파일 | 내용 | 생성 |
|---|---|---|
| `public/data.json` | 수집된 뉴스 + 스코어 | fetch.mjs (매시간) |
| `public/enrich.json` | 한글 제목·훅 제목·한줄 결론(tldr)·해설·상세 요약 | enrich.mjs (매시간, 캐시) |
| `public/script.json` | 문장형 완성 대본 + 영상 제목/썸네일 후보 | script.mjs (일요일 수동) |
| `public/archive/` | 주간 스냅샷 (지난주 대비용) | fetch.mjs |

## 수집 소스

Hacker News(포인트 100+) · Reddit 3개 서브 top · HuggingFace Daily Papers · OpenAI/Google AI 블로그 · TechCrunch AI · The Verge · Ars Technica · GeekNews · AI타임스

**스코어** = 엔게이지먼트(log) × 최신성 감쇠 + AI 가중치. TOP 10은 소스당 최대 3개.
**🔥 NOW** = 24h 내 엔게이지먼트 150+ 또는 12h 내 고신뢰 소스 신규 글.

## 명령어

```bash
npm run update   # 수집 + 번역 즉시 실행
npm run serve    # 로컬 대시보드
npm run script   # 문장형 완성 대본 생성 (일요일)
npm run brief    # 요점 브리핑 md 생성
```

소스 추가: `fetch.mjs`의 `RSS_FEEDS` 배열에 한 줄.
