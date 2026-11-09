import { describe, expect, it } from "vitest";
import { resolveProviderConfig } from "./model-provider";

describe("真实模型环境变量解析(工厂缝)", () => {
  it("三项齐全:直接采用环境变量", () => {
    const config = resolveProviderConfig({
      MODEL_API_KEY: "sk-test",
      MODEL_BASE_URL: "https://glm.example.com/v1",
      MODEL_NAME: "glm-4",
    });
    expect(config).toEqual({
      apiKey: "sk-test",
      baseURL: "https://glm.example.com/v1",
      modelName: "glm-4",
      label: "glm-4 @ https://glm.example.com/v1",
    });
  });

  it("只有 MODEL_API_KEY:回落 DeepSeek 官方端点与默认模型名", () => {
    const config = resolveProviderConfig({ MODEL_API_KEY: "sk-test" });
    expect(config.baseURL).toBe("https://api.deepseek.com");
    expect(config.modelName).toBe("deepseek-chat");
    expect(config.label).toContain("deepseek-chat");
  });

  it("MODEL_API_KEY 缺省时回落既有 DEEPSEEK_API_KEY(兼容 .env.local)", () => {
    const config = resolveProviderConfig({ DEEPSEEK_API_KEY: "sk-legacy" });
    expect(config.apiKey).toBe("sk-legacy");
  });

  it("两个 key 都缺:抛错并给出 .env.local 与 --model fake 指引", () => {
    expect(() => resolveProviderConfig({})).toThrow(/MODEL_API_KEY.*\.env\.local|--model fake/);
  });

  it("key 存在但为空串:视为缺失(同样抛错)", () => {
    expect(() => resolveProviderConfig({ MODEL_API_KEY: "" })).toThrow(/MODEL_API_KEY/);
  });
});
