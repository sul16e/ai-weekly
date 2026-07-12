# AI Weekly — 주간 AI·IT 트렌드 대시보드

유튜브 위클리 AI 뉴스 방송용 자동 수집 대시보드.

## 사용법 (일요일 루틴)

1. 브라우저에서 대시보드 열기: `npm run serve` → http://localhost:4173
2. TOP 10 훑어보고 링크 눌러 내용 확인
3. `npm run brief` → `briefings/오늘날짜.md` 대본 초안 생성, 멘트 메모 채우기
4. **B 키**로 방송 모드 진입 → 화면 녹화 시작 → ←/→ 키로 뉴스 넘기며 녹음
5. 녹화본 그대로 업로드

## 자동화 (이미 설정됨)

- **매시간 자동 수집**: macOS launchd (`com.aiweekly.update`)가 1시간마다 `fetch.mjs` 실행
  - 로그: `logs/update.log`
  - 끄기: `launchctl bootout gui/$(id -u)/com.aiweekly.update`
  - 켜기: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.aiweekly.update.plist`
- **대시보드 자동 갱신**: 열어두면 10분마다 최신 데이터 리로드

## 수집 소스

| 소스 | 유형 | 신호 |
|---|---|---|
| Hacker News | 해외 커뮤니티 | 포인트 100+ (지난 7일) |
| Reddit (r/LocalLLaMA, r/singularity, r/MachineLearning) | AI 커뮤니티 | 주간 top 순위 |
| HuggingFace Daily Papers | 논문 | upvote |
| OpenAI / Google AI 블로그 | 공식 발표 | — |
| TechCrunch AI, The Verge, Ars Technica | 해외 미디어 | AI/IT 키워드 필터 |
| GeekNews(hada.io), AI타임스 | 국내 | — |

**스코어** = 엔게이지먼트(log 스케일) × 최신성 감쇠 + AI 가중치.
24시간 내 + 엔게이지먼트 150+ 이면 🔥 NOW 표시.

## 명령어

```bash
npm run update   # 지금 즉시 수집
npm run serve    # 대시보드 서버 (localhost:4173)
npm run brief    # 방송 대본 초안 생성
```

## 소스 추가/수정

`fetch.mjs`의 `RSS_FEEDS` 배열에 한 줄 추가하면 끝.
