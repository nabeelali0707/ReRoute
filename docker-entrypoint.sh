#!/bin/sh
# A freshly attached persistent volume is root-owned; hand it to the app user,
# then drop root before starting the server.
set -e
mkdir -p /app/data
chown -R reroute:reroute /app/data 2>/dev/null || echo "warning: could not change ownership of /app/data" >&2
exec setpriv --reuid=reroute --regid=reroute --init-groups python -m backend.serve
