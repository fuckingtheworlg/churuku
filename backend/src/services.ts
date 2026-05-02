import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import * as bcrypt from 'bcryptjs';
import dayjs from 'dayjs';
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';
import { Workbook } from 'exceljs';
import PDFDocument from 'pdfkit';
import { existsSync } from 'fs';
import { Brackets, Repository } from 'typeorm';
import {
  CategoryDto,
  ChangePasswordDto,
  DeptDto,
  ItemDto,
  LoginDto,
  PageQueryDto,
  StockRecordDto,
  UserStatusDto,
  WxLoginDto,
  WxRegisterDto,
} from './dto';
import {
  AdminEntity,
  DeptEntity,
  ItemCategoryEntity,
  ItemEntity,
  StockRecordEntity,
  StockType,
  UserEntity,
  UserStatus,
} from './entities';
import { JwtActor, requireDeptId, resolveDeptId, takePage } from './support';

@Injectable()
export class AppService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    @InjectRepository(AdminEntity)
    private readonly adminRepo: Repository<AdminEntity>,
    @InjectRepository(DeptEntity)
    private readonly deptRepo: Repository<DeptEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(ItemCategoryEntity)
    private readonly categoryRepo: Repository<ItemCategoryEntity>,
    @InjectRepository(ItemEntity)
    private readonly itemRepo: Repository<ItemEntity>,
    @InjectRepository(StockRecordEntity)
    private readonly recordRepo: Repository<StockRecordEntity>,
  ) {}

  async seedAdmin() {
    const existed = await this.adminRepo.findOneBy({ username: 'admin' });
    if (!existed) {
      const passwordHash = await bcrypt.hash('admin123', 10);
      await this.adminRepo.save(
        this.adminRepo.create({ username: 'admin', passwordHash }),
      );
    }
  }

  async adminLogin(dto: LoginDto) {
    const admin = await this.adminRepo.findOneBy({ username: dto.username });
    if (!admin || !(await bcrypt.compare(dto.password, admin.passwordHash))) {
      throw new UnauthorizedException('账号或密码错误');
    }
    const token = await this.jwt.signAsync({
      role: 'admin',
      id: admin.id,
      username: admin.username,
    } satisfies JwtActor);
    return {
      token,
      user: {
        id: admin.id,
        username: admin.username,
        mustChangePassword: admin.mustChangePassword,
      },
    };
  }

  async changePassword(actor: JwtActor, dto: ChangePasswordDto) {
    const admin = await this.adminRepo.findOneByOrFail({ id: actor.id });
    if (!(await bcrypt.compare(dto.oldPassword, admin.passwordHash))) {
      throw new BadRequestException('原密码错误');
    }
    admin.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    admin.mustChangePassword = false;
    await this.adminRepo.save(admin);
    return true;
  }

  async wxLogin(dto: WxLoginDto) {
    const openid = await this.resolveOpenid(dto.code);
    const user = await this.userRepo.findOne({
      where: { openid },
      relations: ['dept'],
    });
    if (!user) {
      return { status: 'unregistered', openid };
    }
    if (dto.nickname || dto.avatar) {
      user.nickname = dto.nickname || user.nickname;
      user.avatar = dto.avatar || user.avatar;
      await this.userRepo.save(user);
    }
    if (user.status !== UserStatus.Active) {
      return {
        status: user.status,
        user: this.presentUser(user),
      };
    }
    const token = await this.jwt.signAsync({
      role: 'mini',
      id: user.id,
      deptId: user.deptId,
      realName: user.realName,
    } satisfies JwtActor);
    return { status: 'active', token, user: this.presentUser(user) };
  }

  async wxRegister(dto: WxRegisterDto) {
    const openid = await this.resolveOpenid(dto.code);
    const dept = await this.deptRepo.findOneBy({ id: dto.deptId });
    if (!dept) {
      throw new BadRequestException('部门不存在');
    }
    let user = await this.userRepo.findOneBy({ openid });
    if (!user) {
      user = this.userRepo.create({
        openid,
        realName: dto.realName,
        deptId: dto.deptId,
        nickname: dto.nickname,
        avatar: dto.avatar,
        status: UserStatus.Pending,
      });
    } else {
      user.realName = dto.realName;
      user.deptId = dto.deptId;
      user.nickname = dto.nickname || user.nickname;
      user.avatar = dto.avatar || user.avatar;
      user.status = UserStatus.Pending;
    }
    await this.userRepo.save(user);
    return { status: user.status, user: this.presentUser(user) };
  }

  async me(actor: JwtActor) {
    if (actor.role === 'admin') {
      const admin = await this.adminRepo.findOneBy({ id: actor.id });
      return { role: 'admin', user: admin };
    }
    const user = await this.userRepo.findOne({
      where: { id: actor.id },
      relations: ['dept'],
    });
    return { role: 'mini', user: user ? this.presentUser(user) : null };
  }

  async createDept(dto: DeptDto) {
    const existed = await this.deptRepo.findOneBy([{ code: dto.code }, { name: dto.name }]);
    if (existed) {
      throw new BadRequestException('部门名称或编码已存在');
    }
    return this.deptRepo.save(this.deptRepo.create(dto));
  }

  async listDept() {
    return this.deptRepo.find({ order: { id: 'DESC' } });
  }

  async updateDept(id: number, dto: DeptDto) {
    const dept = await this.deptRepo.findOneBy({ id });
    if (!dept) throw new NotFoundException('部门不存在');
    Object.assign(dept, dto);
    return this.deptRepo.save(dept);
  }

  async deleteDept(id: number) {
    const count = await this.itemRepo.countBy({ deptId: id });
    if (count > 0) throw new BadRequestException('部门下仍有物品，不能删除');
    await this.deptRepo.delete(id);
    return true;
  }

  async listUsers(query: PageQueryDto) {
    const { skip, take, page, pageSize } = takePage(query);
    const qb = this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.dept', 'dept')
      .orderBy('user.id', 'DESC')
      .skip(skip)
      .take(take);
    if (query.deptId) qb.andWhere('user.deptId = :deptId', { deptId: query.deptId });
    if (query.status) qb.andWhere('user.status = :status', { status: query.status });
    if (query.keyword) {
      qb.andWhere(
        new Brackets((b) =>
          b
            .where('user.realName LIKE :kw')
            .orWhere('user.nickname LIKE :kw')
            .orWhere('dept.name LIKE :kw'),
        ),
        { kw: `%${query.keyword}%` },
      );
    }
    const [list, total] = await qb.getManyAndCount();
    return { list: list.map((item) => this.presentUser(item)), total, page, pageSize };
  }

  async updateUserStatus(id: number, dto: UserStatusDto) {
    const user = await this.userRepo.findOneBy({ id });
    if (!user) throw new NotFoundException('用户不存在');
    user.status = dto.status;
    user.approvedAt = dto.status === UserStatus.Active ? new Date() : user.approvedAt;
    await this.userRepo.save(user);
    return true;
  }

  async saveCategory(id: number | undefined, actor: JwtActor, dto: CategoryDto) {
    const deptId = requireDeptId(actor, dto.deptId);
    const entity = id
      ? await this.categoryRepo.findOneBy({ id, deptId })
      : this.categoryRepo.create({ deptId });
    if (!entity) throw new NotFoundException('类目不存在');
    entity.name = dto.name;
    entity.sort = dto.sort || 0;
    return this.categoryRepo.save(entity);
  }

  async listCategory(actor: JwtActor, deptId?: number) {
    const scopedDeptId = resolveDeptId(actor, deptId);
    const qb = this.categoryRepo
      .createQueryBuilder('category')
      .leftJoinAndSelect('category.dept', 'dept')
      .orderBy('category.sort', 'ASC')
      .addOrderBy('category.id', 'DESC');
    if (scopedDeptId) qb.where('category.deptId = :deptId', { deptId: scopedDeptId });
    return qb.getMany();
  }

  async deleteCategory(id: number, actor: JwtActor) {
    const category = await this.categoryRepo.findOneBy({ id });
    if (!category) throw new NotFoundException('类目不存在');
    if (actor.role === 'mini' && category.deptId !== actor.deptId) {
      throw new UnauthorizedException('无权操作该类目');
    }
    const count = await this.itemRepo.countBy({ categoryId: id });
    if (count > 0) throw new BadRequestException('类目下仍有物品，不能删除');
    await this.categoryRepo.delete(id);
    return true;
  }

  async saveItem(id: number | undefined, actor: JwtActor, dto: ItemDto) {
    const deptId = requireDeptId(actor, dto.deptId);
    const item = id
      ? await this.itemRepo.findOneBy({ id, deptId })
      : this.itemRepo.create({ deptId, quantity: 0 });
    if (!item) throw new NotFoundException('物品不存在');
    Object.assign(item, {
      categoryId: dto.categoryId,
      name: dto.name,
      spec: dto.spec,
      unit: dto.unit || '件',
      location: dto.location,
      note: dto.note,
      image: dto.image,
    });
    return this.itemRepo.save(item);
  }

  async listItems(actor: JwtActor, query: PageQueryDto) {
    const { skip, take, page, pageSize } = takePage(query);
    const deptId = resolveDeptId(actor, query.deptId);
    const qb = this.itemRepo
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.dept', 'dept')
      .leftJoinAndSelect('item.category', 'category')
      .orderBy('item.id', 'DESC')
      .skip(skip)
      .take(take);
    if (deptId) qb.andWhere('item.deptId = :deptId', { deptId });
    if (query.categoryId) qb.andWhere('item.categoryId = :categoryId', { categoryId: query.categoryId });
    if (query.keyword) {
      qb.andWhere(
        new Brackets((b) =>
          b
            .where('item.name LIKE :kw')
            .orWhere('item.spec LIKE :kw')
            .orWhere('item.location LIKE :kw'),
        ),
        { kw: `%${query.keyword}%` },
      );
    }
    const [list, total] = await qb.getManyAndCount();
    return { list, total, page, pageSize };
  }

  async getItem(id: number, actor: JwtActor) {
    const item = await this.itemRepo.findOne({
      where: { id },
      relations: ['dept', 'category'],
    });
    if (!item) throw new NotFoundException('物品不存在');
    if (actor.role === 'mini' && item.deptId !== actor.deptId) {
      throw new UnauthorizedException('无权查看该物品');
    }
    return item;
  }

  async deleteItem(id: number, actor: JwtActor) {
    const item = await this.getItem(id, actor);
    const count = await this.recordRepo.countBy({ itemId: item.id });
    if (count > 0) throw new BadRequestException('已有出入库记录，不能删除');
    await this.itemRepo.delete(id);
    return true;
  }

  async createStockRecord(actor: JwtActor, dto: StockRecordDto) {
    const item = await this.itemRepo.findOneBy({ id: dto.itemId });
    if (!item) throw new NotFoundException('物品不存在');
    if (actor.role === 'mini' && item.deptId !== actor.deptId) {
      throw new UnauthorizedException('无权操作该物品');
    }
    if (dto.type === StockType.Out && item.quantity < dto.quantity) {
      throw new BadRequestException('库存不足');
    }
    return this.itemRepo.manager.transaction(async (manager) => {
      item.quantity += dto.type === StockType.In ? dto.quantity : -dto.quantity;
      await manager.save(ItemEntity, item);
      const record = manager.create(StockRecordEntity, {
        deptId: item.deptId,
        itemId: item.id,
        type: dto.type,
        quantity: dto.quantity,
        operatorUserId: actor.role === 'mini' ? actor.id : undefined,
        operatorName: actor.realName || actor.username || '管理员',
        latitude: dto.latitude === undefined ? undefined : String(dto.latitude),
        longitude: dto.longitude === undefined ? undefined : String(dto.longitude),
        address: dto.address,
        poiName: dto.poiName,
        photos: dto.photos || [],
        signatureUrl: dto.signatureUrl,
        occurredAt: new Date(dto.occurredAt),
        note: dto.note,
      });
      return manager.save(StockRecordEntity, record);
    });
  }

  async listStockRecords(actor: JwtActor, query: PageQueryDto) {
    const { skip, take, page, pageSize } = takePage(query);
    const deptId = resolveDeptId(actor, query.deptId);
    const qb = this.recordRepo
      .createQueryBuilder('record')
      .leftJoinAndSelect('record.dept', 'dept')
      .leftJoinAndSelect('record.item', 'item')
      .leftJoinAndSelect('item.category', 'category')
      .leftJoinAndSelect('record.operatorUser', 'operatorUser')
      .orderBy('record.occurredAt', 'DESC')
      .addOrderBy('record.id', 'DESC')
      .skip(skip)
      .take(take);
    this.applyRecordFilters(qb, deptId, query);
    if (actor.role === 'mini' && query.mine) {
      qb.andWhere('record.operatorUserId = :operatorUserId', { operatorUserId: actor.id });
    }
    const [list, total] = await qb.getManyAndCount();
    return { list, total, page, pageSize };
  }

  async exportRecords(actor: JwtActor, query: PageQueryDto & { format?: string }) {
    const deptId = resolveDeptId(actor, query.deptId);
    const qb = this.recordRepo
      .createQueryBuilder('record')
      .leftJoinAndSelect('record.dept', 'dept')
      .leftJoinAndSelect('record.item', 'item')
      .leftJoinAndSelect('item.category', 'category')
      .orderBy('record.occurredAt', 'DESC')
      .limit(5000);
    this.applyRecordFilters(qb, deptId, query);
    const rows = await qb.getMany();
    const format = query.format || 'xlsx';
    if (format === 'pdf') return this.buildPdf(rows);
    if (format === 'docx') return this.buildDocx(rows);
    return this.buildExcel(rows);
  }

  private applyRecordFilters(qb: any, deptId: number | undefined, query: PageQueryDto) {
    if (deptId) qb.andWhere('record.deptId = :deptId', { deptId });
    if (query.type) qb.andWhere('record.type = :type', { type: query.type });
    if (query.categoryId) qb.andWhere('item.categoryId = :categoryId', { categoryId: query.categoryId });
    if (query.itemId) qb.andWhere('record.itemId = :itemId', { itemId: query.itemId });
    if (query.startDate) qb.andWhere('record.occurredAt >= :startDate', { startDate: `${query.startDate} 00:00:00` });
    if (query.endDate) qb.andWhere('record.occurredAt <= :endDate', { endDate: `${query.endDate} 23:59:59` });
    if (query.keyword) {
      qb.andWhere(
        new Brackets((b) =>
          b
            .where('item.name LIKE :kw')
            .orWhere('record.operatorName LIKE :kw')
            .orWhere('record.address LIKE :kw')
            .orWhere('record.poiName LIKE :kw'),
        ),
        { kw: `%${query.keyword}%` },
      );
    }
  }

  async dashboard() {
    const [deptCount, userPending, itemCount, recordCount] = await Promise.all([
      this.deptRepo.count(),
      this.userRepo.countBy({ status: UserStatus.Pending }),
      this.itemRepo.count(),
      this.recordRepo.count(),
    ]);
    return { deptCount, userPending, itemCount, recordCount };
  }

  private async resolveOpenid(code: string) {
    if (code.startsWith('dev:')) return code.replace('dev:', '');
    const appid = this.config.get<string>('WX_APPID');
    const secret = this.config.get<string>('WX_APPSECRET');
    if (!appid || !secret) {
      throw new BadRequestException('未配置 WX_APPID/WX_APPSECRET，开发期可用 code=dev:openid 调试');
    }
    const { data } = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
      params: { appid, secret, js_code: code, grant_type: 'authorization_code' },
    });
    if (!data.openid) {
      throw new BadRequestException(data.errmsg || '微信登录失败');
    }
    return data.openid as string;
  }

  private presentUser(user: UserEntity) {
    return {
      id: user.id,
      openid: user.openid,
      nickname: user.nickname,
      avatar: user.avatar,
      realName: user.realName,
      deptId: user.deptId,
      dept: user.dept,
      status: user.status,
      createdAt: user.createdAt,
      approvedAt: user.approvedAt,
    };
  }

  private async buildExcel(rows: StockRecordEntity[]) {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('出入库记录');
    sheet.columns = [
      { header: '部门', key: 'dept', width: 16 },
      { header: '物品', key: 'item', width: 24 },
      { header: '类目', key: 'category', width: 16 },
      { header: '类型', key: 'type', width: 8 },
      { header: '数量', key: 'quantity', width: 8 },
      { header: '操作人', key: 'operator', width: 14 },
      { header: '位置', key: 'address', width: 40 },
      { header: '经纬度', key: 'lnglat', width: 24 },
      { header: '日期', key: 'date', width: 20 },
      { header: '备注', key: 'note', width: 24 },
    ];
    rows.forEach((row) => sheet.addRow(this.exportRow(row)));
    const buffer = await workbook.xlsx.writeBuffer();
    return { buffer: Buffer.from(buffer), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' };
  }

  private async buildDocx(rows: StockRecordEntity[]) {
    const header = ['部门', '物品', '类型', '数量', '操作人', '位置', '日期'];
    const tableRows = [
      new TableRow({ children: header.map((text) => new TableCell({ children: [new Paragraph(text)] })) }),
      ...rows.map((row) => {
        const data = this.exportRow(row);
        return new TableRow({
          children: [data.dept, data.item, data.type, String(data.quantity), data.operator, data.address, data.date].map(
            (text) => new TableCell({ children: [new Paragraph(text || '')] }),
          ),
        });
      }),
    ];
    const doc = new Document({
      sections: [{ children: [new Paragraph({ children: [new TextRun({ text: '出入库记录', bold: true, size: 28 })] }), new Table({ rows: tableRows })] }],
    });
    const buffer = await Packer.toBuffer(doc);
    return { buffer, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' };
  }

  private async buildPdf(rows: StockRecordEntity[]) {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
    doc.font(this.resolvePdfFontPath());
    doc.fontSize(18).text('Churuku 出入库记录');
    doc.moveDown();
    doc.fontSize(10).text('日期 | 部门 | 物品 | 类型 | 数量 | 操作人 | 位置');
    doc.moveDown(0.5);
    rows.forEach((row) => {
      const data = this.exportRow(row);
      doc
        .fontSize(10)
        .text(
          `${data.date} | ${data.dept} | ${data.item} | ${data.type} | ${data.quantity} | ${data.operator} | ${data.address || ''}`,
          { lineGap: 4 },
        );
    });
    doc.end();
    return { buffer: await done, contentType: 'application/pdf', ext: 'pdf' };
  }

  private resolvePdfFontPath() {
    const candidates = [
      this.config.get<string>('PDF_FONT_PATH') || '',
      '/Library/Fonts/Arial Unicode.ttf',
      '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
      '/System/Library/Fonts/STHeiti Medium.ttc',
      '/System/Library/Fonts/STHeiti Light.ttc',
      '/System/Library/Fonts/Supplemental/Songti.ttc',
    ].filter(Boolean);
    const fontPath = candidates.find((item) => existsSync(item));
    if (!fontPath) {
      throw new BadRequestException(
        '未找到可用于 PDF 导出的中文字体，请在 .env 配置 PDF_FONT_PATH',
      );
    }
    return fontPath;
  }

  private exportRow(row: StockRecordEntity) {
    return {
      dept: row.dept?.name || '',
      item: row.item?.name || '',
      category: row.item?.category?.name || '',
      type: row.type === StockType.In ? '入库' : '出库',
      quantity: row.quantity,
      operator: row.operatorName || '',
      address: row.poiName ? `${row.poiName} ${row.address || ''}` : row.address || '',
      lnglat: row.longitude && row.latitude ? `${row.longitude},${row.latitude}` : '',
      date: dayjs(row.occurredAt).format('YYYY-MM-DD HH:mm'),
      note: row.note || '',
    };
  }
}
