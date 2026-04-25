// @ts-nocheck
import { describe, expect, test } from "bun:test";

import type { ConfigFileScheme } from "@/types/config";
import { RuntimeService } from "@/services/runtime";
import { WatchmanPhase } from "@/services/watchman/types";

const buildConfig = (): ConfigFileScheme => {
  return {
    version: 2,
    theme: "ocean",
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
    transport: {
      formalConversationMaxOutputTokens: undefined,
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

  test("returns theme name after loading config", () => {
    const runtime = new RuntimeService();

    runtime.loadConfig(buildConfig());

    expect(runtime.getThemeName()).toBe("ocean");
  });

  test("returns formal conversation max output tokens after loading config", () => {
    const runtime = new RuntimeService();

    runtime.loadConfig({
      ...buildConfig(),
      transport: {
        formalConversationMaxOutputTokens: 256,
      },
    });

    expect(runtime.getFormalConversationMaxOutputTokens()).toBe(256);
  });

  test("returns formal conversation output budget after loading config", () => {
    const runtime = new RuntimeService();

    runtime.loadConfig({
      ...buildConfig(),
      transport: {
        formalConversationMaxOutputTokens: 2000,
      },
    });

    expect(runtime.getFormalConversationOutputBudget()).toEqual({
      maxOutputTokens: 2000,
      requestTokenReserve: 256,
      visibleOutputBudget: 1744,
    });
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

  test("keeps model suffix when openaiCompatible profile contains extra slashes", () => {
    const runtime = new RuntimeService();

    runtime.loadConfig({
      ...buildConfig(),
      providerProfiles: {
        advanced: "deepseek/deepseek-chat",
        balanced: "openai/gpt-5",
        basic: "openaiCompatible/meta-llama/Llama-3.3-70B-Instruct",
      },
    });

    expect(runtime.getModelProfileWithLevel("basic")).toEqual({
      id: "openaiCompatible/meta-llama/Llama-3.3-70B-Instruct",
      provider: "openaiCompatible",
      model: "meta-llama/Llama-3.3-70B-Instruct",
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

  test("stores user agent prompt and status", () => {
    const runtime = new RuntimeService();

    runtime.syncUserAgentPromptSnapshot("# safe agents", {
      phase: WatchmanPhase.READY,
      hash: "hash-1",
      updatedAt: 123,
      error: null,
    });

    expect(runtime.getUserAgentPrompt()).toBe("# safe agents");
    expect(runtime.getUserAgentPromptStatus()).toEqual({
      phase: WatchmanPhase.READY,
      hash: "hash-1",
      updatedAt: 123,
      error: null,
    });
  });

  test("marks compile state only when no active prompt exists", () => {
    const runtime = new RuntimeService();

    runtime.syncUserAgentPromptSnapshot("", {
      phase: WatchmanPhase.COMPILING,
      hash: "hash-1",
      updatedAt: 123,
      error: null,
    });

    expect(runtime.getUserAgentPrompt()).toBe("");
    expect(runtime.getUserAgentPromptStatus()).toEqual({
      phase: WatchmanPhase.COMPILING,
      hash: "hash-1",
      updatedAt: 123,
      error: null,
    });
  });

  test("replaces prompt and status atomically when syncing new ready snapshot", () => {
    const runtime = new RuntimeService();

    runtime.syncUserAgentPromptSnapshot("# safe agents", {
      phase: WatchmanPhase.READY,
      hash: "hash-ready",
      updatedAt: 123,
      error: null,
    });

    expect(runtime.getUserAgentPrompt()).toBe("# safe agents");
    expect(runtime.getUserAgentPromptStatus()).toEqual({
      phase: WatchmanPhase.READY,
      hash: "hash-ready",
      updatedAt: 123,
      error: null,
    });
  });

  test("can keep previous ready snapshot by not overwriting it", () => {
    const runtime = new RuntimeService();

    runtime.syncUserAgentPromptSnapshot("# safe agents", {
      phase: WatchmanPhase.READY,
      hash: "hash-ready",
      updatedAt: 123,
      error: null,
    });

    expect(runtime.getUserAgentPrompt()).toBe("# safe agents");
    expect(runtime.getUserAgentPromptStatus()).toEqual({
      phase: WatchmanPhase.READY,
      hash: "hash-ready",
      updatedAt: 123,
      error: null,
    });
  });

  test("can expose error snapshot when synced directly", () => {
    const runtime = new RuntimeService();

    runtime.syncUserAgentPromptSnapshot("", {
      phase: WatchmanPhase.ERROR,
      hash: "hash-1",
      updatedAt: 456,
      error: "compile failed",
    });

    expect(runtime.getUserAgentPrompt()).toBe("");
    expect(runtime.getUserAgentPromptStatus()).toEqual({
      phase: WatchmanPhase.ERROR,
      hash: "hash-1",
      updatedAt: 456,
      error: "compile failed",
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

  test("returns parsed providerProfiles even when provider is unfamiliar", () => {
    const runtime = new RuntimeService();

    runtime.loadConfig({
      ...buildConfig(),
      providerProfiles: {
        advanced: "custom/model-x",
        balanced: "openai/gpt-5",
        basic: "openaiCompatible/custom-model",
      },
    });

    expect(runtime.getModelProfileWithLevel("advanced")).toEqual({
      id: "custom/model-x",
      provider: "custom",
      model: "model-x",
    });
  });

  test("returns undefined provider config when parsed provider is unsupported", () => {
    const runtime = new RuntimeService();

    runtime.loadConfig({
      ...buildConfig(),
      providerProfiles: {
        advanced: "deepseek/deepseek-chat",
        balanced: "custom/model-x",
        basic: "openaiCompatible/custom-model",
      },
    });

    expect(runtime.getModelProfileConfigWithLevel("balanced")).toEqual({
      selectedModel: {
        id: "custom/model-x",
        provider: "custom",
        model: "model-x",
      },
      providerConfig: undefined,
    });
  });
});
