import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
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
    const where: Record<string, unknown> = {};
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

  /**
   * Multer disk storage'dan kelgan fayl bilan ishlash.
   * file.path — disk'dagi vaqtinchalik joy.
   */
  async uploadFromDisk(
    file: Express.Multer.File,
    categoryId: number,
    year: number,
  ) {
    await this.ensureDirs();

    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
    });
    if (!category) {
      await fs.unlink(file.path).catch(() => {});
      throw new BadRequestException('Kategoriya topilmadi');
    }

    const existing = await this.prisma.geotiffFile.findUnique({
      where: { categoryId_year: { categoryId, year } },
    });
    if (existing) {
      await fs.unlink(file.path).catch(() => {});
      throw new BadRequestException(
        `Bu kategoriya va yil uchun fayl allaqachon mavjud (ID: ${existing.id}). Avval mavjudini o'chiring.`,
      );
    }

    const baseName = `${category.slug}_${year}_${Date.now()}`;
    const originalPath = path.join(this.uploadDir, `${baseName}.tif`);
    const cogPath = path.join(this.cogDir, `${baseName}_cog.tif`);

    // Multer yozgan faylni to'g'ri joyga ko'chirish
    if (file.path !== originalPath) {
      await fs.rename(file.path, originalPath).catch(async () => {
        // rename xatolik bersa (boshqa disk bo'lishi mumkin) — copy + delete
        await fs.copyFile(file.path, originalPath);
        await fs.unlink(file.path).catch(() => {});
      });
    }

    const fileSize = (await fs.stat(originalPath)).size;

    // COG konvertatsiya
    try {
      this.logger.log(`COG konvertatsiya boshlanmoqda: ${originalPath} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
      await this.gdal.toCog(originalPath, cogPath);
    } catch (err) {
      this.logger.error(`COG konvertatsiya xatolik: ${(err as Error).message}`);
      await fs.unlink(originalPath).catch(() => {});
      throw new BadRequestException(
        `GeoTIFF faylni COG formatiga o'girib bo'lmadi: ${(err as Error).message}`,
      );
    }

    // GeoTIFF ma'lumotlarini o'qish
    let info;
    try {
      info = await this.gdal.getInfo(cogPath);
    } catch (err) {
      this.logger.warn(`GeoTIFF info o'qib bo'lmadi: ${(err as Error).message}`);
    }

    const record = await this.prisma.geotiffFile.create({
      data: {
        categoryId,
        year,
        filename: file.originalname,
        cogPath,
        originalPath,
        fileSize: BigInt(fileSize),
        width: info?.width,
        height: info?.height,
        minX: info?.bounds.minX,
        minY: info?.bounds.minY,
        maxX: info?.bounds.maxX,
        maxY: info?.bounds.maxY,
      },
      include: { category: true },
    });

    this.logger.log(`Fayl muvaffaqiyatli yuklandi: ${file.originalname} → COG (ID: ${record.id})`);
    return this.serializeFile(record);
  }

  async update(
    id: number,
    dto: { categoryId?: number; year?: number },
  ) {
    const existing = await this.findOne(id);
    const nextCategoryId = dto.categoryId ?? existing.categoryId;
    const nextYear = dto.year ?? existing.year;

    if (nextCategoryId !== existing.categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: nextCategoryId },
      });
      if (!category) throw new BadRequestException('Kategoriya topilmadi');
      if (category.parentId == null) {
        throw new BadRequestException(
          "Fayl faqat subkategoriyaga bog'lanishi mumkin",
        );
      }
    }

    if (nextCategoryId !== existing.categoryId || nextYear !== existing.year) {
      const clash = await this.prisma.geotiffFile.findUnique({
        where: { categoryId_year: { categoryId: nextCategoryId, year: nextYear } },
      });
      if (clash && clash.id !== id) {
        throw new BadRequestException(
          `Bu kategoriya va yil uchun fayl allaqachon mavjud (ID: ${clash.id})`,
        );
      }
    }

    const updated = await this.prisma.geotiffFile.update({
      where: { id },
      data: {
        categoryId: nextCategoryId,
        year: nextYear,
      },
      include: { category: true },
    });
    return this.serializeFile(updated);
  }

  async remove(id: number) {
    const file = await this.findOne(id);
    try {
      await fs.unlink(file.cogPath).catch(() => {});
      await fs.unlink(file.originalPath).catch(() => {});
    } catch (err) {
      this.logger.warn(`Fayllarni o'chirishda xatolik: ${(err as Error).message}`);
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
      filename: `${file.category!.slug}_${file.year}_cog.tif`,
    };
  }

  /**
   * BigInt → number konvertatsiya (JSON serialization uchun)
   */
  private serializeFile(record: any) {
    return {
      ...record,
      fileSize: Number(record.fileSize),
    };
  }
}
