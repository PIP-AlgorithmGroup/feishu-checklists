# 飞书多媒体检查清单：妙搭迁移

`develop/miaoda-migration` 是当前项目的妙搭 `full_stack` 本地工程，关联妙搭应用 `app_17eebbe30dh`。原 CloudBase 版本保存在 `develop/cloudbase-backend`，`main` 未改动。当前只有平台脚手架和待移植的业务契约，**尚不能替代线上应用**，不要直接切换现有飞书入口。

## 保留的业务契约

- `src/checklist.js`：最多 50 项、每项 500 字、每项最多 3 张图片和 3 个视频的服务端校验与规范化。
- `src/card.js`：Card JSON 2.0 checker、图片缩略图、视频和 `update_multi` 的发送与回调渲染。
- `src/callback.js`：飞书回调验签、解密、事件解析，以及通过 `repository.apply(event)` 更新后返回卡片。幂等、消息与会话绑定必须由未来的事务仓储实现。
- `src/auth.js`、`src/sign.js`：飞书授权码交换、短期会话、H5 JSAPI 签名和页面来源校验。
- `src/media.js`：图片与 MP4 文件签名、体积校验和飞书媒体上传。文件读取与所有权校验尚未接入。
- `src/editor.js`：批量录入、排序、快捷键、剪贴板媒体和会话启动参数的纯规则。

运行 `node --test` 验证当前保留的跨平台契约。平台工程使用 `npm run type:check`、`npm run build` 和 `npm run lint`。原侧栏 UI、图片压缩和上传进度实现仍可从 CloudBase 分支取用，但尚未迁入妙搭工程。

## 迁移接入顺序

1. 在当前工程中阅读 `.agents/skills/` 中相关数据库、文件、鉴权和插件指引；不要猜造 SDK 或路由合同。
2. 将 `src/` 的纯逻辑和测试移入妙搭工程，在其实际 router/bootstrap 中接入页面和 API。保留飞书企业自建应用、机器人、网页应用侧栏、JSAPI 权限及 `card.action.trigger` 订阅。
3. 用妙搭数据库重建清单与事件表、事务、`event_id` 唯一幂等、消息与会话绑定；按平台审计列和 RLS 规范建表，确认回调服务端身份的数据库权限。
4. 按妙搭运行时文件 SDK 实现私有上传、所有权验证、受限下载和失败清理。后端在校验字节后转存飞书，返回 `image_key` / `file_key`；不要由浏览器传任意下载 URL 让服务端抓取。
5. 验证飞书侧栏的 `requestAuthCode`、`getTriggerContext`、`sendMessageCard`，以及公开回调的原始签名信息、同步卡片响应和 3 秒时限；验证 30 MB MP4 的上传、转存、超时与内存限制。
6. 端到端验收和数据迁移完成后，才能切换飞书网页入口及事件回调。切换前保留 CloudBase 线上资源，不清理线上数据或存储。

本分支已合入妙搭脚手架，GitHub `origin` 保持不变，妙搭仓库作为 `miaoda` remote。`src/` 仍是 CommonJS 形式的可移植参考代码；接入应用时需按项目约定迁入 `server/`、`client/` 和 `shared/`。目前没有迁移线上数据、切换入口或发布。
