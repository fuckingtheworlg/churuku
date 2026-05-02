import { Transform } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { StockType, UserStatus } from './entities';

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

export class UserStatusDto {
  @IsEnum(UserStatus)
  status: UserStatus;
}

export class CategoryDto {
  @IsInt()
  @Transform(({ value }) => Number(value))
  deptId: number;

  @IsString()
  name: string;

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
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  image?: string;
}

export class StockRecordDto {
  @IsInt()
  @Transform(({ value }) => Number(value))
  itemId: number;

  @IsEnum(StockType)
  type: StockType;

  @IsInt()
  @Min(1)
  @Transform(({ value }) => Number(value))
  quantity: number;

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
  type?: StockType;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  startDate?: string;

  @IsOptional()
  endDate?: string;
}

export class UploadMarkerDto {
  @IsOptional()
  @IsNotEmpty()
  marker?: string;
}
