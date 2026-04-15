# Sam-Landshaft Backend

NestJS + Prisma + PostgreSQL backend for the Sam-Landshaft geoportal (Samarqand viloyati landshaft xaritalari).

## Features

- Admin authentication (JWT)
- Categories CRUD
- GeoTIFF upload with automatic COG (Cloud Optimized GeoTIFF) conversion via GDAL
- COG streaming with HTTP Range Requests (for Leaflet + georaster)
- Download endpoints (original GeoTIFF)

## Requirements

- Node.js 22+
- PostgreSQL 16+ (with PostGIS)
- GDAL 3.4+ (for `gdal_translate`, `gdalinfo`)
- FFmpeg (for video generation later)

Install GDAL on macOS: `brew install gdal`
Install GDAL on Ubuntu: `sudo apt install gdal-bin`

## Setup

```bash
# 1. Install deps
npm install

# 2. Start PostgreSQL (from project root)
cd ..
docker compose up -d postgres
cd sam-landshaft-backend

# 3. Env
cp .env.example .env

# 4. Prisma — push schema and seed
npx prisma db push
npm run prisma:seed

# 5. Run dev
npm run start:dev
```

API will be available at http://localhost:3000/api

## Default admin

- Email: `admin@sam-landshaft.uz`
- Password: `ChangeMe123!`

## Endpoints

### Auth
- `POST /api/auth/login` — { email, password } → { accessToken, admin }
- `GET /api/auth/me` — (Bearer token) → current admin

### Categories
- `GET /api/categories` — list
- `GET /api/categories/:id`
- `POST /api/categories` (auth)
- `PATCH /api/categories/:id` (auth)
- `DELETE /api/categories/:id` (auth)

### Files
- `GET /api/files?categoryId=&year=` — list
- `GET /api/files/:id`
- `POST /api/files/upload` (auth, multipart: file, categoryId, year)
- `DELETE /api/files/:id` (auth)
- `GET /api/files/:id/download?format=tiff|cog`
- `GET /api/files/:id/cog` — streams COG with Range support for Leaflet

## Storage layout

```
storage/
├── uploads/   # Original GeoTIFF files (for download)
├── cog/       # Cloud Optimized GeoTIFF (for serving)
└── videos/    # Generated animation videos
```
