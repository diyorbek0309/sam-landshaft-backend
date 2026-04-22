import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { diskStorage } from 'multer';
import { FilesService } from './files.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// Disk storage — katta fayllar (1 GB+) uchun buffer'dan emas, disk'dan o'qiladi
const upload = diskStorage({
  destination: (_req, _file, cb) => {
    const dir = process.env.UPLOAD_DIR || './storage/uploads';
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

@Controller('files')
export class FilesController {
  constructor(private readonly service: FilesService) {}

  @Get()
  findAll(
    @Query('categoryId') categoryId?: string,
    @Query('year') year?: string,
  ) {
    return this.service.findAll({
      categoryId: categoryId ? Number(categoryId) : undefined,
      year: year ? Number(year) : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: upload,
      limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadFileDto,
  ) {
    if (!file) throw new BadRequestException('Fayl berilmadi');
    const name = file.originalname.toLowerCase();
    if (!name.endsWith('.tif') && !name.endsWith('.tiff')) {
      // Disk'dagi faylni o'chirish
      fs.unlinkSync(file.path);
      throw new BadRequestException('Faqat .tif/.tiff fayllarni yuklash mumkin');
    }
    return this.service.uploadFromDisk(file, dto.categoryId, dto.year);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  @Get(':id/download')
  async download(
    @Param('id', ParseIntPipe) id: number,
    @Query('format') format: 'tiff' | 'cog' = 'tiff',
    @Res() res: Response,
  ) {
    const info =
      format === 'cog'
        ? await this.service.getCogPath(id)
        : await this.service.getOriginalPath(id);

    if (!fs.existsSync(info.path)) {
      throw new BadRequestException('Fayl server-da topilmadi');
    }

    const stat = fs.statSync(info.path);
    res.setHeader('Content-Type', 'image/tiff');
    res.setHeader('Content-Length', stat.size);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${info.filename}"`,
    );
    fs.createReadStream(info.path).pipe(res);
  }

  @Get(':id/cog')
  async streamCog(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const info = await this.service.getCogPath(id);
    if (!fs.existsSync(info.path)) {
      throw new BadRequestException('COG fayl topilmadi');
    }
    res.setHeader('Content-Type', 'image/tiff');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
    res.sendFile(info.path);
  }

  // Georaster probes for a `.ovr` sidecar overview file before every fetch.
  // We don't generate one (COG already has internal overviews), so return an
  // empty 204 instead of a 404 — keeps the browser console clean.
  @Get(':id/cog.ovr')
  cogOvrSidecar(@Res() res: Response) {
    res.status(204).end();
  }
}
