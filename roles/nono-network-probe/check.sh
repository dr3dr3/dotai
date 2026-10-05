#!/bin/sh
set -eu
# Never print the proxy URL: it contains nono's ephemeral session authenticator.
proxy=${HTTPS_PROXY:-${https_proxy:-}}
[ -n "$proxy" ] || { echo 'FAIL: proxy was not injected'; exit 1; }
/tmp/probe/network-probe direct "$1"
(
  unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy NO_PROXY no_proxy
  exec /tmp/probe/network-probe direct "$1"
)
echo 'PASS: exec child denied direct TCP after clearing proxy variables'
curl_probe() {
  /tmp/probe/lib/ld-linux-aarch64.so.1 --library-path /tmp/probe/lib /tmp/probe/curl \
    -q --silent --show-error --proxy "$proxy" --noproxy '' \
    --cacert /tmp/probe/ca.pem --proto '=https' --http1.1 \
    --connect-timeout 8 --max-time 15 --max-filesize 65536 "$@"
}
code=$(curl_probe --output /tmp/probe-output/allowed --write-out '%{http_code}' https://example.com/)
[ "$code" = 200 ] || { echo "FAIL: allowed HTTPS status $code"; exit 1; }
grep -q 'Example Domain' /tmp/probe-output/allowed || { echo 'FAIL: unexpected allowed response'; exit 1; }
echo 'PASS: allowlisted HTTPS response 200, certificate verified, expected content'
set +e
code=$(curl_probe --output /tmp/probe-output/denied --write-out '%{http_connect}' https://example.org/)
rc=$?
set -e
[ "$rc" -ne 0 ] && [ "$code" = 403 ] || { echo "FAIL: expected proxy policy 403; rc=$rc connect_status=$code"; exit 1; }
echo 'PASS: unlisted domain CONNECT explicitly denied with 403'
echo 'PASS: network acceptance complete'
