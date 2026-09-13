#!/usr/bin/env bash
# Allow OnlyOffice Document Server to download files from private IPs
# and align JWT with QuoteGen (.env ONLYOFFICE_JWT_SECRET).
set -euo pipefail
export PATH="/Applications/Docker.app/Contents/Resources/bin:${PATH}"
CONTAINER="${1:-quotegen-cursor-ready-5-onlyoffice-1}"
JWT_SECRET="${ONLYOFFICE_JWT_SECRET:-dev-onlyoffice-secret}"

docker exec "$CONTAINER" bash -lc "
set -e
CFG=/etc/onlyoffice/documentserver/local.json
python3 - <<'PY'
import json, os
path = '/etc/onlyoffice/documentserver/local.json'
secret = os.environ.get('JWT_SECRET', 'dev-onlyoffice-secret')
try:
    with open(path) as f:
        data = json.load(f)
except Exception:
    data = {}
svc = data.setdefault('services', {})
co = svc.setdefault('CoAuthoring', {})
rfa = co.setdefault('request-filtering-agent', {})
rfa['allowPrivateIPAddress'] = True
rfa['allowMetaIPAddress'] = True
sec = co.setdefault('secret', {})
for key in ('browser', 'inbox', 'outbox'):
    sec.setdefault(key, {})['string'] = secret
tok = co.setdefault('token', {})
en = tok.setdefault('enable', {})
en['browser'] = True
req = en.setdefault('request', {})
req['inbox'] = True
req['outbox'] = True
with open(path, 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
print('patched', path, 'allowPrivateIPAddress=true jwt=enabled')
PY
JWT_SECRET='$JWT_SECRET' python3 -c 'import os; print(os.environ.get(\"JWT_SECRET\",\"\"))' >/dev/null
supervisorctl restart ds:docservice ds:converter
"
echo "Done. Re-open the Excel/Word file in QuoteGen Open editor."
