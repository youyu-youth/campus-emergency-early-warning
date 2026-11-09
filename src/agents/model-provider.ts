// 真实模型工厂:OpenAI 兼容端点经环境变量接入(CLI 与后续服务端路由共用)
// ChatDeepSeek 本质是 OpenAI 兼容客户端且透传 configuration.baseURL,任意兼容端点零新依赖
// 密钥只经环境变量(.env.local 不入 Git);回归测试始终用假模型,不触网络

import { ChatDeepSeek } from "@langchain/deepseek";
import { wrapLangChain, type AgentChatModel } from "./model";

/** DeepSeek 官方端点(OpenAI 兼容);其他供应商改 MODEL_BASE_URL 即可 */
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL_NAME = "deepseek-chat";

export interface ProviderEnv {
  MODEL_API_KEY?: string;
  /** 兼容既有 .env.local 的旧变量名,缺省回落 */
  DEEPSEEK_API_KEY?: string;
  MODEL_BASE_URL?: string;
  MODEL_NAME?: string;
}

export interface ProviderConfig {
  apiKey: string;
  baseURL: string;
  modelName: string;
  /** 启动提示/日志用的一行描述 */
  label: string;
}

/** 解析环境变量为模型配置(纯函数):新变量优先,缺省回落 DeepSeek 默认;无 key 抛错带指引 */
export function resolveProviderConfig(env: ProviderEnv): ProviderConfig {
  const apiKey = env.MODEL_API_KEY?.trim() || env.DEEPSEEK_API_KEY?.trim() || "";
  if (!apiKey) {
    throw new Error("缺少 MODEL_API_KEY:请在 .env.local 中配置(或用 DEEPSEEK_API_KEY),离线演示请使用 --model fake");
  }
  const baseURL = env.MODEL_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const modelName = env.MODEL_NAME?.trim() || DEFAULT_MODEL_NAME;
  return { apiKey, baseURL, modelName, label: `${modelName} @ ${baseURL}` };
}

/** 构造真实模型(经 invokeAgent 统一调用环:超时+重试+降级由各智能体负责) */
export function createProviderModel(env: ProviderEnv = process.env as ProviderEnv): AgentChatModel {
  const config = resolveProviderConfig(env);
  return wrapLangChain(
    new ChatDeepSeek({
      apiKey: config.apiKey,
      model: config.modelName,
      temperature: 0,
      timeout: 30_000,
      configuration: { baseURL: config.baseURL },
    }),
  );
}
