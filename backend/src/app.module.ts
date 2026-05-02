import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { AppController } from './controllers';
import {
  AdminEntity,
  DeptEntity,
  ItemCategoryEntity,
  ItemEntity,
  StockRecordEntity,
  UserEntity,
  entities,
} from './entities';
import { AppService } from './services';
import { AdminGuard, MiniGuard } from './support';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') || 'dev-secret',
        signOptions: { expiresIn: '30d' },
      }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql',
        host: config.get<string>('MYSQL_HOST') || '127.0.0.1',
        port: Number(config.get<string>('MYSQL_PORT') || 3306),
        username: config.get<string>('MYSQL_USER') || 'root',
        password: config.get<string>('MYSQL_PASSWORD') || '',
        database: config.get<string>('MYSQL_DATABASE') || 'churuku',
        entities,
        synchronize: true,
        timezone: '+08:00',
      }),
    }),
    TypeOrmModule.forFeature([
      AdminEntity,
      DeptEntity,
      UserEntity,
      ItemCategoryEntity,
      ItemEntity,
      StockRecordEntity,
    ]),
  ],
  controllers: [AppController],
  providers: [AppService, AdminGuard, MiniGuard],
})
export class AppModule implements OnApplicationBootstrap {
  constructor(private readonly service: AppService) {}

  async onApplicationBootstrap() {
    await this.service.seedAdmin();
  }
}
