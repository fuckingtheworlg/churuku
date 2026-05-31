import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum UserStatus {
  Pending = 'pending',
  Active = 'active',
  Disabled = 'disabled',
}

export enum StockType {
  In = 'in',
  Out = 'out',
}

export enum AdminRole {
  Super = 'super',
  Dept = 'dept',
}

export enum ItemUnitStatus {
  InStock = 'in_stock',
  Out = 'out',
  Retired = 'retired',
}

@Entity('dept')
export class DeptEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Index({ unique: true })
  @Column()
  code: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('admin')
export class AdminEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column()
  username: string;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({ name: 'must_change_password', default: true })
  mustChangePassword: boolean;

  @Column({ type: 'enum', enum: AdminRole, default: AdminRole.Super })
  role: AdminRole;

  @Column({ name: 'dept_id', nullable: true })
  deptId?: number;

  @ManyToOne(() => DeptEntity, { nullable: true, createForeignKeyConstraints: false })
  @JoinColumn({ name: 'dept_id' })
  dept?: DeptEntity;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('global_item_category')
export class GlobalItemCategoryEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column()
  name: string;

  @Column({ default: 0 })
  sort: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('user')
export class UserEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column()
  openid: string;

  @Column({ nullable: true })
  nickname?: string;

  @Column({ nullable: true })
  avatar?: string;

  @Column({ name: 'real_name' })
  realName: string;

  @Column({ name: 'dept_id' })
  deptId: number;

  @ManyToOne(() => DeptEntity, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'dept_id' })
  dept?: DeptEntity;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.Pending })
  status: UserStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'approved_at', type: 'datetime', nullable: true })
  approvedAt?: Date;
}

@Entity('item_category')
export class ItemCategoryEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'dept_id' })
  deptId: number;

  @ManyToOne(() => DeptEntity, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'dept_id' })
  dept?: DeptEntity;

  @Column({ name: 'global_category_id', nullable: true })
  globalCategoryId?: number | null;

  @ManyToOne(() => GlobalItemCategoryEntity, {
    nullable: true,
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'global_category_id' })
  globalCategory?: GlobalItemCategoryEntity;

  @Column()
  name: string;

  @Column({ default: 0 })
  sort: number;
}

@Entity('item')
export class ItemEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'dept_id' })
  deptId: number;

  @ManyToOne(() => DeptEntity, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'dept_id' })
  dept?: DeptEntity;

  @Column({ name: 'category_id', nullable: true })
  categoryId?: number;

  @ManyToOne(() => ItemCategoryEntity, {
    nullable: true,
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'category_id' })
  category?: ItemCategoryEntity;

  @Column()
  name: string;

  @Column({ nullable: true })
  spec?: string;

  @Column({ default: '件' })
  unit: string;

  @Column({ nullable: true })
  location?: string;

  @Column({ default: 0 })
  quantity: number;

  @Column({ name: 'track_individually', default: false })
  trackIndividually: boolean;

  @Column({ name: 'max_usage_minutes', type: 'int', nullable: true })
  maxUsageMinutes?: number | null;

  @Column({ nullable: true })
  note?: string;

  @Column({ nullable: true })
  image?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

@Entity('item_unit')
export class ItemUnitEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'dept_id' })
  deptId: number;

  @Column({ name: 'item_id' })
  itemId: number;

  @ManyToOne(() => ItemEntity, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'item_id' })
  item?: ItemEntity;

  @Column()
  code: string;

  @Column({ type: 'enum', enum: ItemUnitStatus, default: ItemUnitStatus.InStock })
  status: ItemUnitStatus;

  @Column({ name: 'accumulated_minutes', type: 'int', default: 0 })
  accumulatedMinutes: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('stock_record')
export class StockRecordEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'dept_id' })
  deptId: number;

  @ManyToOne(() => DeptEntity, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'dept_id' })
  dept?: DeptEntity;

  @Column({ name: 'item_id' })
  itemId: number;

  @ManyToOne(() => ItemEntity, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'item_id' })
  item?: ItemEntity;

  @Column({ type: 'enum', enum: StockType })
  type: StockType;

  @Column()
  quantity: number;

  @Column({ name: 'operator_user_id', nullable: true })
  operatorUserId?: number;

  @ManyToOne(() => UserEntity, {
    nullable: true,
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'operator_user_id' })
  operatorUser?: UserEntity;

  @Column({ name: 'operator_name', nullable: true })
  operatorName?: string;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  latitude?: string;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  longitude?: string;

  @Column({ nullable: true })
  address?: string;

  @Column({ name: 'poi_name', nullable: true })
  poiName?: string;

  @Column({ type: 'json', nullable: true })
  photos?: string[];

  @Column({ name: 'signature_url', nullable: true })
  signatureUrl?: string;

  @Column({ name: 'occurred_at', type: 'datetime' })
  occurredAt: Date;

  @Column({ nullable: true })
  note?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('stock_order')
export class StockOrderEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'dept_id' })
  deptId: number;

  @ManyToOne(() => DeptEntity, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'dept_id' })
  dept?: DeptEntity;

  @Column({ type: 'enum', enum: StockType })
  type: StockType;

  @Column({ name: 'project_name', nullable: true })
  projectName?: string;

  @Column({ name: 'operator_user_id', nullable: true })
  operatorUserId?: number;

  @ManyToOne(() => UserEntity, {
    nullable: true,
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'operator_user_id' })
  operatorUser?: UserEntity;

  @Column({ name: 'operator_admin_id', nullable: true })
  operatorAdminId?: number;

  @ManyToOne(() => AdminEntity, {
    nullable: true,
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'operator_admin_id' })
  operatorAdmin?: AdminEntity;

  @Column({ name: 'operator_name', nullable: true })
  operatorName?: string;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  latitude?: string;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  longitude?: string;

  @Column({ nullable: true })
  address?: string;

  @Column({ name: 'poi_name', nullable: true })
  poiName?: string;

  @Column({ type: 'json', nullable: true })
  photos?: string[];

  @Column({ name: 'signature_url', nullable: true })
  signatureUrl?: string;

  @Column({ name: 'occurred_at', type: 'datetime' })
  occurredAt: Date;

  @Column({ nullable: true })
  note?: string;

  @Column({ name: 'legacy_record_id', nullable: true })
  legacyRecordId?: number;

  @Column({ default: false })
  completed: boolean;

  @Column({ name: 'completed_at', type: 'datetime', nullable: true })
  completedAt?: Date | null;

  @Column({ name: 'related_order_id', nullable: true })
  relatedOrderId?: number | null;

  @OneToMany(() => StockOrderItemEntity, (item) => item.order)
  items?: StockOrderItemEntity[];

  @OneToMany(() => StockOrderUnitEntity, (unit) => unit.order)
  units?: StockOrderUnitEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('stock_order_unit')
export class StockOrderUnitEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'order_id' })
  orderId: number;

  @ManyToOne(() => StockOrderEntity, (order) => order.units, {
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'order_id' })
  order?: StockOrderEntity;

  @Column({ name: 'item_id' })
  itemId: number;

  @Column({ name: 'unit_id' })
  unitId: number;

  @ManyToOne(() => ItemUnitEntity, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'unit_id' })
  unit?: ItemUnitEntity;
}

@Entity('stock_order_item')
export class StockOrderItemEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'order_id' })
  orderId: number;

  @ManyToOne(() => StockOrderEntity, (order) => order.items, {
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'order_id' })
  order?: StockOrderEntity;

  @Column({ name: 'item_id' })
  itemId: number;

  @ManyToOne(() => ItemEntity, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'item_id' })
  item?: ItemEntity;

  @Column()
  quantity: number;
}

@Entity('equipment_usage')
export class EquipmentUsageEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'dept_id' })
  deptId: number;

  @ManyToOne(() => DeptEntity, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'dept_id' })
  dept?: DeptEntity;

  @Column({ name: 'item_id' })
  itemId: number;

  @ManyToOne(() => ItemEntity, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'item_id' })
  item?: ItemEntity;

  @Column({ name: 'unit_id', nullable: true })
  unitId?: number | null;

  @ManyToOne(() => ItemUnitEntity, {
    nullable: true,
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'unit_id' })
  unit?: ItemUnitEntity;

  @Column({ name: 'operator_user_id', nullable: true })
  operatorUserId?: number;

  @ManyToOne(() => UserEntity, {
    nullable: true,
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'operator_user_id' })
  operatorUser?: UserEntity;

  @Column({ name: 'operator_name', nullable: true })
  operatorName?: string;

  @Column({ name: 'started_at', type: 'datetime' })
  startedAt: Date;

  @Column({ name: 'ended_at', type: 'datetime', nullable: true })
  endedAt?: Date | null;

  @Column({ name: 'duration_minutes', type: 'int', nullable: true })
  durationMinutes?: number | null;

  @Column({ nullable: true })
  note?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

export const entities = [
  AdminEntity,
  DeptEntity,
  GlobalItemCategoryEntity,
  UserEntity,
  ItemCategoryEntity,
  ItemEntity,
  ItemUnitEntity,
  StockRecordEntity,
  StockOrderEntity,
  StockOrderItemEntity,
  StockOrderUnitEntity,
  EquipmentUsageEntity,
];
