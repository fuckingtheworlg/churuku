# Churuku 出入库系统

包含三端：

- `backend/`：NestJS + TypeORM + MySQL，统一接口前缀 `/api`。
- `admin/`：Vue 3 + Element Plus 管理后台。
- `miniprogram/`：微信原生小程序，AppId `wx820061268d79319d`。

## 本地启动

1. 创建 MySQL 数据库：

```sql
CREATE DATABASE churuku DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

2. 配置后端环境：

```bash
cd backend
cp .env.example .env
```

按本机 MySQL 修改 `.env`，并填写 `WX_APPSECRET`。开发期如果暂时不填微信密钥，可用 `code=dev:任意openid` 调后端接口调试。
PDF 导出中文需要字体，macOS 可使用 `.env.example` 里的 `PDF_FONT_PATH=/Library/Fonts/Arial Unicode.ttf`；如果机器没有该字体，改成任意支持中文的 `.ttf/.ttc` 路径。

3. 启动后端：

```bash
cd backend
npm install
npm run start:dev
```

后端启动后会自动建表，并创建默认管理员 `admin / admin123`。

4. 启动后台：

```bash
cd admin
npm install
npm run dev
```

登录后台后，先创建部门、库存类目和物品，再审批小程序用户。

5. 打开小程序：

用微信开发者工具导入项目根目录 `churuku/`，或直接导入 `miniprogram/`，AppId 使用 `wx820061268d79319d`。开发环境可在详情里关闭合法域名校验；上线时需要在微信公众平台配置后端域名为 request/upload 合法域名。

## 功能范围

- 管理后台：部门、用户审批、类目、物品库存、出入库记录、图片/签字查看、位置外链、PDF/Word/Excel 导出、修改密码。
- 小程序：微信登录、注册审批、库存列表、物品详情、出入库提交、`wx.chooseLocation` 定位、拍照上传、手写签字。
- 后端：管理员 JWT、小程序 JWT、部门隔离、出库库存校验、上传静态资源 `/uploads`。

## 注意

- `backend/.env` 不应提交仓库，里面包含 AppSecret 和数据库密码。
- 小程序定位使用 `wx.chooseLocation`，已在 `app.json` 中声明 `requiredPrivateInfos`。
- 管理后台默认展示文字位置和经纬度，并提供腾讯地图外链，不需要 Web 地图 Key。
