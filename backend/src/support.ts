import {
  ArgumentsHost,
  BadRequestException,
  CallHandler,
  CanActivate,
  Catch,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Request, Response } from 'express';
import { Observable, map } from 'rxjs';
import { Repository } from 'typeorm';
import { AdminEntity, UserEntity, UserStatus } from './entities';

export type ActorRole = 'admin' | 'mini';

export interface JwtActor {
  role: ActorRole;
  id: number;
  deptId?: number;
  username?: string;
  realName?: string;
}

export interface AuthedRequest extends Request {
  actor?: JwtActor;
}

export class PageDto {
  page?: number = 1;
  pageSize?: number = 20;
}

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => ({
        code: 0,
        msg: 'ok',
        data,
      })),
    );
  }
}

@Catch()
export class HttpExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const detail =
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: '服务异常' };
    const message =
      typeof detail === 'string'
        ? detail
        : Array.isArray((detail as any).message)
          ? (detail as any).message.join('；')
          : (detail as any).message || '服务异常';

    response.status(status).json({
      code: status,
      msg: message,
      data: null,
    });
  }
}

function parseBearerToken(req: Request) {
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) {
    throw new UnauthorizedException('未登录');
  }
  return authorization.slice(7);
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(AdminEntity)
    private readonly adminRepo: Repository<AdminEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const payload = await this.jwt.verifyAsync<JwtActor>(parseBearerToken(req));
    if (payload.role !== 'admin') {
      throw new UnauthorizedException('需要管理员权限');
    }
    const admin = await this.adminRepo.findOneBy({ id: payload.id });
    if (!admin) {
      throw new UnauthorizedException('管理员不存在');
    }
    req.actor = payload;
    return true;
  }
}

@Injectable()
export class MiniGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const payload = await this.jwt.verifyAsync<JwtActor>(parseBearerToken(req));
    if (payload.role !== 'mini' || !payload.deptId) {
      throw new UnauthorizedException('需要小程序登录');
    }
    const user = await this.userRepo.findOneBy({ id: payload.id });
    if (!user || user.status !== UserStatus.Active) {
      throw new UnauthorizedException('用户未审批或已禁用');
    }
    req.actor = payload;
    return true;
  }
}

export function requireActor(req: AuthedRequest) {
  if (!req.actor) {
    throw new UnauthorizedException('未登录');
  }
  return req.actor;
}

export function resolveDeptId(actor: JwtActor, deptId?: number | string) {
  if (actor.role === 'mini') {
    return Number(actor.deptId);
  }
  const value = Number(deptId || 0);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function requireDeptId(actor: JwtActor, deptId?: number | string) {
  const value = resolveDeptId(actor, deptId);
  if (!value) {
    throw new BadRequestException('请选择部门');
  }
  return value;
}

export function takePage(query: PageDto) {
  const page = Math.max(Number(query.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(query.pageSize || 20), 1), 100);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
