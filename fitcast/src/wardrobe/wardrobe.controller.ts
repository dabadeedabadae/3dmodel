import {
  BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post,
  UploadedFiles, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateWardrobeItemDto, UpdateWardrobeItemDto } from './dto/wardrobe-item.dto';
import { IMAGE_MIME, MAX_IMAGE_BYTES, WARDROBE_UPLOAD_DIR } from './wardrobe.constants';
import { WardrobeService, removeUpload } from './wardrobe.service';
import { parseGarment3d } from './garment3d';
import { parseAttributes } from './attributes';

interface UploadedImage { buffer: Buffer; mimetype: string; size: number }

/** Content check: the bytes must really be JPEG / PNG / WebP, not just claim to be. */
function sniff(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

mkdirSync(WARDROBE_UPLOAD_DIR, { recursive: true });

@Controller('wardrobe')
@UseGuards(JwtAuthGuard)
export class WardrobeController {
  constructor(private readonly wardrobe: WardrobeService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.wardrobe.list(user.id);
  }

  /**
   * multipart: `image` (the photo), optional `texture` + `garment3d` (the photo → 3D package computed on the
   * device, I-51/52). Both or neither; the package is validated strictly, the texture by its bytes.
   */
  @Post()
  @UseInterceptors(FileFieldsInterceptor([{ name: 'image', maxCount: 1 }, { name: 'texture', maxCount: 1 }], {
    limits: { fileSize: MAX_IMAGE_BYTES, files: 2 },
    fileFilter: (_req, file, cb) => cb(null, file.mimetype in IMAGE_MIME),
  }))
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWardrobeItemDto,
    @Body('garment3d') garment3dRaw: string | undefined,
    @Body('attributes') attributesRaw: string | undefined,
    @UploadedFiles() files: { image?: UploadedImage[]; texture?: UploadedImage[] } = {},
  ) {
    const file = files.image?.[0], tex = files.texture?.[0];
    const kind = file ? sniff(file.buffer) : null;
    if (!file || !kind) throw new BadRequestException('Add a photo of the item (JPEG, PNG or WebP, up to 8 MB).');
    if (!!tex !== (garment3dRaw !== undefined)) throw new BadRequestException('The texture and the 3D garment package must be sent together.');
    const garment3d = garment3dRaw !== undefined ? parseGarment3d(garment3dRaw) : null;
    // optional: what the photo says beyond type and colour (I-77)
    const attributes = attributesRaw !== undefined ? parseAttributes(attributesRaw) : null;
    // a package describes one kind of garment: a T-shirt package only for T-shirts, a long-sleeved top package for
    // shirts, hoodies, sweaters and the outer layers that have a 3D figure (blazer, jacket, coat, I-75), a trousers
    // package for trousers and jeans (I-53, I-63)
    const PACKAGE_TYPES: Record<string, string[]> = { tshirt: ['TSHIRT'], top: ['SHIRT', 'HOODIE', 'SWEATER', 'CARDIGAN', 'BLAZER', 'JACKET', 'COAT'], pants: ['PANTS', 'JEANS'] };
    if (garment3d && !PACKAGE_TYPES[garment3d.category]!.includes(dto.type)) {
      throw new BadRequestException('The 3D garment package does not match the item type: a T-shirt photo is only for T-shirts, a long-sleeve top photo is for shirts, hoodies, sweaters, cardigans, blazers, jackets and coats, and a pants photo is for pants and jeans.');
    }
    const texKind = tex ? sniff(tex.buffer) : null;
    if (tex && !texKind) throw new BadRequestException('The texture must be JPEG, PNG or WebP.');
    // Random names, extension from the detected content type — never from the client's filename.
    const saved: string[] = [];
    const save = async (buf: Buffer, k: string) => {
      const name = randomUUID() + IMAGE_MIME[k];
      await writeFile(join(WARDROBE_UPLOAD_DIR, name), buf);
      saved.push(`/uploads/wardrobe/${name}`);
      return `/uploads/wardrobe/${name}`;
    };
    try {
      const imageUrl = await save(file.buffer, kind);
      const textureUrl = tex && texKind ? await save(tex.buffer, texKind) : null;
      return await this.wardrobe.create(user.id, dto, imageUrl, garment3d, textureUrl, attributes);
    } catch (err) {
      for (const u of saved) await removeUpload(u);
      throw err;
    }
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWardrobeItemDto) {
    return this.wardrobe.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.wardrobe.remove(user.id, id);
  }
}
