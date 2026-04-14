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
import { Response } from 'express';
import * as fs from 'fs';
import { FilesService } from './files.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

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
      throw new BadRequestException('Faqat .tif/.tiff fayllarni yuklash mumkin');
    }
    return this.service.upload(file, dto.categoryId, dto.year);
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

    res.setHeader('Content-Type', 'image/tiff');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${info.filename}"`,
    );
    fs.createReadStream(info.path).pipe(res);
  }

  /**
   * Stream COG file for Leaflet's georaster layer
   * Supports HTTP Range Requests (COG is optimized for partial reads)
   */
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
    // Express handles Range requests automatically via sendFile
    res.sendFile(info.path);
  }
}
