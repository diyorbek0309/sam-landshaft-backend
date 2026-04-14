import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface GeotiffInfo {
  width: number;
  height: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  bands: number;
}

@Injectable()
export class GdalService {
  private readonly logger = new Logger(GdalService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Convert input GeoTIFF to Cloud Optimized GeoTIFF (COG)
   */
  async toCog(inputPath: string, outputPath: string): Promise<void> {
    const bin = this.config.get<string>('GDAL_BIN', 'gdal_translate');
    const args = [
      '-of', 'COG',
      '-co', 'COMPRESS=DEFLATE',
      '-co', 'OVERVIEW_RESAMPLING=AVERAGE',
      '-co', 'BLOCKSIZE=512',
      inputPath,
      outputPath,
    ];

    this.logger.log(`Converting ${inputPath} to COG...`);
    try {
      await execFileAsync(bin, args);
      this.logger.log(`COG created: ${outputPath}`);
    } catch (err: any) {
      this.logger.error(`COG conversion failed: ${err.message}`);
      throw new Error(`COG conversion failed: ${err.message}`);
    }
  }

  /**
   * Read basic info about a GeoTIFF using gdalinfo
   */
  async getInfo(path: string): Promise<GeotiffInfo> {
    try {
      const { stdout } = await execFileAsync('gdalinfo', ['-json', path]);
      const info = JSON.parse(stdout);

      const corners = info.cornerCoordinates ?? {};
      const ul = corners.upperLeft ?? [0, 0];
      const lr = corners.lowerRight ?? [0, 0];

      return {
        width: info.size?.[0] ?? 0,
        height: info.size?.[1] ?? 0,
        bounds: {
          minX: Math.min(ul[0], lr[0]),
          minY: Math.min(ul[1], lr[1]),
          maxX: Math.max(ul[0], lr[0]),
          maxY: Math.max(ul[1], lr[1]),
        },
        bands: info.bands?.length ?? 1,
      };
    } catch (err: any) {
      this.logger.error(`gdalinfo failed: ${err.message}`);
      throw new Error(`Failed to read GeoTIFF info: ${err.message}`);
    }
  }
}
