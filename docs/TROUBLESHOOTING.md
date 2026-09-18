# 踩坑与排障

本文记录本项目开发中已经实际遇到的问题，以及不能从代码表面直接看出的平台限制。

## 先定位失败阶段

媒体上传分成两段：

1. 浏览器将文件直传 CloudBase 私有存储。
2. `feishu-checklist-api` 下载该对象并上传飞书。

界面显示“上传云存储失败”时检查 CloudBase SDK、匿名登录、存储策略和安全域名；显示“媒体登记连接被中断”或“同步到飞书”失败时检查 API 云函数日志、执行时限和飞书接口。

## 部署与版本

### 身份服务返回的会话信息无效

新版前端需要 API 同时返回 `sessionToken` 和 `expiresAt`。只更新静态页面、未更新 `feishu-checklist-api` 时就会出现该提示。

处理：重新部署完整 API ZIP，并关闭侧栏后从“+”菜单重新打开。

### 页面仍运行旧代码

CloudBase 静态托管和飞书 WebView 都可能缓存 `app.js`。每次修改前端必须递增 `index.html` 中的 `app.js?v=`，并通过线上页面源码确认版本。

### ZIP 上传后找不到入口

ZIP 根目录必须直接包含 `index.js`，不能包含同名外层文件夹。使用 `scripts/build-functions.ps1` 生成，不要手工压缩整个目录。

### CLOUDBASE_APIKEY 与 Publishable Key 混淆

- `CLOUDBASE_APIKEY`：服务端数据库 RPC 凭证，优先使用 CloudBase 官方注入变量。
- `cloudbaseAccessKey`：浏览器可见的 Publishable Key，用于 CloudBase Web SDK。

两者用途和权限完全不同。服务端代码兼容旧名 `CLOUDBASE_API_KEY`，新部署使用官方无下划线名称。

## CloudBase Web SDK 与云存储

### 必须启用匿名登录

浏览器直传私有桶需要 CloudBase 身份。匿名登录提供 owner_id，使存储策略可以约束“只能访问自己的文件”；它不会替代飞书用户鉴权。

### SDK 2.x 的 getSession null-scope 异常

旧版 SDK 在未登录时调用 `getSession()` 可能读取 null.scope。当前固定使用 CloudBase JS SDK 3.8.2，并优先调用 `hasLoginState()` 后再匿名登录。

### v3 签名上传不是裸 PUT

`createSignedUploadUrl()` 可能分别返回 `fullSignedURL` 和 `token`。必须将 token 放回查询参数，并使用 multipart FormData：

- `contentType` 字段保存 MIME
- 空字段名保存文件本体

直接 PUT 原始二进制会失败。

### 上传 URL 出现重复路径

部分 SDK 返回 `/v1/storages/v1/storages/...`。前端会归一化为单个 `/v1/storages/...`；删除这段兼容代码会恢复 404/鉴权错误。

### info().data.id 不是 cloud:// fileId

新版 SDK 的 `info()` 可能返回内部对象 ID。下载签名必须使用对象路径；持久化 fileId 则按 `cloud://环境.桶/对象路径` 构造。不能把内部 ID 直接传给 `createSignedUrl()`。

### 新旧下载域名不同

除旧的 `tcb.qcloud.la`、`tcloudbaseapp.com` 和 `myqcloud.com` 外，新版下载签名可能使用：

```text
环境ID.api.tcloudbasegateway.com
```

后端只允许当前环境的新网关域名，并要求下载 URL 的对象路径与 fileId 完全一致。

### Base64 请求体方案不可用

早期方案把图片转 Base64 发送云函数，受到 HTTP 请求体限制，约 100 KB 就可能失败。当前方案必须先直传 CloudBase，再向 API 发送短 fileId 和临时 URL。

### 已上传对象没有自动清理

当前删除编辑器中的媒体、转存飞书失败或放弃发送时，不会删除 CloudBase 对象。增加自动清理前必须同时设计 DELETE 存储策略和失败补偿，不能只在前端随意调用删除。

## 媒体限制与超时

### 手机显示“媒体登记连接被中断”

真实日志已确认一种根因：`feishu-checklist-api` 在 3000 ms 被 CloudBase 强制终止，状态 433，日志为：

```text
Invoking task timed out after 3 seconds
```

处理：API 超时至少 60 秒、内存建议 512 MB。`feishu-card-callback` 才需要 3 秒内完成，不能把这个限制套到媒体 API。

### 文件明明小于限制仍失败

文件大小只是第一层检查。还需要：

- 声明 MIME 为 JPG/PNG/WebP/MP4
- 文件签名与 MIME 一致
- 下载 URL 未过期且与 fileId 对应
- 云函数有足够时间完成下载和飞书上传
- 飞书应用已启用机器人能力

后端会再次校验实际内容和下载后的字节数。

### 当前体积限制

- 图片最终上传体积：5 MB
- 可尝试自动压缩的原图：20 MB
- MP4：30 MB，不自动压缩
- 飞书客户端卡片 JSON：20 KB
- 每项：最多 3 张图片、3 个视频

分包上传不能绕过飞书媒体接口的单文件限制，也不能解决云函数必须重新组装完整文件的问题。

### 多文件上传进度

每个文件有独立任务。0-86% 主要表示压缩和 CloudBase 上传，86-100% 表示 API 下载并转存飞书；第二段无法获得飞书服务端的细粒度字节进度，所以只显示阶段进度。

### 手机剪贴板限制

网页只能读取 WebView 在 paste 事件中暴露的文件。桌面截图通常可直接粘贴；手机飞书不一定向网页提供图片/视频剪贴板数据，因此手机以系统文件选择器为可靠入口。

## 飞书鉴权与卡片

### 未鉴权时媒体已经上传

旧实现允许会话鉴权完成前上传，导致文件进入 CloudBase 后 API 返回“身份凭证无效”。当前上传按钮和粘贴入口都会等待飞书短期会话，且在会话到期前自动续签。

### 飞书应用未启用机器人能力

即使卡片由 H5 JSAPI 发送，图片和视频仍通过飞书 IM 媒体接口上传，该接口要求应用具备机器人能力。添加能力后必须发布新版本。

### Enter 与 Shift+Enter

当前约定：Enter 在事项内换行，Shift+Enter 拆分并新建下一项。批量粘贴纯文本时，每个非空行创建一项。

### 侧栏宽度和默认域名提示

侧栏宽度由飞书客户端控制，H5 无法强制拉宽。CloudBase 默认域名的访问提示也不能由页面代码移除；需要自定义域名时才可改变该体验。

### 卡片禁止转发

数据库在第一次回调时绑定 open_message_id 和 open_chat_id。所有清单卡片都关闭转发，避免首次勾选发生在其他会话而错误绑定。

## 回调与数据库

### checker 必须写绝对状态

使用 `action.checked` 的布尔值更新数据库，不能执行“当前值取反”。飞书重试或重复事件会让取反逻辑产生错误状态。

### event_id 必须幂等

`callback_events.event_id` 是主键。重复事件返回数据库当前快照，不再次修改事项。

### 回调只有 3 秒

`feishu-card-callback` 只执行解析、校验和一次数据库 RPC，必须在 3 秒内返回完整卡片。媒体下载和上传绝不能放到 callback 中。

### CloudBase 网关可能剥离签名头

启用 Encrypt Key 后，网关可能不转发三个飞书签名请求头。当前逻辑在三个头全部缺失时只接受加密 payload 并解密；部分缺失或无签名明文一律拒绝。

### 未知清单不能自动创建

早期 tracer 逻辑会在回调时创建测试清单，容易掩盖部署和数据问题。当前 SQL 对未知 checklist_id 明确报错，并同时校验消息 ID 与会话 ID。

### 双向更新依赖 update_multi

发送卡片时外层 `cardContent.update_multi` 必须为 true；回调重绘的卡片 config 也必须保留 `update_multi: true`。否则可能只有操作者看到更新。

## 排障顺序

1. 先看界面失败阶段和完整错误文字。
2. 确认线上 `app.js?v=` 与本地一致。
3. 查看对应云函数日志的 Request ID、状态、Duration 和 Return Msg。
4. 上传云存储失败时检查匿名登录、owner_id 策略和安全域名。
5. 媒体登记失败时检查 API 超时、内存、机器人能力和飞书返回信息。
6. checker 不刷新时检查 callback 日志、事件订阅、Encrypt Key 和 SQL RPC。
7. 修改云函数后重新上传对应 ZIP；修改飞书权限或订阅后重新发布应用版本。
