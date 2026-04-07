//@ts-nockeck
// @ts-nocheck
import { describe, expect, test } from "bun:test";

import type { ConfigFileScheme } from "@/types/config";
import { RuntimeService } from "@/services/runtime";

const buildConfig = (): ConfigFileScheme => {
  return {
    version: 2,
    providerProfiles: {
      advanced: "deepseek/deepseek-chat",
      balanced: "openai/gpt-5",
      basic: "openaiCompatible/custom-model",
    },
    providers: {
      openai: {
        apiKeyEnv: "OPENAI_API_KEY",
        models: ["gpt-5"],
      },
    },
    gateway: {
      enable: false,
      channels: [],
    },
  };
};

const buildCliArgs = () => {
  return {
    mode: "both",
    config: "/workspace/config.json",
    workspace: "/workspace",
    sandbox: "/workspace/sandbox",
    serverUrl: "ws://127.0.0.1:8787",
    address: "127.0.0.1",
    port: undefined,
  };
};

describe("RuntimeService", () => {
  test("returns semantic CLI getters after loading arguments", () => {
    const runtime = new RuntimeService();

    runtime.loadCliArgs(buildCliArgs());

    expect(runtime.getMode()).toBe("both");
    expect(runtime.getWorkspace()).toBe("/workspace");
    expect(runtime.getSandbox()).toBe("/workspace/sandbox");
    expect(runtime.getServerUrl()).toBe("ws://127.0.0.1:8787");
    expect(runtime.getServerAddress()).toBe("127.0.0.1");
  });

  test("throws when listen port is not set yet", () => {
    const runtime = new RuntimeService();

    runtime.loadCliArgs(buildCliArgs());

    expect(() => runtime.getListenPort()).toThrow(
      "CLI argument port not found",
    );
  });

  test("returns updated listen port after setPort", () => {
    const runtime = new RuntimeService();

    runtime.loadCliArgs(buildCliArgs());
    runtime.setPort(9090);

    expect(runtime.getListenPort()).toBe(9090);
  });

  test("returns provider profiles snapshot after loading config", () => {
    const runtime = new RuntimeService();
    const config = buildConfig();

    runtime.loadConfig(config);

    expect(runtime.getProviderProfiles()).toEqual(config.providerProfiles);
  });

  test("returns selected deepseek model by level", () => {
    const runtime = new RuntimeService();

    runtime.loadConfig(buildConfig());

    expect(runtime.getModelProfileWithLevel("advanced")).toEqual({
      id: "deepseek/deepseek-chat",
      provider: "deepseek",
      model: "deepseek-chat",
    });
  });

  test("returns selected openai model by level", () => {
    const runtime = new RuntimeService();

    runtime.loadConfig(buildConfig());

    expect(runtime.getModelProfileWithLevel("balanced")).toEqual({
      id: "openai/gpt-5",
      provider: "openai",
      model: "gpt-5",
    });
  });

  test("returns selected openai compatible model by level", () => {
    const runtime = new RuntimeService();

    runtime.loadConfig(buildConfig());

    expect(runtime.getModelProfileWithLevel("basic")).toEqual({
      id: "openaiCompatible/custom-model",
      provider: "openaiCompatible",
      model: "custom-model",
    });
  });

  test("returns selected model with provider config by level", () => {
    const runtime = new RuntimeService();

    runtime.loadConfig(buildConfig());

    expect(runtime.getModelProfileConfigWithLevel("balanced")).toEqual({
      selectedModel: {
        id: "openai/gpt-5",
        provider: "openai",
        model: "gpt-5",
      },
      providerConfig: {
        apiKeyEnv: "OPENAI_API_KEY",
        models: ["gpt-5"],
      },
    });
  });

  test("returns provider config when provider is declared", () => {
    const runtime = new RuntimeService();

    runtime.loadConfig(buildConfig());

    expect(runtime.getProviderConfig("openai")).toEqual({
      apiKeyEnv: "OPENAI_API_KEY",
      models: ["gpt-5"],
    });
  });
});
