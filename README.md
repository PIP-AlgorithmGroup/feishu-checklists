# 飞书多媒体检查清单

企业自建飞书应用。发送方从当前会话的“+”菜单打开侧栏编辑器，创建带图片或 MP4 视频的检查清单并发送卡片；会话成员可以直接勾选或取消，数据库保存权威状态并同步刷新卡片。

## 当前能力

- 批量录入、逐项编辑、删除和上下排序，最多 50 项，每项最多 500 字
- Enter 换行，Shift+Enter 新建事项
- 每项最多 3 张图片和 3 个 MP4 视频
- 选择或粘贴多个媒体文件，每个文件独立显示上传进度
- JPG、PNG、WebP 图片上限 5 MB；原图不超过 20 MB 时可自动压缩
- MP4 视频上限 30 MB
- 手机和电脑通过文件选择器上传；剪贴板上传取决于当前飞书 WebView 是否暴露文件数据
- Card JSON 2.0 checker，支持双向勾选、取消和跨设备刷新
- 回调验签/解密、消息与会话绑定、event_id 幂等
- 媒体保存在 CloudBase 私有云存储，并转存到飞书取得 image_key/file_key

尚未实现：历史清单、复制重用、14 天后重新发送、孤立云存储对象自动清理。

## 数据流

```text
飞书会话“+”菜单
  -> CloudBase 静态托管 H5
  -> feishu-sign：生成 H5 JSAPI 签名
  -> feishu-checklist-api：用户鉴权、媒体转存、创建清单
  -> tt.sendMessageCard：发送到当前会话
  -> feishu-card-callback：处理 card.action.trigger
  -> CloudBase PostgreSQL：保存清单和幂等事件
```

媒体不会以 Base64 进入 API：

```text
浏览器 -> CloudBase 私有存储 -> 临时下载 URL
       -> feishu-checklist-api -> 飞书媒体接口
```

## 目录

```text
index.html                         静态页面、样式和公开配置
app.js                             编辑器、CloudBase 上传和飞书 JSAPI
cloudfunctions/feishu-sign/        H5 JSAPI 签名
cloudfunctions/feishu-checklist-api/ 用户会话、媒体登记和清单创建
cloudfunctions/feishu-card-callback/ 卡片回调、渲染和数据库 SQL
scripts/build-functions.ps1       生成三个云函数部署 ZIP
test/                              前端、样式和跨模块契约测试
docs/DEPLOYMENT.md                 部署流程
docs/TROUBLESHOOTING.md            踩坑、限制和排障依据
```

## 开发验证

需要 Node.js 18 或更高版本。项目运行代码没有第三方 npm 依赖。

```powershell
node --test
node --check app.js
node --check cloudfunctions/feishu-sign/index.js
node --check cloudfunctions/feishu-checklist-api/index.js
node --check cloudfunctions/feishu-card-callback/index.js
```

生成部署包：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-functions.ps1
```

产物位于 `dist/`，ZIP 内的 `index.js` 位于根目录。

## 部署与排障

- 首次部署或迁移环境：阅读 [部署指南](docs/DEPLOYMENT.md)
- 上传、鉴权、回调或缓存异常：阅读 [踩坑与排障](docs/TROUBLESHOOTING.md)

## 安全边界

- `App Secret`、Verification Token、Encrypt Key 和服务端 CloudBase API Key 只存在云函数环境变量中。
- `index.html` 中的 CloudBase Publishable Key 是浏览器公开凭证，不等同于服务端 `CLOUDBASE_APIKEY`。
- 云存储桶必须是私有桶，并通过 owner_id 策略限制匿名会话只能访问自己的文件。
- 下载 URL 必须属于当前 CloudBase 环境，且对象路径必须与 fileId 完全一致。
