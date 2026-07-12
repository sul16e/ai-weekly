#!/bin/zsh
# AI Weekly 매시간 자동 업데이트 (launchd에서 실행)
# 수집 → 번역/해설 → 번역 결과를 GitHub에 push (Pages가 폰에서도 최신 번역을 보여주도록)
cd "/Users/mac/AI Weekly" || exit 1
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH

node fetch.mjs
node enrich.mjs

if git rev-parse --git-dir >/dev/null 2>&1; then
  git add public/enrich.json public/script.json public/archive 2>/dev/null
  if ! git diff --cached --quiet 2>/dev/null; then
    git commit -q -m "chore: enrich/archive update $(date +%F-%H%M)" || true
    git pull -q --rebase origin main || true
    git push -q origin main || true
  fi
fi
