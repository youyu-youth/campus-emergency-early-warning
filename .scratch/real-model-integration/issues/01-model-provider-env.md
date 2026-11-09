# 01: 真实模型接入（OpenAI 兼容环境变量 + 一键切换）

**What to build:** 真实模型经 OpenAI 兼容接口接入：模型工厂从环境变量（`MODEL_API_KEY` / `MODEL_BASE_URL` / `MODEL_NAME`，默认 DeepSeek 官方端点）构造，下沉到 `src/agents/` 供 CLI 与后续服务端路由共用；CLI `--model deepseek|fake` 保留为与模拟模型响应的一键切换。全链路回归测试仍用假模型剧本，保证无网络、可复现。来源：docs/design.md 第 9 节路线第 3 步。

**Blocked by:** None（第 2 步闭环 01–06 已全部完成）

**Status:** ready-for-agent

- [x] 模型工厂 `src/agents/model-provider.ts`：环境变量解析纯函数（MODEL_API_KEY 缺省回落 DEEPSEEK_API_KEY 兼容既有 .env.local；MODEL_BASE_URL 缺省 DeepSeek 官方；MODEL_NAME 缺省 deepseek-chat）+ ChatDeepSeek 经 configuration.baseURL 适配任意 OpenAI 兼容端点（零新依赖）
- [x] 缺 API Key 时抛出带指引的错误（提示 .env.local 或 --model fake）
- [x] CLI `--model deepseek` 接工厂（替代脚本内硬编码 createDeepSeek），启动提示显示实际模型名与端点；`--model fake` 离线演示不变
- [x] `.env.example` 入 Git：三个变量 + 注释说明（不含真实密钥）
- [x] 工厂缝测试：环境变量解析回落/覆盖/缺 key 报错（无网络调用）；全量回归仍为假模型（既有 102 测试不变绿转红）
- [x] 双路冒烟：fake 跑通一场；deepseek 真模型跑通一场（验证切换与真实调用）

## Comments

- 2026-11-09 完成。实现:`src/agents/model-provider.ts`(resolveProviderConfig 纯函数:MODEL_API_KEY→DEEPSEEK_API_KEY 回落、MODEL_BASE_URL→官方默认、MODEL_NAME→deepseek-chat、label=名@端点供提示;createProviderModel 工厂经 ChatDeepSeek configuration.baseURL 适配任意 OpenAI 兼容端点——已对照 @langchain/deepseek 源码确认透传,零新依赖;工厂落 src/agents/ 与 model.ts 同域,后续服务端路由可直接 import)。CLI:createDeepSeek 硬编码删除、接工厂,启动提示显示实际「模型名 @ 端点」,--model fake 不变。.env.example 三件套+DEEPSEEK_API_KEY 兼容注释(端点写法与代码默认统一为不带 /v1)。新增工厂缝测试 5 个(回落/覆盖/缺 key/空串,纯函数无网络),全量 14 文件 107 绿(回归全为假模型)。双路冒烟:fake seed7 总分 76;deepseek 真模型 seed7 全链路完成(26 节点/7 任务/复盘报告 19 条归纳,总分 55),期间真模型一次输出无效**真实触发降级路径**(师生通知走规则默认文案,主线不受阻)。code-review 两轴:Spec 6/6、Standards 0 硬违规;.env.example 端点写法不一致已统一,CLI 双次解析纯函数无行为差异裁定不改。
