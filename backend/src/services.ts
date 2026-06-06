import {
  BadRequestException,
  ForbiddenException,
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
import { Brackets, In, IsNull, Repository } from 'typeorm';
import * as QRCode from 'qrcode';
import {
  AdminAccountDto,
  CategoryDto,
  ChangePasswordDto,
  DeptDto,
  GlobalCategoryDto,
  ItemDto,
  ItemUnitUpdateDto,
  LoginDto,
  PageQueryDto,
  StockRecordDto,
  UsageActionDto,
  UserStatusDto,
  WxLoginDto,
  WxRegisterDto,
} from './dto';
import {
  AdminEntity,
  AdminRole,
  DeptEntity,
  EquipmentUsageEntity,
  GlobalItemCategoryEntity,
  ItemCategoryEntity,
  ItemEntity,
  ItemUnitEntity,
  ItemUnitStatus,
  StockOrderEntity,
  StockOrderItemEntity,
  StockOrderUnitEntity,
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
    @InjectRepository(EquipmentUsageEntity)
    private readonly usageRepo: Repository<EquipmentUsageEntity>,
    @InjectRepository(ItemUnitEntity)
    private readonly unitRepo: Repository<ItemUnitEntity>,
    @InjectRepository(StockOrderUnitEntity)
    private readonly orderUnitRepo: Repository<StockOrderUnitEntity>,
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
    await this.unitRepo.update(
      { status: ItemUnitStatus.Retired },
      { status: ItemUnitStatus.InStock, retired: true },
    );
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
      : this.itemRepo.create({ deptId, quantity: 0, trackIndividually: false });
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
    if (dto.trackIndividually !== undefined) {
      item.trackIndividually = dto.trackIndividually;
    }
    if (dto.maxUsageMinutes !== undefined) {
      item.maxUsageMinutes = dto.maxUsageMinutes;
    }
    let desiredQuantity = item.quantity;
    if (dto.quantity !== undefined && dto.quantity !== null) {
      const value = Number(dto.quantity);
      if (!Number.isFinite(value) || value < 0) {
        throw new BadRequestException('数量不能小于 0');
      }
      desiredQuantity = value;
    }
    if (!item.trackIndividually) {
      item.quantity = desiredQuantity;
    }
    const saved = await this.itemRepo.save(item);
    if (saved.trackIndividually) {
      await this.ensureUnits(saved, desiredQuantity);
      await this.syncItemQuantity(saved.id);
      return this.itemRepo.findOneBy({ id: saved.id });
    }
    return saved;
  }

  private async ensureUnits(item: ItemEntity, targetQuantity: number) {
    const existing = await this.unitRepo.find({
      where: { itemId: item.id },
      order: { id: 'ASC' },
    });
    if (targetQuantity <= existing.length) return;
    let maxNum = 0;
    existing.forEach((u) => {
      const n = parseInt(u.code, 10);
      if (!Number.isNaN(n) && n > maxNum) maxNum = n;
    });
    const toCreate: ItemUnitEntity[] = [];
    for (let i = existing.length; i < targetQuantity; i += 1) {
      maxNum += 1;
      toCreate.push(
        this.unitRepo.create({
          deptId: item.deptId,
          itemId: item.id,
          code: String(maxNum),
          status: ItemUnitStatus.InStock,
          accumulatedMinutes: 0,
        }),
      );
    }
    if (toCreate.length) await this.unitRepo.save(toCreate);
  }

  private async syncItemQuantity(itemId: number) {
    const item = await this.itemRepo.findOneBy({ id: itemId });
    if (!item || !item.trackIndividually) return;
    const inStock = await this.unitRepo.countBy({
      itemId,
      status: ItemUnitStatus.InStock,
      retired: false,
    });
    item.quantity = inStock;
    await this.itemRepo.save(item);
  }

  async listItemUnits(actor: JwtActor, itemId: number) {
    const item = await this.getItem(itemId, actor);
    return this.buildUnitViews(item);
  }

  async getUnitView(actor: JwtActor, unitId: number) {
    const unit = await this.unitRepo.findOneBy({ id: unitId });
    if (!unit) throw new NotFoundException('设备单元不存在');
    this.assertDeptAccess(actor, unit.deptId);
    const item = await this.getItem(unit.itemId, actor);
    const views = await this.buildUnitViews(item);
    const view = views.find((v) => v.id === unit.id) || null;
    return { item, unit: view };
  }

  async listReturnableOrders(actor: JwtActor, deptId?: number) {
    const scopedDeptId = resolveDeptId(actor, deptId);
    const qb = this.orderRepo
      .createQueryBuilder('record')
      .leftJoinAndSelect('record.dept', 'dept')
      .leftJoinAndSelect('record.items', 'orderItem')
      .leftJoinAndSelect('orderItem.item', 'item')
      .leftJoinAndSelect('record.units', 'orderUnit')
      .leftJoinAndSelect('orderUnit.unit', 'unit')
      .where('record.type = :type', { type: StockType.Out })
      .andWhere('record.completed = :completed', { completed: false })
      .orderBy('record.occurredAt', 'DESC')
      .limit(200);
    if (scopedDeptId) qb.andWhere('record.deptId = :deptId', { deptId: scopedDeptId });
    if (actor.role === 'mini') {
      qb.andWhere('record.operatorUserId = :uid', { uid: actor.id });
    }
    const rows = await qb.getMany();
    return rows.map((row) => this.presentStockOrder(row));
  }

  private async capUsageAtLimit(
    session: EquipmentUsageEntity,
    unit: ItemUnitEntity,
    max: number,
  ) {
    const allowed = Math.max(0, max - unit.accumulatedMinutes);
    const started = new Date(session.startedAt).getTime();
    session.endedAt = new Date(started + allowed * 60000);
    session.durationMinutes = allowed;
    const note = '达到使用上限自动结束';
    session.note = session.note ? `${session.note}；${note}` : note;
    await this.usageRepo.save(session);
    unit.accumulatedMinutes += allowed;
    unit.retired = true;
    await this.unitRepo.save(unit);
  }

  private async buildUnitViews(item: ItemEntity) {
    const units = await this.unitRepo.find({
      where: { itemId: item.id },
      order: { id: 'ASC' },
    });
    if (!units.length) return [];
    const open = await this.usageRepo.find({
      where: { unitId: In(units.map((u) => u.id)), endedAt: IsNull() },
      relations: ['operatorUser'],
    });
    const openMap = new Map<number, (typeof open)[number]>();
    open.forEach((session) => {
      if (session.unitId && !openMap.has(session.unitId)) openMap.set(session.unitId, session);
    });
    const max = item.maxUsageMinutes && item.maxUsageMinutes > 0 ? item.maxUsageMinutes : 0;
    const now = Date.now();
    const views: any[] = [];
    for (const u of units) {
      let session = openMap.get(u.id) || null;
      if (
        session &&
        max &&
        u.accumulatedMinutes + Math.round((now - new Date(session.startedAt).getTime()) / 60000) >= max
      ) {
        await this.capUsageAtLimit(session, u, max);
        session = null;
      }
      const ongoingMinutes = session
        ? Math.max(0, Math.round((now - new Date(session.startedAt).getTime()) / 60000))
        : 0;
      views.push({
        id: u.id,
        itemId: u.itemId,
        code: u.code,
        status: u.retired ? 'retired' : u.status,
        retired: u.retired,
        inUse: !!session,
        accumulatedMinutes: u.accumulatedMinutes + ongoingMinutes,
        maxUsageMinutes: max || null,
        ongoing: session
          ? {
              operatorName: session.operatorName || session.operatorUser?.realName || '未知',
              startedAt: session.startedAt,
              durationMinutes: ongoingMinutes,
            }
          : null,
      });
    }
    return views;
  }

  async updateUnit(actor: JwtActor, unitId: number, dto: ItemUnitUpdateDto) {
    const unit = await this.unitRepo.findOneBy({ id: unitId });
    if (!unit) throw new NotFoundException('设备单元不存在');
    this.assertDeptAccess(actor, unit.deptId);
    if (dto.code !== undefined && dto.code.trim()) {
      unit.code = dto.code.trim();
    }
    if (dto.status !== undefined) {
      if (dto.status === ItemUnitStatus.Retired) unit.retired = true;
      else if (dto.status === ItemUnitStatus.InStock) unit.retired = false;
    }
    await this.unitRepo.save(unit);
    await this.syncItemQuantity(unit.itemId);
    return unit;
  }

  async deleteUnit(actor: JwtActor, unitId: number) {
    const unit = await this.unitRepo.findOneBy({ id: unitId });
    if (!unit) throw new NotFoundException('设备单元不存在');
    this.assertDeptAccess(actor, unit.deptId);
    if (unit.status === ItemUnitStatus.Out) {
      throw new BadRequestException('该设备在外（已出库），不能删除');
    }
    const open = await this.usageRepo.countBy({ unitId, endedAt: IsNull() });
    if (open > 0) throw new BadRequestException('该设备正在使用中，不能删除');
    await this.unitRepo.delete(unitId);
    await this.syncItemQuantity(unit.itemId);
    return true;
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
    const enriched = await this.attachUsageSummary(list);
    return { list: enriched, total, page, pageSize };
  }

  private async attachUsageSummary(items: ItemEntity[]) {
    if (!items.length) return items;
    const ids = items.map((it) => it.id);
    const [openSessions, totals] = await Promise.all([
      this.usageRepo.find({
        where: { itemId: In(ids), endedAt: IsNull() },
        relations: ['operatorUser'],
        order: { startedAt: 'DESC' },
      }),
      this.usageRepo
        .createQueryBuilder('u')
        .select('u.item_id', 'itemId')
        .addSelect('COALESCE(SUM(u.duration_minutes), 0)', 'total')
        .where('u.item_id IN (:...ids)', { ids })
        .andWhere('u.ended_at IS NOT NULL')
        .groupBy('u.item_id')
        .getRawMany<{ itemId: string | number; total: string | number }>(),
    ]);
    const openMap = new Map<number, typeof openSessions[number]>();
    openSessions.forEach((session) => {
      if (!openMap.has(session.itemId)) openMap.set(session.itemId, session);
    });
    const totalMap = new Map<number, number>();
    totals.forEach((row) => {
      totalMap.set(Number(row.itemId), Number(row.total) || 0);
    });
    const individualIds = items.filter((it) => it.trackIndividually).map((it) => it.id);
    const unitStatsMap = new Map<
      number,
      { total: number; inStock: number; out: number; retired: number; inUse: number; totalMinutes: number }
    >();
    if (individualIds.length) {
      const units = await this.unitRepo.find({ where: { itemId: In(individualIds) } });
      const openUnits = await this.usageRepo.find({
        where: { unitId: In(units.map((u) => u.id).length ? units.map((u) => u.id) : [0]), endedAt: IsNull() },
      });
      const inUseUnitIds = new Set(openUnits.map((s) => s.unitId));
      const openByUnit = new Map<number, Date>();
      openUnits.forEach((s) => {
        if (s.unitId) openByUnit.set(s.unitId, new Date(s.startedAt));
      });
      const now2 = Date.now();
      units.forEach((u) => {
        const stat =
          unitStatsMap.get(u.itemId) ||
          { total: 0, inStock: 0, out: 0, retired: 0, inUse: 0, totalMinutes: 0 };
        stat.total += 1;
        if (u.retired) stat.retired += 1;
        else if (u.status === ItemUnitStatus.InStock) stat.inStock += 1;
        else if (u.status === ItemUnitStatus.Out) stat.out += 1;
        let minutes = u.accumulatedMinutes;
        if (inUseUnitIds.has(u.id)) {
          stat.inUse += 1;
          const started = openByUnit.get(u.id);
          if (started) minutes += Math.max(0, Math.round((now2 - started.getTime()) / 60000));
        }
        stat.totalMinutes += minutes;
        unitStatsMap.set(u.itemId, stat);
      });
    }
    const now = Date.now();
    return items.map((row) => {
      const open = openMap.get(row.id);
      const ongoingMinutes = open
        ? Math.max(0, Math.round((now - new Date(open.startedAt).getTime()) / 60000))
        : 0;
      const ongoing = open
        ? {
            id: open.id,
            operatorName:
              open.operatorName || open.operatorUser?.realName || '未知',
            startedAt: open.startedAt,
            durationMinutes: ongoingMinutes,
          }
        : null;
      const totalEnded = totalMap.get(row.id) || 0;
      const unitStats = unitStatsMap.get(row.id) || null;
      return Object.assign(row, {
        usageOngoing: ongoing,
        usageTotalMinutes: row.trackIndividually
          ? unitStats?.totalMinutes || 0
          : totalEnded + ongoingMinutes,
        unitStats,
      });
    });
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
      await this.usageRepo.delete({ itemId: item.id });
      await this.unitRepo.delete({ itemId: item.id });
    }
    await this.itemRepo.delete(id);
    return true;
  }

  private async resolveUsageUnit(item: ItemEntity, unitId?: number) {
    if (!item.trackIndividually) return null;
    if (!unitId) throw new BadRequestException('请扫描或选择具体设备（单台）');
    const unit = await this.unitRepo.findOneBy({ id: unitId, itemId: item.id });
    if (!unit) throw new NotFoundException('设备单元不存在');
    return unit;
  }

  private buildOpenWhere(item: ItemEntity, unit: ItemUnitEntity | null) {
    return unit
      ? { unitId: unit.id, endedAt: IsNull() }
      : { itemId: item.id, unitId: IsNull(), endedAt: IsNull() };
  }

  private async finishUsageSession(
    open: EquipmentUsageEntity,
    item: ItemEntity,
    extraNote?: string,
  ) {
    const endedAt = new Date();
    const startedAt = new Date(open.startedAt);
    let durationMinutes = Math.max(
      0,
      Math.round((endedAt.getTime() - startedAt.getTime()) / 60000),
    );
    const unit = open.unitId ? await this.unitRepo.findOneBy({ id: open.unitId }) : null;
    const max = item.maxUsageMinutes && item.maxUsageMinutes > 0 ? item.maxUsageMinutes : 0;
    let capped = false;
    if (unit && max) {
      const allowed = Math.max(0, max - unit.accumulatedMinutes);
      if (durationMinutes > allowed) {
        durationMinutes = allowed;
        capped = true;
      }
    }
    open.endedAt = endedAt;
    open.durationMinutes = durationMinutes;
    const note = capped ? `${extraNote ? extraNote + '；' : ''}达到使用上限自动封顶` : extraNote;
    if (note) {
      open.note = open.note ? `${open.note}；${note}` : note;
    }
    await this.usageRepo.save(open);
    if (unit) {
      unit.accumulatedMinutes += durationMinutes;
      if (max && unit.accumulatedMinutes >= max) {
        unit.retired = true;
      }
      await this.unitRepo.save(unit);
      await this.syncItemQuantity(unit.itemId);
    }
  }

  async startUsage(actor: JwtActor, dto: UsageActionDto) {
    const item = await this.getItem(dto.itemId, actor);
    const unit = await this.resolveUsageUnit(item, dto.unitId);
    if (unit && unit.retired) {
      throw new BadRequestException('该设备已到期/停用，不能再使用');
    }
    const open = await this.usageRepo.findOne({
      where: this.buildOpenWhere(item, unit),
      order: { startedAt: 'DESC' },
      relations: ['operatorUser'],
    });
    if (open) {
      const name = open.operatorName || open.operatorUser?.realName || '其他人员';
      throw new BadRequestException(`该设备正在被 ${name} 使用，请先结束当前使用`);
    }
    const usage = this.usageRepo.create({
      deptId: item.deptId,
      itemId: item.id,
      unitId: unit ? unit.id : null,
      operatorUserId: actor.role === 'mini' ? actor.id : undefined,
      operatorName: actor.realName || actor.username || '管理员',
      startedAt: new Date(),
      note: dto.note,
    });
    await this.usageRepo.save(usage);
    return this.getItemUsageSummary(actor, item.id);
  }

  async endUsage(actor: JwtActor, dto: UsageActionDto) {
    const item = await this.getItem(dto.itemId, actor);
    const unit = await this.resolveUsageUnit(item, dto.unitId);
    const open = await this.usageRepo.findOne({
      where: this.buildOpenWhere(item, unit),
      order: { startedAt: 'DESC' },
    });
    if (!open) {
      throw new BadRequestException('该设备当前不在使用中');
    }
    await this.finishUsageSession(open, item, dto.note);
    return this.getItemUsageSummary(actor, item.id);
  }

  async forceEndUsageByAdmin(actor: JwtActor, dto: UsageActionDto) {
    if (actor.role !== 'admin') {
      throw new ForbiddenException('需要管理员权限');
    }
    const item = await this.getItem(dto.itemId, actor);
    const unit = await this.resolveUsageUnit(item, dto.unitId);
    const open = await this.usageRepo.findOne({
      where: this.buildOpenWhere(item, unit),
      order: { startedAt: 'DESC' },
    });
    if (!open) {
      throw new BadRequestException('该设备当前不在使用中');
    }
    const adminName = actor.username || '管理员';
    const reason = dto.note
      ? `管理员强制结束(${adminName})：${dto.note}`
      : `管理员强制结束(${adminName})`;
    await this.finishUsageSession(open, item, reason);
    return this.getItemUsageSummary(actor, item.id);
  }

  async getItemUsageSummary(actor: JwtActor, itemId: number) {
    const item = await this.getItem(itemId, actor);
    const [ongoing, totalRow, recent] = await Promise.all([
      this.usageRepo.findOne({
        where: { itemId: item.id, endedAt: IsNull() },
        order: { startedAt: 'DESC' },
        relations: ['operatorUser'],
      }),
      this.usageRepo
        .createQueryBuilder('u')
        .select('COALESCE(SUM(u.duration_minutes), 0)', 'total')
        .where('u.item_id = :id', { id: item.id })
        .andWhere('u.ended_at IS NOT NULL')
        .getRawOne<{ total: string | number }>(),
      this.usageRepo.find({
        where: { itemId: item.id },
        order: { startedAt: 'DESC' },
        take: 10,
        relations: ['operatorUser'],
      }),
    ]);
    const totalEnded = Number(totalRow?.total || 0);
    const ongoingMinutes = ongoing
      ? Math.max(0, Math.round((Date.now() - new Date(ongoing.startedAt).getTime()) / 60000))
      : 0;
    const units = item.trackIndividually ? await this.buildUnitViews(item) : [];
    const unitsTotalMinutes = units.reduce((sum, u) => sum + (u.accumulatedMinutes || 0), 0);
    return {
      item,
      trackIndividually: item.trackIndividually,
      units,
      ongoing: ongoing
        ? {
            id: ongoing.id,
            operatorUserId: ongoing.operatorUserId,
            operatorName:
              ongoing.operatorName || ongoing.operatorUser?.realName || '未知',
            startedAt: ongoing.startedAt,
            durationMinutes: ongoingMinutes,
          }
        : null,
      totalMinutes: item.trackIndividually ? unitsTotalMinutes : totalEnded + ongoingMinutes,
      recent: recent.map((row) => ({
        id: row.id,
        operatorName: row.operatorName || row.operatorUser?.realName || '未知',
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        durationMinutes: row.durationMinutes,
        note: row.note,
      })),
    };
  }

  async buildItemQrCode(actor: JwtActor, itemId: number, format = 'png') {
    const item = await this.getItem(itemId, actor);
    const payload = String(item.id);
    if (format === 'pdf') {
      const png = await QRCode.toBuffer(payload, { width: 480, margin: 2, errorCorrectionLevel: 'M' });
      const doc = new PDFDocument({ size: 'A6', margin: 24 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      const done = new Promise<Buffer>((resolve) =>
        doc.on('end', () => resolve(Buffer.concat(chunks))),
      );
      this.applyPdfFont(doc);
      doc.fontSize(14).text(item.name, { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(10).text(`${item.spec || ''}`.trim(), { align: 'center' });
      doc.moveDown(0.6);
      doc.image(png, { fit: [240, 240], align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(9).text(`编号：${item.id}`, { align: 'center' });
      doc.end();
      return { buffer: await done, contentType: 'application/pdf', ext: 'pdf' };
    }
    const png = await QRCode.toBuffer(payload, { width: 600, margin: 2, errorCorrectionLevel: 'M' });
    return { buffer: png, contentType: 'image/png', ext: 'png' };
  }

  async buildUnitQrCode(actor: JwtActor, unitId: number, format = 'png') {
    const unit = await this.unitRepo.findOneBy({ id: unitId });
    if (!unit) throw new NotFoundException('设备单元不存在');
    this.assertDeptAccess(actor, unit.deptId);
    const item = await this.itemRepo.findOneBy({ id: unit.itemId });
    const payload = `unit:${unit.id}`;
    if (format === 'pdf') {
      const png = await QRCode.toBuffer(payload, { width: 480, margin: 2, errorCorrectionLevel: 'M' });
      const doc = new PDFDocument({ size: 'A6', margin: 24 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
      this.applyPdfFont(doc);
      doc.fontSize(14).text(`${item?.name || '设备'} · ${unit.code} 号`, { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(10).text(`${item?.spec || ''}`.trim(), { align: 'center' });
      doc.moveDown(0.6);
      doc.image(png, { fit: [240, 240], align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(9).text(`设备编号：${unit.code}`, { align: 'center' });
      doc.end();
      return { buffer: await done, contentType: 'application/pdf', ext: 'pdf' };
    }
    const png = await QRCode.toBuffer(payload, { width: 600, margin: 2, errorCorrectionLevel: 'M' });
    return { buffer: png, contentType: 'image/png', ext: 'png' };
  }

  async buildUnitsQrCodePdf(actor: JwtActor, itemId: number) {
    const item = await this.getItem(itemId, actor);
    const units = await this.unitRepo.find({ where: { itemId: item.id }, order: { id: 'ASC' } });
    if (!units.length) throw new BadRequestException('该物品暂无单台设备');
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(Buffer.from(c)));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
    this.applyPdfFont(doc);
    const usableW = doc.page.width - 72;
    const cols = 2;
    const perPage = 8;
    const cellW = usableW / cols;
    const cellH = 200;
    const qrSize = 150;
    let idx = 0;
    for (const u of units) {
      const posInPage = idx % perPage;
      if (idx > 0 && posInPage === 0) doc.addPage();
      const col = posInPage % cols;
      const row = Math.floor(posInPage / cols);
      const x = 36 + col * cellW;
      const y = 36 + row * cellH;
      const png = await QRCode.toBuffer(`unit:${u.id}`, { width: 300, margin: 1, errorCorrectionLevel: 'M' });
      doc.image(png, x + (cellW - qrSize) / 2, y, { fit: [qrSize, qrSize] });
      doc.fontSize(11).text(`${item.name} · ${u.code} 号`, x, y + qrSize + 6, { width: cellW, align: 'center' });
      doc.fontSize(9).text(`${item.spec || ''}`.trim(), x, y + qrSize + 24, { width: cellW, align: 'center' });
      idx += 1;
    }
    doc.end();
    return { buffer: await done, contentType: 'application/pdf', ext: 'pdf' };
  }

  async createStockRecord(actor: JwtActor, dto: StockRecordDto) {
    if (dto.type === StockType.In && dto.relatedOrderId) {
      return this.createReturnRecord(actor, dto);
    }
    const lines = this.resolveStockLines(dto);
    const projectName = (dto.projectName || '').trim();
    if (!projectName) throw new BadRequestException('请填写项目名称');
    const items = await Promise.all(
      lines.map(async (line) => {
        const item = await this.itemRepo.findOneBy({ id: line.itemId });
        if (!item) throw new NotFoundException(`物品不存在：${line.itemId}`);
        return { item, quantity: line.quantity, unitIds: line.unitIds };
      }),
    );
    const deptId = items[0].item.deptId;
    if (items.some((line) => line.item.deptId !== deptId)) {
      throw new BadRequestException('一次出入库只能选择同一部门下的物品');
    }
    this.assertDeptAccess(actor, deptId);

    // 校验：单台管理的物品出库必须选具体设备，且这些设备可用
    const lineUnits = new Map<number, ItemUnitEntity[]>();
    for (const line of items) {
      if (line.item.trackIndividually && dto.type === StockType.Out) {
        if (!line.unitIds.length) {
          throw new BadRequestException(`${line.item.name} 需要选择具体设备（单台）`);
        }
        const units = await this.unitRepo.findBy({ id: In(line.unitIds) });
        if (units.length !== line.unitIds.length) {
          throw new BadRequestException(`${line.item.name} 选择的设备不存在`);
        }
        for (const u of units) {
          if (u.itemId !== line.item.id) throw new BadRequestException('设备与物品不匹配');
          if (u.retired) {
            throw new BadRequestException(`${line.item.name} ${u.code} 号已到期/停用，不能出库`);
          }
          if (u.status === ItemUnitStatus.Out) {
            throw new BadRequestException(`${line.item.name} ${u.code} 号已在外，不能重复出库`);
          }
        }
        lineUnits.set(line.item.id, units);
      } else if (!line.item.trackIndividually && dto.type === StockType.Out) {
        if (line.item.quantity < line.quantity) {
          throw new BadRequestException(`${line.item.name} 库存不足`);
        }
      }
    }

    const orderId = await this.itemRepo.manager.transaction(async (manager) => {
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
      for (const line of items) {
        const units = lineUnits.get(line.item.id);
        if (line.item.trackIndividually && dto.type === StockType.Out && units) {
          for (const u of units) {
            u.status = ItemUnitStatus.Out;
            await manager.save(ItemUnitEntity, u);
            await manager.save(
              StockOrderUnitEntity,
              manager.create(StockOrderUnitEntity, {
                orderId: order.id,
                itemId: line.item.id,
                unitId: u.id,
              }),
            );
          }
        } else {
          line.item.quantity += dto.type === StockType.In ? line.quantity : -line.quantity;
          await manager.save(ItemEntity, line.item);
        }
        await manager.save(
          StockOrderItemEntity,
          manager.create(StockOrderItemEntity, {
            orderId: order.id,
            itemId: line.item.id,
            quantity: line.quantity,
          }),
        );
      }
      return order.id;
    });
    // 出库后同步单台物品库存数量
    for (const line of items) {
      if (line.item.trackIndividually) await this.syncItemQuantity(line.item.id);
    }
    return this.getStockOrder(orderId, actor);
  }

  private async createReturnRecord(actor: JwtActor, dto: StockRecordDto) {
    const related = await this.orderRepo.findOne({
      where: { id: dto.relatedOrderId as number },
      relations: ['units', 'units.unit', 'items', 'items.item'],
    });
    if (!related) throw new NotFoundException('要归还的出库单不存在');
    if (related.type !== StockType.Out) throw new BadRequestException('只能归还出库单');
    this.assertDeptAccess(actor, related.deptId);
    if (related.completed) throw new BadRequestException('该出库单已全部归还完成');

    const outUnits = (related.units || []).filter(
      (ou) => ou.unit && ou.unit.status === ItemUnitStatus.Out,
    );
    const hasIndividual = outUnits.length > 0;
    const nonIndividualLines = (related.items || []).filter(
      (oi) => oi.item && !oi.item.trackIndividually,
    );
    if (!hasIndividual && nonIndividualLines.length === 0) {
      throw new BadRequestException('该出库单没有可归还的内容');
    }

    const projectName = (dto.projectName || related.projectName || '归还入库').trim();
    const orderId = await this.itemRepo.manager.transaction(async (manager) => {
      const order = await manager.save(
        StockOrderEntity,
        manager.create(StockOrderEntity, {
          deptId: related.deptId,
          type: StockType.In,
          projectName,
          relatedOrderId: related.id,
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
      const returnedCountByItem = new Map<number, number>();
      for (const ou of outUnits) {
        const unit = ou.unit as ItemUnitEntity;
        const item = await manager.findOneBy(ItemEntity, { id: unit.itemId });
        const overLimit =
          item && item.maxUsageMinutes && item.maxUsageMinutes > 0
            ? unit.accumulatedMinutes >= item.maxUsageMinutes
            : false;
        unit.status = ItemUnitStatus.InStock;
        if (overLimit) unit.retired = true;
        await manager.save(ItemUnitEntity, unit);
        await manager.save(
          StockOrderUnitEntity,
          manager.create(StockOrderUnitEntity, {
            orderId: order.id,
            itemId: unit.itemId,
            unitId: unit.id,
          }),
        );
        returnedCountByItem.set(unit.itemId, (returnedCountByItem.get(unit.itemId) || 0) + 1);
      }
      for (const oi of nonIndividualLines) {
        const item = await manager.findOneBy(ItemEntity, { id: oi.itemId });
        if (item) {
          item.quantity += oi.quantity;
          await manager.save(ItemEntity, item);
        }
        returnedCountByItem.set(oi.itemId, (returnedCountByItem.get(oi.itemId) || 0) + oi.quantity);
      }
      for (const [itemId, quantity] of returnedCountByItem.entries()) {
        await manager.save(
          StockOrderItemEntity,
          manager.create(StockOrderItemEntity, { orderId: order.id, itemId, quantity }),
        );
      }
      // 判断关联出库单是否还有在外的单台
      const remainingOut = (related.units || []).length
        ? await manager
            .createQueryBuilder(StockOrderUnitEntity, 'ou')
            .leftJoin(ItemUnitEntity, 'u', 'u.id = ou.unit_id')
            .where('ou.order_id = :oid', { oid: related.id })
            .andWhere('u.status = :st', { st: ItemUnitStatus.Out })
            .getCount()
        : 0;
      if (remainingOut === 0) {
        related.completed = true;
        related.completedAt = new Date();
        await manager.save(StockOrderEntity, related);
      }
      return order.id;
    });
    for (const ou of outUnits) {
      if (ou.unit) await this.syncItemQuantity(ou.unit.itemId);
    }
    return this.getStockOrder(orderId, actor);
  }

  async getStockRecordDetail(actor: JwtActor, id: number) {
    return this.getStockOrder(id, actor);
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
      await manager.delete(StockOrderUnitEntity, { orderId: id });
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
      relations: [
        'dept',
        'items',
        'items.item',
        'items.item.category',
        'units',
        'units.unit',
        'operatorUser',
      ],
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
          ? [{ itemId: dto.itemId, quantity: dto.quantity, unitIds: [] as number[] }]
          : [];
    const result: { itemId: number; quantity: number; unitIds: number[] }[] = [];
    rawLines.forEach((line: any) => {
      const itemId = Number(line.itemId);
      const unitIds = Array.isArray(line.unitIds)
        ? line.unitIds.map(Number).filter((n: number) => Number.isFinite(n) && n > 0)
        : [];
      const quantity = unitIds.length ? unitIds.length : Number(line.quantity);
      if (!Number.isFinite(itemId) || itemId <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException('请选择物品并填写正确数量');
      }
      result.push({ itemId, quantity, unitIds });
    });
    if (result.length === 0) throw new BadRequestException('请至少添加一种物品');
    return result;
  }

  private presentStockOrder(order: StockOrderEntity) {
    const lines = (order.items || []).map((line) => ({
      id: line.id,
      itemId: line.itemId,
      quantity: line.quantity,
      item: line.item,
    }));
    const unitList = (order.units || []).map((ou) => ({
      id: ou.id,
      itemId: ou.itemId,
      unitId: ou.unitId,
      code: ou.unit?.code,
      status: ou.unit?.status,
    }));
    const firstLine = lines[0];
    const unitSummary = unitList.length
      ? unitList.map((u) => `${u.code || u.unitId}号`).join('、')
      : '';
    return {
      ...order,
      items: lines,
      units: unitList,
      itemId: firstLine?.itemId,
      item: firstLine?.item,
      quantity: lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0),
      itemSummary: lines
        .map((line) => `${line.item?.name || '未知物品'} x ${line.quantity}${line.item?.unit || ''}`)
        .join('；'),
      unitSummary,
      completed: order.completed,
      statusText:
        order.type === StockType.In
          ? '入库'
          : order.completed
            ? '已完成（已归还）'
            : '出库待归还',
    };
  }

  private assertDeptAccess(actor: JwtActor, deptId: number) {
    if (actor.role === 'mini' && Number(actor.deptId) !== deptId) {
      throw new ForbiddenException('该设备属于其他部门，无权操作');
    }
    if (actor.role === 'admin' && actor.adminRole === AdminRole.Dept && Number(actor.deptId) !== deptId) {
      throw new ForbiddenException('无权操作其他部门数据');
    }
  }

  private requireSuperAdmin(actor: JwtActor) {
    if (actor.role !== 'admin' || actor.adminRole === AdminRole.Dept) {
      throw new ForbiddenException('需要超级管理员权限');
    }
  }

  private isSuperAdmin(actor: JwtActor) {
    return actor.role === 'admin' && actor.adminRole !== AdminRole.Dept;
  }

  private async forceDeleteItemHistory(itemId: number) {
    const rows = await this.orderItemRepo.findBy({ itemId });
    const orderIds = Array.from(new Set(rows.map((row) => row.orderId)));
    await this.orderUnitRepo.delete({ itemId });
    if (rows.length > 0) {
      await this.orderItemRepo.delete({ itemId });
    }
    for (const orderId of orderIds) {
      const remain = await this.orderItemRepo.countBy({ orderId });
      if (remain === 0) {
        await this.orderUnitRepo.delete({ orderId });
        await this.orderRepo.delete(orderId);
      }
    }
    await this.recordRepo.delete({ itemId });
  }

  private async forceDeleteDept(deptId: number) {
    const orderIds = (await this.orderRepo.findBy({ deptId })).map((row) => row.id);
    for (const orderId of orderIds) {
      await this.orderUnitRepo.delete({ orderId });
      await this.orderItemRepo.delete({ orderId });
    }
    await this.orderRepo.delete({ deptId });
    await this.recordRepo.delete({ deptId });
    await this.usageRepo.delete({ deptId });
    await this.unitRepo.delete({ deptId });
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
