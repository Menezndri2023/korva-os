#!/usr/bin/env bash
#
# Tells Bing (and the other IndexNow engines: Yandex, Seznam, Naver) about every public page of
# KORVA and of the businesses' sites, read from the two sitemaps. Bing's index is what ChatGPT
# search and Copilot answer from, so this is how a new business site reaches them quickly.
#
#   ~/ops/indexnow.sh                  submit both sitemaps now
#   ~/ops/indexnow.sh --install-cron   and every night at 04:41 (idempotent)
#
# Runs on the server (bash 4+ and curl; macOS bash 3 lacks mapfile); needs no secret: the key is public and
# each host serves it at /indexnow.txt (packages/types/src/seo.ts). Submitting an unchanged URL
# again is harmless — engines treat it as a hint, not an order.
#
set -euo pipefail

KEY="${KORVA_INDEXNOW_KEY:-8fd050634d39acd4755fb58da6c03c4b}"
HOSTS=(${KORVA_INDEXNOW_HOSTS:-app.korvasuite.com sites.korvasuite.com})
ENDPOINT="${KORVA_INDEXNOW_ENDPOINT:-https://api.indexnow.org/indexnow}"
# The protocol's own limit per request.
BATCH=10000

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

if [[ "${1:-}" == "--install-cron" ]]; then
  MARKER='# KORVA_INDEXNOW'
  SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  LOG="${KORVA_INDEXNOW_LOG:-$HOME/backups/indexnow.log}"
  mkdir -p "$(dirname "$LOG")"
  EXISTING="$(crontab -l 2>/dev/null || true)"
  {
    printf '%s\n' "$EXISTING" | grep -v -F "$MARKER" | sed '/^$/d' || true
    printf '41 4 * * * %s >> %s 2>&1 %s\n' "$SELF" "$LOG" "$MARKER"
  } | crontab -
  log "installed: $(crontab -l | grep -F "$MARKER")"
  exec "$SELF"
fi

STATUS=0
for host in "${HOSTS[@]}"; do
  # The key file must answer on the host itself, or the engines reject every URL.
  served="$(curl -fsS -m 20 "https://$host/indexnow.txt" || true)"
  if [[ "$served" != "$KEY" ]]; then
    log "FAILED $host: https://$host/indexnow.txt does not serve the key (deployed yet?)"
    STATUS=1
    continue
  fi

  # Only this host's own URLs: IndexNow refuses a batch that mixes hosts.
  mapfile -t urls < <(
    curl -fsS -m 60 "https://$host/sitemap.xml" \
      | grep -oE '<loc>[^<]+</loc>' | sed -E 's#</?loc>##g' \
      | grep -E "^https://$host(/|$)" | sort -u
  )
  if (( ${#urls[@]} == 0 )); then
    log "$host: the sitemap lists no URL, nothing to submit"
    continue
  fi

  for ((start = 0; start < ${#urls[@]}; start += BATCH)); do
    chunk=("${urls[@]:start:BATCH}")
    # Sitemap URLs are already XML-escaped ASCII (slugs and ids); quote-free by construction.
    list="$(printf '"%s",' "${chunk[@]}")"
    body="{\"host\":\"$host\",\"key\":\"$KEY\",\"keyLocation\":\"https://$host/indexnow.txt\",\"urlList\":[${list%,}]}"
    code="$(curl -sS -m 60 -o /dev/null -w '%{http_code}' -X POST "$ENDPOINT" \
      -H 'Content-Type: application/json; charset=utf-8' --data "$body" || echo 000)"
    # 200 = received, 202 = received and the key is still being checked (first submission).
    if [[ "$code" == 200 || "$code" == 202 ]]; then
      log "$host: submitted ${#chunk[@]} URLs (HTTP $code)"
    else
      log "FAILED $host: IndexNow answered HTTP $code for ${#chunk[@]} URLs"
      STATUS=1
    fi
  done
done
exit "$STATUS"
