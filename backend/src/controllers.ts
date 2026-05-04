import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import {
  AdminAccountDto,
  CategoryDto,
  ChangePasswordDto,
  DeptDto,
  GlobalCategoryDto,
  ItemDto,
  LoginDto,
  PageQueryDto,
  StockRecordDto,
  UserStatusDto,
  WxLoginDto,
  WxRegisterDto,
} from './dto';
import { AppService } from './services';
import { AdminGuard, AuthedRequest, MiniGuard, requireActor } from './support';

function uploadStorage() {
  return diskStorage({
    destination: (_req, _file, cb) => {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const dir = join(process.cwd(), 'uploads', month);
      // multer does not create nested folders by default.
      mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      cb(null, `${suffix}${extname(file.originalname) || '.png'}`);
    },
  });
}

@Controller()
export class AppController {
  constructor(private readonly service: AppService) {}

  @Get('health')
  health() {
    return { ok: true };
  }

  @Post('auth/admin-login')
  adminLogin(@Body() dto: LoginDto) {
    return this.service.adminLogin(dto);
  }

  @UseGuards(AdminGuard)
  @Get('auth/admin-me')
  adminMe(@Req() req: AuthedRequest) {
    return this.service.me(requireActor(req));
  }

  @UseGuards(AdminGuard)
  @Patch('auth/password')
  changePassword(@Req() req: AuthedRequest, @Body() dto: ChangePasswordDto) {
    return this.service.changePassword(requireActor(req), dto);
  }

  @Post('auth/wx-login')
  wxLogin(@Body() dto: WxLoginDto) {
    return this.service.wxLogin(dto);
  }

  @Post('auth/wx-register')
  wxRegister(@Body() dto: WxRegisterDto) {
    return this.service.wxRegister(dto);
  }

  @UseGuards(MiniGuard)
  @Get('auth/me')
  me(@Req() req: AuthedRequest) {
    return this.service.me(requireActor(req));
  }

  @UseGuards(AdminGuard)
  @Get('dashboard')
  dashboard(@Req() req: AuthedRequest) {
    return this.service.dashboard(requireActor(req));
  }

  @Get('public/dept')
  publicDept() {
    return this.service.listDept();
  }

  @UseGuards(AdminGuard)
  @Get('dept')
  listDept(@Req() req: AuthedRequest) {
    return this.service.listDept(requireActor(req));
  }

  @UseGuards(AdminGuard)
  @Post('dept')
  createDept(@Req() req: AuthedRequest, @Body() dto: DeptDto) {
    return this.service.createDept(requireActor(req), dto);
  }

  @UseGuards(AdminGuard)
  @Patch('dept/:id')
  updateDept(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: DeptDto) {
    return this.service.updateDept(requireActor(req), Number(id), dto);
  }

  @UseGuards(AdminGuard)
  @Delete('dept/:id')
  deleteDept(@Req() req: AuthedRequest, @Param('id') id: string, @Query('force') force?: string) {
    return this.service.deleteDept(requireActor(req), Number(id), force === 'true');
  }

  @UseGuards(AdminGuard)
  @Get('global-item-category')
  listGlobalCategory() {
    return this.service.listGlobalCategories();
  }

  @UseGuards(AdminGuard)
  @Post('global-item-category')
  createGlobalCategory(@Req() req: AuthedRequest, @Body() dto: GlobalCategoryDto) {
    return this.service.saveGlobalCategory(requireActor(req), undefined, dto);
  }

  @UseGuards(AdminGuard)
  @Patch('global-item-category/:id')
  updateGlobalCategory(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: GlobalCategoryDto) {
    return this.service.saveGlobalCategory(requireActor(req), Number(id), dto);
  }

  @UseGuards(AdminGuard)
  @Delete('global-item-category/:id')
  deleteGlobalCategory(@Req() req: AuthedRequest, @Param('id') id: string, @Query('force') force?: string) {
    return this.service.deleteGlobalCategory(requireActor(req), Number(id), force === 'true');
  }

  @UseGuards(AdminGuard)
  @Get('admin')
  listAdmins(@Req() req: AuthedRequest) {
    return this.service.listAdmins(requireActor(req));
  }

  @UseGuards(AdminGuard)
  @Post('admin')
  createAdmin(@Req() req: AuthedRequest, @Body() dto: AdminAccountDto) {
    return this.service.saveAdmin(requireActor(req), undefined, dto);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/:id')
  updateAdmin(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: AdminAccountDto) {
    return this.service.saveAdmin(requireActor(req), Number(id), dto);
  }

  @UseGuards(AdminGuard)
  @Delete('admin/:id')
  deleteAdmin(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.service.deleteAdmin(requireActor(req), Number(id));
  }

  @UseGuards(AdminGuard)
  @Get('user')
  listUsers(@Req() req: AuthedRequest, @Query() query: PageQueryDto) {
    return this.service.listUsers(requireActor(req), query);
  }

  @UseGuards(AdminGuard)
  @Patch('user/:id/status')
  updateUserStatus(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: UserStatusDto) {
    return this.service.updateUserStatus(requireActor(req), Number(id), dto);
  }

  @UseGuards(AdminGuard)
  @Delete('user/:id')
  deleteUser(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.service.deleteUser(requireActor(req), Number(id));
  }

  @UseGuards(AdminGuard)
  @Post('item-category')
  createCategory(@Req() req: AuthedRequest, @Body() dto: CategoryDto) {
    return this.service.saveCategory(undefined, requireActor(req), dto);
  }

  @UseGuards(AdminGuard)
  @Patch('item-category/:id')
  updateCategory(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: CategoryDto,
  ) {
    return this.service.saveCategory(Number(id), requireActor(req), dto);
  }

  @UseGuards(AdminGuard)
  @Delete('item-category/:id')
  deleteCategory(@Req() req: AuthedRequest, @Param('id') id: string, @Query('force') force?: string) {
    return this.service.deleteCategory(Number(id), requireActor(req), force === 'true');
  }

  @UseGuards(AdminGuard)
  @Get('item-category')
  adminListCategory(@Req() req: AuthedRequest, @Query('deptId') deptId?: string) {
    return this.service.listCategory(requireActor(req), deptId ? Number(deptId) : undefined);
  }

  @UseGuards(MiniGuard)
  @Get('mini/item-category')
  miniListCategory(@Req() req: AuthedRequest) {
    return this.service.listCategory(requireActor(req));
  }

  @UseGuards(AdminGuard)
  @Post('item')
  createItem(@Req() req: AuthedRequest, @Body() dto: ItemDto) {
    return this.service.saveItem(undefined, requireActor(req), dto);
  }

  @UseGuards(AdminGuard)
  @Patch('item/:id')
  updateItem(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: ItemDto) {
    return this.service.saveItem(Number(id), requireActor(req), dto);
  }

  @UseGuards(AdminGuard)
  @Delete('item/:id')
  deleteItem(@Req() req: AuthedRequest, @Param('id') id: string, @Query('force') force?: string) {
    return this.service.deleteItem(Number(id), requireActor(req), force === 'true');
  }

  @UseGuards(AdminGuard)
  @Get('item')
  adminListItems(@Req() req: AuthedRequest, @Query() query: PageQueryDto) {
    return this.service.listItems(requireActor(req), query);
  }

  @UseGuards(MiniGuard)
  @Get('mini/item')
  miniListItems(@Req() req: AuthedRequest, @Query() query: PageQueryDto) {
    return this.service.listItems(requireActor(req), query);
  }

  @UseGuards(MiniGuard)
  @Get('mini/item/:id')
  miniGetItem(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.service.getItem(Number(id), requireActor(req));
  }

  @UseGuards(MiniGuard)
  @Post('stock-record')
  createStockRecord(@Req() req: AuthedRequest, @Body() dto: StockRecordDto) {
    return this.service.createStockRecord(requireActor(req), dto);
  }

  @UseGuards(AdminGuard)
  @Get('stock-record')
  adminListStockRecord(@Req() req: AuthedRequest, @Query() query: PageQueryDto) {
    return this.service.listStockRecords(requireActor(req), query);
  }

  @UseGuards(MiniGuard)
  @Get('mini/stock-record')
  miniListStockRecord(@Req() req: AuthedRequest, @Query() query: PageQueryDto) {
    return this.service.listStockRecords(requireActor(req), query);
  }

  @UseGuards(AdminGuard)
  @Get('export/stock-record')
  async exportStockRecord(
    @Req() req: AuthedRequest,
    @Query() query: PageQueryDto & { format?: string },
    @Res() res: Response,
  ) {
    const file = await this.service.exportRecords(requireActor(req), query);
    const filename = `stock-record-${Date.now()}.${file.ext}`;
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(file.buffer);
  }

  @UseGuards(AdminGuard)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage: uploadStorage() }))
  uploadAdmin(@UploadedFile() file: Express.Multer.File) {
    const relativePath = file.path.replace(join(process.cwd(), 'uploads'), '').replace(/\\/g, '/');
    return { url: `/uploads${relativePath}` };
  }

  @UseGuards(MiniGuard)
  @Post('mini/upload')
  @UseInterceptors(FileInterceptor('file', { storage: uploadStorage() }))
  uploadMini(@UploadedFile() file: Express.Multer.File) {
    const relativePath = file.path.replace(join(process.cwd(), 'uploads'), '').replace(/\\/g, '/');
    return { url: `/uploads${relativePath}` };
  }

  @Post('map/reverse-geocode')
  reverseGeocode() {
    return {
      enabled: false,
      message: '当前版本使用小程序 wx.chooseLocation 返回的位置数据，无需后端逆地理。',
    };
  }
}
