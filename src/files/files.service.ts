import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { GdalService } from './services/gdal.service';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly uploadDir: string;
  private readonly cogDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gdal: GdalService,
    private readonly config: ConfigService,
  ) {
    this.uploadDir = path.resolve(
      this.config.get<string>('UPLOAD_DIR', './storage/uploads'),
    );
    this.cogDir = path.resolve(
      this.config.get<string>('COG_DIR', './storage/cog'),
    );
  }

  async ensureDirs(): Promise<void> {
    await fs.mkdir(this.uploadDir, { recursive: true });
    await fs.mkdir(this.cogDir, { recursive: true });
  }

  findAll(params?: { categoryId?: number; year?: number }) {
    const where: any = {};
    if (params?.categoryId) where.categoryId = params.categoryId;
    if (params?.year) where.year = params.year;

    return this.prisma.geotiffFile.findMany({
      where,
      include: { category: true },
      orderBy: [{ categoryId: 'asc' }, { year: 'asc' }],
    });
  }

  async findOne(id: number) {
    const file = await this.prisma.geotiffFile.findUnique({
      where: { id },
      include: { category: true },
    });
    if (!file) throw new NotFoundException('Fayl topilmadi');
    return file;
  }

  async upload(
    file: Express.Multer.File,
    categoryId: number,
    year: number,
  ) {
    await this.ensureDirs();

    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
    });
    if (!category) throw new BadRequestException('Kategoriya topilmadi');

    const existing = await this.prisma.geotiffFile.findUnique({
      where: { categoryId_year: { categoryId, year } },
    });
    if (existing) {
      throw new BadRequestException(
        `Bu kategoriya va yil uchun fayl allaqachon mavjud. Avval mavjudini o'chiring.`,
      );
    }

    const baseName = `${category.slug}_${year}_${Date.now()}`;
    const originalPath = path.join(this.uploadDir, `${baseName}.tif`);
    const cogPath = path.join(this.cogDir, `${baseName}_cog.tif`);

    // Save uploaded file
    await fs.writeFile(originalPath, file.buffer);

    // Convert to COG
    try {
      await this.gdal.toCog(originalPath, cogPath);
    } catch (err) {
      await fs.unlink(originalPath).catch(() => {});
      throw err;
    }

    // Read GeoTIFF info
    let info;
    try {
      info = await this.gdal.getInfo(cogPath);
    } catch (err) {
      this.logger.warn(`Failed to read info: ${(err as Error).message}`);
    }

    const record = await this.prisma.geotiffFile.create({
      data: {
        categoryId,
        year,
        filename: file.originalname,
        cogPath,
        originalPath,
        fileSize: BigInt(file.size),
        width: info?.width,
        height: info?.height,
        minX: info?.bounds.minX,
        minY: info?.bounds.minY,
        maxX: info?.bounds.maxX,
        maxY: info?.bounds.maxY,
      },
      include: { category: true },
    });

    return record;
  }

  async remove(id: number) {
    const file = await this.findOne(id);
    try {
      await fs.unlink(file.cogPath).catch(() => {});
      await fs.unlink(file.originalPath).catch(() => {});
    } catch (err) {
      this.logger.warn(`Failed to delete physical files: ${(err as Error).message}`);
    }
    await this.prisma.geotiffFile.delete({ where: { id } });
    return { success: true };
  }

  async getOriginalPath(id: number): Promise<{ path: string; filename: string }> {
    const file = await this.findOne(id);
    return { path: file.originalPath, filename: file.filename };
  }

  async getCogPath(id: number): Promise<{ path: string; filename: string }> {
    const file = await this.findOne(id);
    return {
      path: file.cogPath,
      filename: `${file.category.slug}_${file.year}_cog.tif`,
    };
  }
}
