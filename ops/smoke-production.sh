#!/usr/bin/env bash
#
# Checks that production serves what it should, from the outside, in a few seconds. Run it from
# anywhere (your Mac is fine) after every deploy:
#
#   ops/smoke-production.sh            # korvasuite.com, sample shop "freeworld"
#   ops/smoke-production.sh exemple.com ma-boutique
#
# WHY THIS EXISTS. Two production bugs in October 2026 passed every test and every CI job,
# because they were configuration, not code:
#   - every "Voir mon site" link pointed at http://localhost:3001 (a NEXT_PUBLIC_* build arg
#     never passed), and every site declared itself at localhost (canonical, og:url, sitemap);
#   - the primary buttons on the tenant sites lost their background (a Tailwind source missing).
# Owners reported "les sites ne s'affichent pas". These checks look at the deployed result
# itself — the HTML, the headers, the shipped JavaScript — which is where both bugs were visible.
#
# Reads nothing secret and changes nothing. Exit code 0 when every check passes.

set -uo pipefail

DOMAIN="${1:-korvasuite.com}"
SAMPLE_SLUG="${2:-freeworld}"
APP="https://app.${DOMAIN}"
API="https://api.${DOMAIN}/api/v1"
SITES="https://sites.${DOMAIN}"

failures=0
pass() { printf '  \033[32mOK\033[0m   %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; failures=$((failures + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

status() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$1"; }

echo "Production smoke test — ${DOMAIN} (sample shop: ${SAMPLE_SLUG})"

echo "Services"
check "API health answers 200" '[ "$(status "${API}/health")" = 200 ]'
check "Dashboard login page answers 200" '[ "$(status "${APP}/login")" = 200 ]'
check "Landing page answers 200" '[ "$(status "${APP}/")" = 200 ]'

echo "Tenant site"
site_html="$(curl -s --max-time 20 "${SITES}/${SAMPLE_SLUG}")"
site_headers="$(curl -s -D - -o /dev/null --max-time 20 "${SITES}/${SAMPLE_SLUG}")"
check "Sample shop answers 200" '[ "$(status "${SITES}/${SAMPLE_SLUG}")" = 200 ]'
check "Canonical URL is the public address" \
  'grep -q "<link rel=\"canonical\" href=\"${SITES}/${SAMPLE_SLUG}\"" <<<"$site_html"'
check "No localhost anywhere in the page" '! grep -q "localhost" <<<"$site_html"'
check "Dashboard allowed to frame the site (Settings preview)" \
  'grep -i "content-security-policy" <<<"$site_headers" | grep -q "frame-ancestors[^;]*${APP}"'
check "robots.txt points at the public sitemap" \
  'curl -s --max-time 20 "${SITES}/robots.txt" | grep -q "Sitemap: ${SITES}/sitemap.xml"'

echo "Shipped JavaScript"
# The dashboard's links to the sites are inlined at build time — look for them in the bundles.
dashboard_js=""
for chunk in $(curl -s --max-time 20 "${APP}/dashboard" | grep -oE '/_next/static/chunks/[^"]+\.js' | sort -u); do
  dashboard_js+="$(curl -s --max-time 20 "${APP}${chunk}")"
done
check "Dashboard links to ${SITES}" 'grep -q "${SITES}" <<<"$dashboard_js"'
check "Dashboard has no localhost:3001 link" '! grep -q "localhost:3001" <<<"$dashboard_js"'

site_css=""
for sheet in $(grep -oE '/_next/static/[^"]+\.css' <<<"$site_html" | sort -u); do
  site_css+="$(curl -s --max-time 20 "${SITES}${sheet}")"
done
check "Site stylesheet defines the shared button colour" 'grep -q "\.bg-primary{" <<<"$site_css"'

echo "Email DNS"
# Read over DNS-over-HTTPS: works from networks where plain port-53 DNS is blocked.
txt() {
  curl -s --max-time 20 -H 'accept: application/dns-json' \
    "https://cloudflare-dns.com/dns-query?name=$1&type=TXT"
}
check "DMARC record published (_dmarc.${DOMAIN})" 'txt "_dmarc.${DOMAIN}" | grep -q "v=DMARC1"'
check "DKIM key published (resend._domainkey.${DOMAIN})" 'txt "resend._domainkey.${DOMAIN}" | grep -q "p=MI"'
check "SPF for the sending subdomain (send.${DOMAIN})" 'txt "send.${DOMAIN}" | grep -q "v=spf1"'

echo
if [ "$failures" -eq 0 ]; then
  echo "All checks passed."
else
  echo "${failures} check(s) failed."
fi
exit "$failures"
