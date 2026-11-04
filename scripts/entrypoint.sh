#!/bin/sh
set -e

# migrationها با advisory lock اجرا می‌شوند تا app و worker هم‌زمان تداخل نکنند.
node scripts/migrate.js

exec "$@"
