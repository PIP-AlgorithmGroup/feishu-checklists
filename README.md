# 飞书多媒体检查清单：妙搭迁移

`develop/miaoda-migration` 是当前项目的妙搭 `full_stack` 本地工程，关联妙搭应用 `app_17eebbe30dh`。历史版本保存在 `develop/cloudbase-backend`，`main` 未改动。妙搭线上库已经完成历史数据迁移，飞书卡片回调也已切换到妙搭。

目前用户无需操作。飞书回调的公网入口和同步响应能力尚未验证，不能把妙搭开发预览 URL 直接填入飞书后台；验证完成后再明确给出回调 URL、飞书后台字段和所需凭证的安全配置方式。不要把 App Secret、Verification Token 或 Encrypt Key 粘贴进聊天。

## 前端入口

普通浏览器打开应用首页进入“我的清单”，也可直接访问 `/manage`。支持当前登录用户的清单搜索、分页、刷新、完成进度及事项详情。`/editor` 可以新建并保存清单。飞书会话侧栏携带 `bdp_launch_query` 打开首页时仍进入发送编辑器。

列表和详情显示所属飞书对话，并支持点击打开。会话名称需要自建飞书应用具有读取会话信息的权限及会话访问权；名称读取失败时显示会话标识。当前发送流程在首次卡片勾选回调时记录会话绑定，尚无绑定的记录显示“尚未记录所属对话”。

管理页面按创建者过滤；历史迁移记录只有在创建者身份与当前妙搭用户一致时才会显示。详情中的媒体目前显示数量，媒体播放仍在飞书卡片中进行。

### Windows 本地预览

已有平台下发的 `.env.local` 时运行 `npm run dev:windows`。该入口加载开发凭证，并设置 `MIAODA_LOCAL_DEV=1`，让开发代理把当前开发者身份注入后端请求。缺少或过期的凭证先通过 `lark-cli apps +env-pull --app-id app_17eebbe30dh --as user` 更新，再重启开发服务。

本地开发使用平台下发的开发身份；平台的 `/runtime/page/login` 不是本地业务路由，不能通过访问该路径补齐开发身份。

## 保留的业务契约

- `src/checklist.js`：最多 50 项、每项 500 字、每项最多 3 张图片和 3 个视频的服务端校验与规范化。
- `src/card.js`：Card JSON 2.0 checker、图片缩略图、视频和 `update_multi` 的发送与回调渲染。
- `src/callback.js`：飞书回调验签、解密、事件解析，以及通过 `repository.apply(event)` 更新后返回卡片。幂等、消息与会话绑定必须由未来的事务仓储实现。
- `src/auth.js`、`src/sign.js`：飞书授权码交换、短期会话、H5 JSAPI 签名和页面来源校验。
- `src/media.js`：图片与 MP4 文件签名、体积校验和飞书媒体上传。文件读取与所有权校验尚未接入。
- `src/editor.js`：批量录入、排序、快捷键、剪贴板媒体和会话启动参数的纯规则。

`server/modules/checklist/` 提供清单校验、创建、JSAPI 签名、妙搭文件转传飞书、版本条件更新和卡片回调。`client/src/pages/ChecklistPage/` 提供飞书会话侧栏编辑器、图片压缩、妙搭文件上传和当前会话发卡。运行 `node --test` 验证契约；平台工程使用 `npm run type:check`、`npm run build` 和 `npm run lint`。

## 迁移接入顺序

1. 在当前工程中阅读 `.agents/skills/` 中相关数据库、文件、鉴权和插件指引；不要猜造 SDK 或路由合同。
2. 将 `src/` 的纯逻辑和测试移入妙搭工程，在其实际 router/bootstrap 中接入页面和 API。保留飞书企业自建应用、机器人、网页应用侧栏、JSAPI 权限及 `card.action.trigger` 订阅。
3. 用妙搭数据库重建清单与事件表、事务、`event_id` 唯一幂等、消息与会话绑定；按平台审计列和 RLS 规范建表，确认回调服务端身份的数据库权限。
4. 按妙搭运行时文件 SDK 实现私有上传、所有权验证、受限下载和失败清理。后端在校验字节后转存飞书，返回 `image_key` / `file_key`；不要由浏览器传任意下载 URL 让服务端抓取。
5. 验证飞书侧栏的 `requestAuthCode`、`getTriggerContext`、`sendMessageCard`，以及公开回调的原始签名信息、同步卡片响应和 3 秒时限；验证 30 MB MP4 的上传、转存、超时与内存限制。
6. 发布后在飞书侧栏完成真实清单、图片、视频和双用户勾选验收。旧云资源只用于临时回滚，必须获得明确删除确认后才能清理。

本分支已合入妙搭脚手架，GitHub `origin` 保持不变，妙搭仓库作为 `miaoda` remote。`src/` 仍是 CommonJS 形式的可移植参考代码；接入应用时需按项目约定迁入 `server/`、`client/` 和 `shared/`。目前没有迁移线上数据、切换入口或发布。
