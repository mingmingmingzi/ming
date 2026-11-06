# 图片分类前端联调交接

本次范围：宋雷鸣的第一阶段前端。入口 `/platforms` → 数据标注平台 → `/labeling`。原 `/label-projects`、`/manual-label` Demo 保留。

## 本地启动

使用 Node 20+，`npm ci` 后运行：

```bash
DEV_LABELING_TARGET=http://127.0.0.1:8082 npm run dev:local
```

先在统一登录页登录；训练身份服务默认 8080，新业务服务默认 8082。浏览器仅调用同源 `/api/labeling/v1`；不要将数据库或服务凭据放进前端。生产网关也必须配置 `/api/labeling/` 指向新服务，保留原 `/api/` 和 `/label-api/` 路由。此次 PR 不修改服务器或自动合并到生产分支。

## 已实现与待接入

- 真实身份检查、本人项目分页、创建项目、项目详情、分类规范版本。
- 创建导入、整包/分片 SHA-256、按服务端 chunkSizeBytes 顺序上传、手动停止、同会话续传、批次查询、失败解析重试、样本分页与授权 Blob 图片预览。
- 输入本人 assignmentId，分页读取任务、恢复草稿、选择类别、带 baseRevision 保存分类草稿。后端确认 revision 后才显示保存成功；不调用整包提交。
- 无自动 Mock 或本地假保存。后端未实现、路由错误和权限失败均明确显示。
- 项目/规范已在 labeling-backend 发现实现；导入已按功能分支适配，仍待真实服务联调；领取/草稿待业务后端实现。不宣称完整验收通过。

## 与汤笑诚确认

已按 `image-import` 分支 `e5fafd3` 的 `08-image-import-api.md` 和调用示例适配：仅 ZIP 中的 JPEG/PNG；创建后 GET 最新状态，complete/retry 不发送请求体；使用 projectId/sizeBytes 校验批次；PROCESSING 自动轮询；显示 validSampleCount/errorCount/errors/errorCode，READY 中的文件级错误不隐藏；仅 FAILED 且 originalComplete 时允许重试。

状态接口不提供 filename/sha256，因此续传逐片重放已有内容以校验原始前缀。后端同 offset、同摘要重放不追加，返回当前总进度；前端不把这个总进度误认为已逐片验证，仍继续核对剩余原片。新片按服务器冻结尺寸追加，complete 最后验证整包摘要。该方式增加续传网络流量，但不会假设未提供的字段。批次 ID 不属于当前项目时拒绝继续。

样本分页 `{data:{items:[{sampleId,sourcePath或relativePath,mediaType}],nextCursor}}`。图片接口返回真实 image/* Content-Type；使用登录 Bearer 授权，不返回存储密钥。

当前 Web Crypto 整包摘要会将文件读入内存，适用于小样本联调，不是大文件生产上传完成方案。大文件需后续增量 SHA-256 Worker；HTTPS 或 localhost 是摘要计算前提。停止上传后可重选原文件继续；刷新后粘贴 batchId 查询再选原文件。导入创建响应丢失时，本会话同请求复用幂等键；页面刷新后的未知创建结果需后端查询协助，未实现跨刷新幂等请求日志。

## 与林玉洁、汤立娜确认

真实保存要求先发布项目并建立有效领取记录，只有项目与导入不够。暂通过输入 assignmentId 联调，不添加未经确认的 owner 直写结果接口。

assignment items 补充联调约定：返回 sampleId、specVersionId、editable（明确 true 才开放编辑）、readOnly、draft:{revision,result}。specVersionId 必须匹配所选项目的规范，避免用最新规范覆盖旧任务结果。尚未对齐字段时页面保持只读。`draft.result` 采用下面格式。后端仍须逐请求校验归属、状态、模板与 revision。

固定最小模板建议：from_name=category，to_name=image，type=choices；类别值为规范 labels.name。需由编辑器负责人确认，不能假设任意 Label Studio 模板通用。

```json
{"baseRevision":0,"explicitDone":true,"resultFormat":"label-studio-json","result":[{"from_name":"category","to_name":"image","type":"choices","value":{"choices":["正常"]}}]}
```

本页面仅提供平台原生分类草稿路径，尚未集成 Label Studio 会话或同步。接入外部编辑器时必须选定单一写入来源，不能同时竞争覆盖草稿。

## 验证与验收

`npm run tsc`、`npm run build`；Node 24 执行 `node --test src/services/labeling.test.mjs`。Node 20 跳过依赖内置 TS 转换的这组测试，PR CI 使用 Node 24 执行。

真实验收：登录 → 创建图片分类项目 → 创建规范 → 上传小 ZIP → 查询 READY → 浏览及翻页 → 打开图片 → 后端提供项目对应的本人有效 assignmentId → 读取任务 → 选择类别并保存 → 再读取任务确认草稿及 revision 保留。另验 401、404、409、停止续传、错误文件恢复和图片切换。确认旧登录、训练入口、Demo 仍可用。

自动检查不能代替上述真实后端验收。当前云环境 Git/npm 代理无法连接，无法本地安装依赖及运行完整 Umi 构建，交由新增 PR 检查执行。PR 基础分支为 frontend；合并可能触发既有 labeling-deploy.yml 生产发布，应在联调通过后合并。
