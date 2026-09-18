# 部署指南

本文描述从空环境部署当前版本所需的最短流程。已有环境更新时，按“日常更新”执行。

## 1. 准备

需要：

- 一个 CloudBase 环境，已开通静态网站托管、云函数、SQL 型数据库和云存储
- 一个飞书企业自建应用
- Node.js 18+，仅用于本地测试和打包

当前代码默认使用：

- CloudBase 环境：`feishu-checklist-d4ejfqy436026fb`
- 静态域名：`https://feishu-checklist-d4ejfqy436026fb-1300423603.tcloudbaseapp.com`
- 私有桶：`checklist-media`

迁移到其他环境时，需要同步修改 `index.html` 的公开配置、`feishu-sign/index.js` 的 `ALLOWED_ORIGIN`，并为 `feishu-checklist-api` 设置 `FRONTEND_ORIGIN`。

## 2. 数据库

在 CloudBase SQL 控制台完整执行：

```text
cloudfunctions/feishu-card-callback/schema.sql
```

该脚本创建：

- `checklists`：清单、媒体引用和当前状态
- `callback_events`：按飞书 event_id 去重
- `create_checklist()`：创建清单 RPC
- `apply_checklist_event()`：事务更新 checker 状态 RPC

脚本使用 `create table if not exists` 和 `create or replace function`，升级时可以重新完整执行。

## 3. 云存储与匿名登录

1. 在“身份认证 / 登录方式”启用匿名登录。
2. 创建私有桶 `checklist-media`。
3. 单文件上限至少设置为 30 MB，允许 JPG、PNG、WebP 和 MP4。
4. 将静态托管域名加入 CloudBase 安全域名。
5. 为匿名用户配置 `storage.objects` 的 INSERT 和 SELECT 权限。
6. 两项策略都必须限制 `owner_id = (SELECT auth.jwt()->>'sub')`，确保用户只能写入和读取自己的对象。

匿名登录只用于浏览器访问私有云存储；飞书用户身份仍由 `requestAuthCode` 和 `feishu-checklist-api` 单独验证。

## 4. 打包云函数

在项目根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-functions.ps1
```

生成：

```text
dist/feishu-sign.zip
dist/feishu-checklist-api.zip
dist/feishu-card-callback.zip
```

使用 Node.js 18+ 运行时。上传 ZIP 时不要再套一层目录，入口均为 `index.main`。

## 5. 云函数配置

### feishu-sign

- 公开 HTTP 访问
- 方法：GET、OPTIONS
- 建议超时：10 秒
- 建议内存：256 MB
- 环境变量：`FEISHU_APP_ID`、`FEISHU_APP_SECRET`

### feishu-checklist-api

- 公开 HTTP 访问
- 方法：POST、OPTIONS
- 超时：至少 60 秒，不能设置为 3 秒
- 建议内存：512 MB
- 环境变量：
  - `FEISHU_APP_ID`
  - `FEISHU_APP_SECRET`
  - `CLOUDBASE_ENV_ID`
  - `FRONTEND_ORIGIN`：静态网站 HTTPS origin，不带结尾 `/`
  - `CLOUDBASE_APIKEY`：优先使用 CloudBase 官方注入值；代码仅为旧环境兼容 `CLOUDBASE_API_KEY`

这个函数需要下载媒体并上传飞书。3 秒配置会在日志中出现 `Invoking task timed out after 3 seconds`，手机照片通常必定失败。

### feishu-card-callback

- 公开 HTTP 访问
- 方法：POST
- 超时：3 秒
- 建议内存：256 MB
- 环境变量：
  - `FEISHU_APP_ID`
  - `FEISHU_VERIFICATION_TOKEN`
  - `FEISHU_ENCRYPT_KEY`
  - `CLOUDBASE_ENV_ID`
  - `CLOUDBASE_APIKEY`

3 秒是飞书卡片回调响应要求，只适用于 callback，不适用于媒体 API。

## 6. 静态页面

确认 `index.html` 中：

- `cloudbaseEnvId`、`cloudbaseRegion` 和 `cloudbaseBucket` 指向当前环境
- `cloudbaseAccessKey` 使用 CloudBase Publishable Key
- `signEndpoint`、`apiEndpoint` 指向已部署函数
- `app.js?v=...` 的版本号在更新 app.js 时同步递增

将 `index.html` 和 `app.js` 上传到静态托管根目录。访问页面源码确认线上 `app.js?v=` 已更新，避免缓存导致前后端版本不一致。

## 7. 飞书应用

1. 启用网页应用能力，页面地址设置为 CloudBase 静态 HTTPS 地址。
2. 配置聊天框“+”菜单入口，使用侧边栏模式。
3. 开通 H5 JSAPI：`requestAuthCode`、`getTriggerContext`、`sendMessageCard`。
4. 添加机器人能力；上传图片和视频到飞书消息资源需要机器人能力。
5. 配置卡片回调 URL 为 `feishu-card-callback` 的公开地址。
6. 订阅新版事件 `card.action.trigger`。
7. 将 Verification Token 和 Encrypt Key 写入 callback 云函数环境变量。
8. 创建版本、设置测试可用范围并发布。

## 8. 验收

按顺序验证：

1. 从 A 与 B 的私聊“+”菜单打开应用，页面显示“当前会话已连接”。
2. 电脑和手机各上传一张图片，进度依次经过云存储和飞书处理。
3. 上传一个小型 MP4，确认卡片可以播放。
4. 发送两项清单，确认卡片进入当前 A-B 会话。
5. A、B 分别勾选和取消，双方卡片状态同步。
6. 查看 callback 日志，调用耗时应小于 3 秒。
7. 查看 API 日志，媒体请求不得出现 3000 ms 超时。

## 日常更新

- 只修改 `app.js`/`index.html`：递增 `app.js?v=`，重新上传这两个文件。
- 修改某个云函数：重新运行打包脚本，只上传对应 ZIP；环境变量不会写入 ZIP。
- 修改 `schema.sql`：在 SQL 控制台重新完整执行。
- 修改飞书权限、能力或事件订阅：必须重新发布飞书应用版本。
