#!/usr/bin/env bash
# Sam-Landshaft — VPS deployment script
# Run on the VPS after git pull

set -e

cd "$(dirname "$0")"

echo ">>> Installing dependencies..."
npm ci --omit=dev || npm install --omit=dev

echo ">>> Installing dev deps for build..."
npm install --include=dev --no-audit --no-fund

echo ">>> Generating Prisma client..."
npx prisma generate

echo ">>> Running migrations..."
npx prisma migrate deploy || npx prisma db push --accept-data-loss

echo ">>> Building app..."
npm run build

echo ">>> Ensuring storage folders exist..."
mkdir -p storage/uploads storage/cog storage/videos logs

echo ">>> Pruning dev deps..."
npm prune --omit=dev

echo ">>> Restarting PM2..."
if pm2 describe sam-landshaft-api > /dev/null 2>&1; then
  pm2 restart sam-landshaft-api --update-env
else
  pm2 start ecosystem.config.js --env production
  pm2 save
fi

echo ">>> Done. Status:"
pm2 status sam-landshaft-api
