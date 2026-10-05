#!/bin/sh
set -eu
# The injected proxy URL carries an ephemeral authenticator; never print it.
proxy=${HTTPS_PROXY:-${https_proxy:-}}
[ -n "$proxy" ] || { echo 'FAIL: proxy was not injected'; exit 1; }
/tmp/probe/network-probe direct "$1"
(
  unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy NO_PROXY no_proxy
  exec /tmp/probe/network-probe direct "$1"
)
echo 'PASS: direct TCP denied after exec and proxy-variable removal'
curl_probe() {
  /tmp/probe/lib/ld-linux-aarch64.so.1 --library-path /tmp/probe/lib /tmp/probe/curl \
    -q --silent --show-error --proxy "$proxy" --noproxy '' \
    --cacert /tmp/probe/ca.pem --proto '=https' --http1.1 \
    --connect-timeout 8 --max-time 15 --max-filesize 65536 "$@"
}
# No Authorization header, request body, model invocation, redirect or response-body log.
result=$(curl_probe --output /tmp/probe-output/provider \
  --write-out '%{http_connect} %{http_code} %{ssl_verify_result}' \
  https://api.openai.com/v1/models)
[ "$result" = '200 401 0' ] || { echo "STOP: provider response was $result; no acceptance"; exit 1; }
echo 'PASS: api.openai.com TLS verified, CONNECT 200, unauthenticated HTTP 401'
set +e
code=$(curl_probe --output /tmp/probe-output/denied \
  --write-out '%{http_connect}' https://example.org/)
rc=$?
set -e
[ "$rc" -ne 0 ] && [ "$code" = 403 ] || {
  echo "STOP: unlisted-domain refusal inconclusive; curl_rc=$rc connect_status=$code"; exit 1;
}
echo 'PASS: unlisted example.org explicitly denied by proxy with CONNECT 403'
