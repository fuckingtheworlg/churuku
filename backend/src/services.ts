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
import {
  AdminEntity,
  AdminRole,
  DeptEntity,
  GlobalItemCategoryEntity,
  ItemCategoryEntity,
  ItemEntity,
  StockOrderEntity,
  StockOrderItemEntity,
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
    @InjectRepository(GlobalItemCategoryEntity)
    private readonly globalCategoryRepo: Repository<GlobalItemCategoryEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(ItemCategoryEntity)
    private readonly categoryRepo: Repository<ItemCategoryEntity>,
    @InjectRepository(ItemEntity)
    private readonly itemRepo: Repository<ItemEntity>,
    @InjectRepository(StockRecordEntity)
    private readonly recordRepo: Repository<StockRecordEntity>,
    @InjectRepository(StockOrderEntity)
    private readonly orderRepo: Repository<StockOrderEntity>,
    @InjectRepository(StockOrderItemEntity)
    private readonly orderItemRepo: Repository<StockOrderItemEntity>,
  ) {}

  async seedAdmin() {
    const existed = await this.adminRepo.findOneBy({ username: 'admin' });
    if (!existed) {
      const passwordHash = await bcrypt.hash('admin123', 10);
      await this.adminRepo.save(
        this.adminRepo.create({ username: 'admin', passwordHash, role: AdminRole.Super }),
      );
    } else if (!existed.role) {
      existed.role = AdminRole.Super;
      await this.adminRepo.save(existed);
    }
    await this.migrateLegacyRecords();
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
      adminRole: admin.role,
      deptId: admin.deptId,
    } satisfies JwtActor);
    return {
      token,
      user: {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        deptId: admin.deptId,
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
      const admin = await this.adminRepo.findOne({
        where: { id: actor.id },
        relations: ['dept'],
      });
      return { role: 'admin', user: admin };
    }
    const user = await this.userRepo.findOne({
      where: { id: actor.id },
      relations: ['dept'],
    });
    return { role: 'mini', user: user ? this.presentUser(user) : null };
  }

  async listAdmins(actor: JwtActor) {
    this.requireSuperAdmin(actor);
    return this.adminRepo.find({
      relations: ['dept'],
      order: { id: 'DESC' },
      select: {
        id: true,
        username: true,
        role: true,
        deptId: true,
        mustChangePassword: true,
        createdAt: true,
      },
    });
  }

  async saveAdmin(actor: JwtActor, id: number | undefined, dto: AdminAccountDto) {
    this.requireSuperAdmin(actor);
    if (dto.role === AdminRole.Dept && !dto.deptId) {
      throw new BadRequestException('部门管理员必须绑定部门');
    }
    const admin = id ? await this.adminRepo.findOneBy({ id }) : this.adminRepo.create();
    if (!admin) throw new NotFoundException('管理员不存在');
    const existed = await this.adminRepo.findOneBy({ username: dto.username });
    if (existed && existed.id !== id) throw new BadRequestException('账号已存在');
    admin.username = dto.username;
    admin.role = dto.role;
    admin.deptId = dto.role === AdminRole.Dept ? dto.deptId : undefined;
    if (!id || dto.password) {
      if (!dto.password) throw new BadRequestException('请填写初始密码');
      admin.passwordHash = await bcrypt.hash(dto.password, 10);
      admin.mustChangePassword = true;
    }
    return this.adminRepo.save(admin);
  }

  async deleteAdmin(actor: JwtActor, id: number) {
    this.requireSuperAdmin(actor);
    if (actor.id === id) throw new BadRequestException('不能删除当前登录账号');
    await this.adminRepo.delete(id);
    return true;
  }

  async createDept(actor: JwtActor, dto: DeptDto) {
    this.requireSuperAdmin(actor);
    const existed = await this.deptRepo.findOneBy([{ code: dto.code }, { name: dto.name }]);
    if (existed) {
      throw new BadRequestException('部门名称或编码已存在');
    }
    return this.deptRepo.save(this.deptRepo.create(dto));
  }

  async listDept(actor?: JwtActor) {
    if (actor?.role === 'admin' && actor.adminRole === AdminRole.Dept && actor.deptId) {
      return this.deptRepo.find({ where: { id: actor.deptId }, order: { id: 'DESC' } });
    }
    return this.deptRepo.find({ order: { id: 'DESC' } });
  }

  async updateDept(actor: JwtActor, id: number, dto: DeptDto) {
    this.requireSuperAdmin(actor);
    const dept = await this.deptRepo.findOneBy({ id });
    if (!dept) throw new NotFoundException('部门不存在');
    Object.assign(dept, dto);
    return this.deptRepo.save(dept);
  }

  async deleteDept(actor: JwtActor, id: number, force = false) {
    this.requireSuperAdmin(actor);
    const [itemCount, categoryCount, userCount, orderCount] = await Promise.all([
      this.itemRepo.countBy({ deptId: id }),
      this.categoryRepo.countBy({ deptId: id }),
      this.userRepo.countBy({ deptId: id }),
      this.orderRepo.countBy({ deptId: id }),
    ]);
    if ((itemCount > 0 || categoryCount > 0 || userCount > 0 || orderCount > 0) && !force) {
      throw new BadRequestException('部门下仍有业务数据，不能直接删除');
    }
    if (force) {
      await this.forceDeleteDept(id);
      return true;
    }
    await this.deptRepo.delete(id);
    return true;
  }

  async listGlobalCategories() {
    const list = await this.globalCategoryRepo.find({ order: { sort: 'ASC', id: 'DESC' } });
    const counts = await this.categoryRepo
      .createQueryBuilder('category')
      .select('category.globalCategoryId', 'globalCategoryId')
      .addSelect('COUNT(*)', 'usedCount')
      .where('category.globalCategoryId IS NOT NULL')
      .groupBy('category.globalCategoryId')
      .getRawMany<{ globalCategoryId: string; usedCount: string }>();
    const countMap = new Map(counts.map((item) => [Number(item.globalCategoryId), Number(item.usedCount)]));
    return list.map((item) => ({ ...item, usedCount: countMap.get(item.id) || 0 }));
  }

  async saveGlobalCategory(actor: JwtActor, id: number | undefined, dto: GlobalCategoryDto) {
    this.requireSuperAdmin(actor);
    const existed = await this.globalCategoryRepo.findOneBy({ name: dto.name });
    if (existed && existed.id !== id) throw new BadRequestException('总分类名称已存在');
    const category = id ? await this.globalCategoryRepo.findOneBy({ id }) : this.globalCategoryRepo.create();
    if (!category) throw new NotFoundException('总分类不存在');
    category.name = dto.name;
    category.sort = dto.sort || 0;
    return this.globalCategoryRepo.save(category);
  }

  async deleteGlobalCategory(actor: JwtActor, id: number, force = false) {
    this.requireSuperAdmin(actor);
    const usedCount = await this.categoryRepo.countBy({ globalCategoryId: id });
    if (usedCount > 0 && !force) {
      throw new BadRequestException('总分类已被部门使用，不能直接删除');
    }
    if (force) {
      await this.categoryRepo.update({ globalCategoryId: id }, { globalCategoryId: null });
    }
    await this.globalCategoryRepo.delete(id);
    return true;
  }

  async listUsers(actor: JwtActor, query: PageQueryDto) {
    const { skip, take, page, pageSize } = takePage(query);
    const deptId = resolveDeptId(actor, query.deptId);
    const qb = this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.dept', 'dept')
      .orderBy('user.id', 'DESC')
      .skip(skip)
      .take(take);
    if (deptId) qb.andWhere('user.deptId = :deptId', { deptId });
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

  async updateUserStatus(actor: JwtActor, id: number, dto: UserStatusDto) {
    const user = await this.userRepo.findOneBy({ id });
    if (!user) throw new NotFoundException('用户不存在');
    this.assertDeptAccess(actor, user.deptId);
    user.status = dto.status;
    user.approvedAt = dto.status === UserStatus.Active ? new Date() : user.approvedAt;
    await this.userRepo.save(user);
    return true;
  }

  async deleteUser(actor: JwtActor, id: number) {
    const user = await this.userRepo.findOneBy({ id });
    if (!user) throw new NotFoundException('用户不存在');
    this.assertDeptAccess(actor, user.deptId);
    await this.userRepo.delete(id);
    return true;
  }

  async saveCategory(id: number | undefined, actor: JwtActor, dto: CategoryDto) {
    const deptId = requireDeptId(actor, dto.deptId);
    const globalCategory = dto.globalCategoryId
      ? await this.globalCategoryRepo.findOneBy({ id: dto.globalCategoryId })
      : null;
    if (dto.globalCategoryId && !globalCategory) {
      throw new BadRequestException('总分类不存在');
    }
    const entity = id
      ? await this.categoryRepo.findOneBy({ id, deptId })
      : this.categoryRepo.create({ deptId });
    if (!entity) throw new NotFoundException('类目不存在');
    entity.name = dto.name || globalCategory?.name || '';
    if (!entity.name) throw new BadRequestException('请填写类目名称');
    entity.globalCategoryId = globalCategory?.id ?? null;
    entity.sort = dto.sort || 0;
    return this.categoryRepo.save(entity);
  }

  async listCategory(actor: JwtActor, deptId?: number) {
    const scopedDeptId = resolveDeptId(actor, deptId);
    const qb = this.categoryRepo
      .createQueryBuilder('category')
      .leftJoinAndSelect('category.dept', 'dept')
      .leftJoinAndSelect('category.globalCategory', 'globalCategory')
      .orderBy('category.sort', 'ASC')
      .addOrderBy('category.id', 'DESC');
    if (scopedDeptId) qb.where('category.deptId = :deptId', { deptId: scopedDeptId });
    return qb.getMany();
  }

  async deleteCategory(id: number, actor: JwtActor, force = false) {
    const category = await this.categoryRepo.findOneBy({ id });
    if (!category) throw new NotFoundException('类目不存在');
    this.assertDeptAccess(actor, category.deptId);
    const count = await this.itemRepo.countBy({ categoryId: id });
    if (count > 0 && !(force && this.isSuperAdmin(actor))) {
      throw new BadRequestException('类目下仍有物品，不能删除');
    }
    if (force && this.isSuperAdmin(actor)) {
      const items = await this.itemRepo.findBy({ categoryId: id });
      for (const item of items) {
        await this.deleteItem(item.id, actor, true);
      }
    }
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
    if (dto.quantity !== undefined && dto.quantity !== null) {
      const value = Number(dto.quantity);
      if (!Number.isFinite(value) || value < 0) {
        throw new BadRequestException('数量不能小于 0');
      }
      item.quantity = value;
    }
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
    this.assertDeptAccess(actor, item.deptId);
    return item;
  }

  async deleteItem(id: number, actor: JwtActor, force = false) {
    const item = await this.getItem(id, actor);
    const count = await this.orderItemRepo.countBy({ itemId: item.id });
    const legacyCount = await this.recordRepo.countBy({ itemId: item.id });
    if ((count > 0 || legacyCount > 0) && !(force && this.isSuperAdmin(actor))) {
      throw new BadRequestException('已有出入库记录，不能删除');
    }
    if (force && this.isSuperAdmin(actor)) {
      await this.forceDeleteItemHistory(item.id);
    }
    await this.itemRepo.delete(id);
    return true;
  }

  async createStockRecord(actor: JwtActor, dto: StockRecordDto) {
    const lines = this.resolveStockLines(dto);
    const projectName = (dto.projectName || '').trim();
    if (!projectName) throw new BadRequestException('请填写项目名称');
    const items = await Promise.all(
      lines.map(async (line) => {
        const item = await this.itemRepo.findOneBy({ id: line.itemId });
        if (!item) throw new NotFoundException(`物品不存在：${line.itemId}`);
        return { item, quantity: line.quantity };
      }),
    );
    const deptId = items[0].item.deptId;
    if (items.some((line) => line.item.deptId !== deptId)) {
      throw new BadRequestException('一次出入库只能选择同一部门下的物品');
    }
    this.assertDeptAccess(actor, deptId);
    const insufficient = items.find((line) => dto.type === StockType.Out && line.item.quantity < line.quantity);
    if (insufficient) throw new BadRequestException(`${insufficient.item.name} 库存不足`);
    const orderId = await this.itemRepo.manager.transaction(async (manager) => {
      for (const line of items) {
        line.item.quantity += dto.type === StockType.In ? line.quantity : -line.quantity;
        await manager.save(ItemEntity, line.item);
      }
      const order = await manager.save(
        StockOrderEntity,
        manager.create(StockOrderEntity, {
          deptId,
          type: dto.type,
          projectName,
          operatorUserId: actor.role === 'mini' ? actor.id : undefined,
          operatorAdminId: actor.role === 'admin' ? actor.id : undefined,
          operatorName: actor.realName || actor.username || '管理员',
          latitude: dto.latitude === undefined ? undefined : String(dto.latitude),
          longitude: dto.longitude === undefined ? undefined : String(dto.longitude),
          address: dto.address,
          poiName: dto.poiName,
          photos: dto.photos || [],
          signatureUrl: dto.signatureUrl,
          occurredAt: new Date(dto.occurredAt),
          note: dto.note,
        }),
      );
      await manager.save(
        StockOrderItemEntity,
        items.map((line) =>
          manager.create(StockOrderItemEntity, {
            orderId: order.id,
            itemId: line.item.id,
            quantity: line.quantity,
          }),
        ),
      );
      return order.id;
    });
    return this.getStockOrder(orderId, actor);
  }

  async listStockRecords(actor: JwtActor, query: PageQueryDto) {
    const { skip, take, page, pageSize } = takePage(query);
    const deptId = resolveDeptId(actor, query.deptId);
    const qb = this.orderRepo
      .createQueryBuilder('record')
      .leftJoinAndSelect('record.dept', 'dept')
      .leftJoinAndSelect('record.items', 'orderItem')
      .leftJoinAndSelect('orderItem.item', 'item')
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
    return { list: list.map((item) => this.presentStockOrder(item)), total, page, pageSize };
  }

  async exportRecords(actor: JwtActor, query: PageQueryDto & { format?: string }) {
    const deptId = resolveDeptId(actor, query.deptId);
    const qb = this.orderRepo
      .createQueryBuilder('record')
      .leftJoinAndSelect('record.dept', 'dept')
      .leftJoinAndSelect('record.items', 'orderItem')
      .leftJoinAndSelect('orderItem.item', 'item')
      .leftJoinAndSelect('item.category', 'category')
      .orderBy('record.occurredAt', 'DESC')
      .limit(5000);
    this.applyRecordFilters(qb, deptId, query);
    const rows = (await qb.getMany()).map((item) => this.presentStockOrder(item));
    const format = query.format || 'xlsx';
    if (format === 'pdf') return this.buildPdf(rows);
    if (format === 'docx') return this.buildDocx(rows);
    return this.buildExcel(rows);
  }

  async exportSingleRecord(actor: JwtActor, id: number, format = 'xlsx') {
    const order = await this.getStockOrder(id, actor);
    const rows = [order];
    if (format === 'pdf') return this.buildPdf(rows);
    if (format === 'docx') return this.buildDocx(rows);
    return this.buildExcel(rows);
  }

  async exportRecordsByIds(actor: JwtActor, ids: number[], format = 'xlsx') {
    if (!ids.length) throw new BadRequestException('请选择要导出的记录');
    const rows: any[] = [];
    for (const id of ids) {
      rows.push(await this.getStockOrder(id, actor));
    }
    if (format === 'pdf') return this.buildPdf(rows);
    if (format === 'docx') return this.buildDocx(rows);
    return this.buildExcel(rows);
  }

  async deleteStockOrder(actor: JwtActor, id: number) {
    const order = await this.orderRepo.findOneBy({ id });
    if (!order) throw new NotFoundException('出入库记录不存在');
    this.assertDeptAccess(actor, order.deptId);
    await this.orderRepo.manager.transaction(async (manager) => {
      await manager.delete(StockOrderItemEntity, { orderId: id });
      await manager.delete(StockOrderEntity, { id });
    });
    return true;
  }

  async bulkDeleteStockOrders(actor: JwtActor, ids: number[]) {
    if (!Array.isArray(ids) || !ids.length) {
      throw new BadRequestException('请选择要删除的记录');
    }
    let deleted = 0;
    for (const id of ids) {
      try {
        await this.deleteStockOrder(actor, Number(id));
        deleted += 1;
      } catch (error) {
        if (error instanceof UnauthorizedException) throw error;
      }
    }
    return { deleted };
  }

  private applyRecordFilters(qb: any, deptId: number | undefined, query: PageQueryDto) {
    if (deptId) qb.andWhere('record.deptId = :deptId', { deptId });
    if (query.type) qb.andWhere('record.type = :type', { type: query.type });
    if (query.categoryId) qb.andWhere('item.categoryId = :categoryId', { categoryId: query.categoryId });
    if (query.itemId) qb.andWhere('orderItem.itemId = :itemId', { itemId: query.itemId });
    if (query.startDate) qb.andWhere('record.occurredAt >= :startDate', { startDate: `${query.startDate} 00:00:00` });
    if (query.endDate) qb.andWhere('record.occurredAt <= :endDate', { endDate: `${query.endDate} 23:59:59` });
    if (query.keyword) {
      qb.andWhere(
        new Brackets((b) =>
          b
            .where('item.name LIKE :kw')
            .orWhere('record.projectName LIKE :kw')
            .orWhere('record.operatorName LIKE :kw')
            .orWhere('record.address LIKE :kw')
            .orWhere('record.poiName LIKE :kw'),
        ),
        { kw: `%${query.keyword}%` },
      );
    }
  }

  async dashboard(actor: JwtActor) {
    const deptId = resolveDeptId(actor);
    const [deptCount, userPending, itemCount, recordCount] = await Promise.all([
      deptId ? Promise.resolve(1) : this.deptRepo.count(),
      deptId ? this.userRepo.countBy({ status: UserStatus.Pending, deptId }) : this.userRepo.countBy({ status: UserStatus.Pending }),
      deptId ? this.itemRepo.countBy({ deptId }) : this.itemRepo.count(),
      deptId ? this.orderRepo.countBy({ deptId }) : this.orderRepo.count(),
    ]);
    return { deptCount, userPending, itemCount, recordCount };
  }

  private async getStockOrder(id: number, actor: JwtActor) {
    const order = await this.orderRepo.findOne({
      where: { id },
      relations: ['dept', 'items', 'items.item', 'items.item.category', 'operatorUser'],
    });
    if (!order) throw new NotFoundException('出入库记录不存在');
    this.assertDeptAccess(actor, order.deptId);
    return this.presentStockOrder(order);
  }

  private resolveStockLines(dto: StockRecordDto) {
    const rawLines =
      dto.items && dto.items.length > 0
        ? dto.items
        : dto.itemId && dto.quantity
          ? [{ itemId: dto.itemId, quantity: dto.quantity }]
          : [];
    const merged = new Map<number, number>();
    rawLines.forEach((line) => {
      const itemId = Number(line.itemId);
      const quantity = Number(line.quantity);
      if (!Number.isFinite(itemId) || itemId <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException('请选择物品并填写正确数量');
      }
      merged.set(itemId, (merged.get(itemId) || 0) + quantity);
    });
    if (merged.size === 0) throw new BadRequestException('请至少添加一种物品');
    return Array.from(merged.entries()).map(([itemId, quantity]) => ({ itemId, quantity }));
  }

  private presentStockOrder(order: StockOrderEntity) {
    const lines = (order.items || []).map((line) => ({
      id: line.id,
      itemId: line.itemId,
      quantity: line.quantity,
      item: line.item,
    }));
    const firstLine = lines[0];
    return {
      ...order,
      items: lines,
      itemId: firstLine?.itemId,
      item: firstLine?.item,
      quantity: lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0),
      itemSummary: lines.map((line) => `${line.item?.name || '未知物品'} x ${line.quantity}${line.item?.unit || ''}`).join('；'),
    };
  }

  private assertDeptAccess(actor: JwtActor, deptId: number) {
    if (actor.role === 'mini' && Number(actor.deptId) !== deptId) {
      throw new UnauthorizedException('无权操作该部门数据');
    }
    if (actor.role === 'admin' && actor.adminRole === AdminRole.Dept && Number(actor.deptId) !== deptId) {
      throw new UnauthorizedException('无权操作其他部门数据');
    }
  }

  private requireSuperAdmin(actor: JwtActor) {
    if (actor.role !== 'admin' || actor.adminRole === AdminRole.Dept) {
      throw new UnauthorizedException('需要超级管理员权限');
    }
  }

  private isSuperAdmin(actor: JwtActor) {
    return actor.role === 'admin' && actor.adminRole !== AdminRole.Dept;
  }

  private async forceDeleteItemHistory(itemId: number) {
    const rows = await this.orderItemRepo.findBy({ itemId });
    const orderIds = Array.from(new Set(rows.map((row) => row.orderId)));
    if (rows.length > 0) {
      await this.orderItemRepo.delete({ itemId });
    }
    for (const orderId of orderIds) {
      const remain = await this.orderItemRepo.countBy({ orderId });
      if (remain === 0) {
        await this.orderRepo.delete(orderId);
      }
    }
    await this.recordRepo.delete({ itemId });
  }

  private async forceDeleteDept(deptId: number) {
    const orderIds = (await this.orderRepo.findBy({ deptId })).map((row) => row.id);
    for (const orderId of orderIds) {
      await this.orderItemRepo.delete({ orderId });
    }
    await this.orderRepo.delete({ deptId });
    await this.recordRepo.delete({ deptId });
    await this.itemRepo.delete({ deptId });
    await this.categoryRepo.delete({ deptId });
    await this.userRepo.delete({ deptId });
    await this.adminRepo.delete({ deptId });
    await this.deptRepo.delete(deptId);
  }

  private async migrateLegacyRecords() {
    const rows = await this.recordRepo.find({ take: 10000 });
    for (const row of rows) {
      const existed = await this.orderRepo.findOneBy({ legacyRecordId: row.id });
      if (existed) continue;
      const order = await this.orderRepo.save(
        this.orderRepo.create({
          deptId: row.deptId,
          type: row.type,
          projectName: row.note || '历史数据',
          operatorUserId: row.operatorUserId,
          operatorName: row.operatorName,
          latitude: row.latitude,
          longitude: row.longitude,
          address: row.address,
          poiName: row.poiName,
          photos: row.photos || [],
          signatureUrl: row.signatureUrl,
          occurredAt: row.occurredAt,
          note: row.note,
          legacyRecordId: row.id,
        }),
      );
      await this.orderItemRepo.save(
        this.orderItemRepo.create({
          orderId: order.id,
          itemId: row.itemId,
          quantity: row.quantity,
        }),
      );
    }
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

  private async buildExcel(rows: any[]) {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('出入库记录');
    sheet.columns = [
      { header: '部门', key: 'dept', width: 16 },
      { header: '项目名称', key: 'projectName', width: 24 },
      { header: '物品明细', key: 'item', width: 40 },
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

  private async buildDocx(rows: any[]) {
    const header = ['部门', '项目名称', '物品明细', '类型', '数量', '操作人', '位置', '日期'];
    const tableRows = [
      new TableRow({ children: header.map((text) => new TableCell({ children: [new Paragraph(text)] })) }),
      ...rows.map((row) => {
        const data = this.exportRow(row);
        return new TableRow({
          children: [data.dept, data.projectName, data.item, data.type, String(data.quantity), data.operator, data.address, data.date].map(
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

  private async buildPdf(rows: any[]) {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      const errorPromise = new Promise<never>((_, reject) => doc.on('error', reject));
      const donePromise = new Promise<Buffer>((resolve) =>
        doc.on('end', () => resolve(Buffer.concat(chunks))),
      );
      this.applyPdfFont(doc);
      doc.fontSize(18).text('Churuku 出入库记录');
      doc.moveDown();
      doc.fontSize(10).text('日期 | 部门 | 项目 | 物品明细 | 类型 | 数量 | 操作人 | 位置');
      doc.moveDown(0.5);
      rows.forEach((row) => {
        const data = this.exportRow(row);
        doc
          .fontSize(10)
          .text(
            `${data.date} | ${data.dept} | ${data.projectName} | ${data.item} | ${data.type} | ${data.quantity} | ${data.operator} | ${data.address || ''}`,
            { lineGap: 4 },
          );
      });
      doc.end();
      const buffer = await Promise.race([donePromise, errorPromise]);
      return { buffer, contentType: 'application/pdf', ext: 'pdf' };
    } catch (error: any) {
      throw new BadRequestException(
        `PDF 生成失败：${error?.message || error || '未知错误'}`,
      );
    }
  }

  private applyPdfFont(doc: PDFKit.PDFDocument) {
    const fontPath = this.resolvePdfFontPath();
    if (!fontPath.toLowerCase().endsWith('.ttc')) {
      doc.font(fontPath);
      return;
    }
    const psNames = [
      'NotoSansCJKsc-Regular',
      'NotoSansCJKtc-Regular',
      'NotoSansCJKhk-Regular',
      'NotoSansCJKjp-Regular',
      'NotoSansCJKkr-Regular',
      'NotoSerifCJKsc-Regular',
      'STHeitiTC-Light',
      'STHeitiSC-Light',
      'STHeitiTC-Medium',
      'STHeitiSC-Medium',
    ];
    let lastError: any;
    for (const name of psNames) {
      try {
        doc.registerFont('cjk', fontPath, name);
        doc.font('cjk');
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw new BadRequestException(
      `PDF 字体加载失败，尝试 ${psNames.length} 个 PostScript 名均失败：${lastError?.message || lastError || '未知错误'}`,
    );
  }

  private resolvePdfFontPath() {
    const configured = this.config.get<string>('PDF_FONT_PATH') || '';
    const candidates = [
      configured,
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc',
      '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
      '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
      '/usr/share/fonts/wenquanyi/wqy-microhei.ttc',
      '/usr/share/fonts/wenquanyi/wqy-zenhei.ttc',
      '/usr/share/fonts/truetype/arphic/uming.ttc',
      '/usr/share/fonts/truetype/arphic/ukai.ttc',
      '/Library/Fonts/Arial Unicode.ttf',
      '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
      '/System/Library/Fonts/STHeiti Medium.ttc',
      '/System/Library/Fonts/STHeiti Light.ttc',
      '/System/Library/Fonts/Supplemental/Songti.ttc',
    ].filter(Boolean);
    const fontPath = candidates.find((item) => existsSync(item));
    if (!fontPath) {
      throw new BadRequestException(
        '未找到可用于 PDF 导出的中文字体，请在 .env 配置 PDF_FONT_PATH，或安装 fonts-noto-cjk',
      );
    }
    return fontPath;
  }

  private exportRow(row: any) {
    return {
      dept: row.dept?.name || '',
      projectName: row.projectName || '',
      item: row.itemSummary || row.item?.name || '',
      category: (row.items || []).map((line: any) => line.item?.category?.name).filter(Boolean).join('；') || row.item?.category?.name || '',
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
