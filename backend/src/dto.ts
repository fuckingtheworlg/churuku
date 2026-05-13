import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { AdminRole, StockType, UserStatus } from './entities';

export class LoginDto {
  @IsString()
  username: string;

  @IsString()
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  oldPassword: string;

  @IsString()
  newPassword: string;
}

export class WxLoginDto {
  @IsString()
  code: string;

  @IsOptional()
  @IsString()
  nickname?: string;

  @IsOptional()
  @IsString()
  avatar?: string;
}

export class WxRegisterDto {
  @IsString()
  code: string;

  @IsString()
  realName: string;

  @IsInt()
  @Transform(({ value }) => Number(value))
  deptId: number;

  @IsOptional()
  @IsString()
  nickname?: string;

  @IsOptional()
  @IsString()
  avatar?: string;
}

export class DeptDto {
  @IsString()
  name: string;

  @IsString()
  code: string;
}

export class AdminAccountDto {
  @IsString()
  username: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsEnum(AdminRole)
  role: AdminRole;

  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  deptId?: number;
}

export class UserStatusDto {
  @IsEnum(UserStatus)
  status: UserStatus;
}

export class GlobalCategoryDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsInt()
  @Transform(({ value }) => Number(value))
  sort?: number;
}

export class CategoryDto {
  @IsInt()
  @Transform(({ value }) => Number(value))
  deptId: number;

  @IsString()
  name: string;

  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  globalCategoryId?: number;

  @IsOptional()
  @IsInt()
  @Transform(({ value }) => Number(value))
  sort?: number;
}

export class ItemDto {
  @IsInt()
  @Transform(({ value }) => Number(value))
  deptId: number;

  @IsOptional()
  @IsInt()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  categoryId?: number;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  spec?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) =>
    value === undefined || value === null || value === '' ? undefined : Number(value),
  )
  quantity?: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  image?: string;
}

export class StockRecordItemDto {
  @IsInt()
  @Transform(({ value }) => Number(value))
  itemId: number;

  @IsInt()
  @Min(1)
  @Transform(({ value }) => Number(value))
  quantity: number;
}

export class StockRecordDto {
  @IsOptional()
  @IsInt()
  @Transform(({ value }) => Number(value))
  itemId?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockRecordItemDto)
  items?: StockRecordItemDto[];

  @IsEnum(StockType)
  type: StockType;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => Number(value))
  quantity?: number;

  @IsString()
  projectName: string;

  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  longitude?: number;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  poiName?: string;

  @IsOptional()
  @IsArray()
  photos?: string[];

  @IsOptional()
  @IsString()
  signatureUrl?: string;

  @IsDateString()
  occurredAt: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class PageQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  pageSize?: number;

  @IsOptional()
  keyword?: string;

  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  deptId?: number;

  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  categoryId?: number;

  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  itemId?: number;

  @IsOptional()
  type?: StockType;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  startDate?: string;

  @IsOptional()
  endDate?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  mine?: boolean;
}

export class UploadMarkerDto {
  @IsOptional()
  @IsNotEmpty()
  marker?: string;
}
