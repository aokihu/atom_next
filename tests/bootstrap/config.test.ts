// @ts-nocheck
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { DefaultConfig } from "@/types/config";
import { parseConfigFile } from "@/bootstrap/config";

const tempDirs: string[] = [];
const createTempConfigFile = async (content?: string) => {
  const dir = await mkdtemp(join(tmpdir(), "atom-next-config-"));
  const file = join(dir, "config.json");
  tempDirs.push(dir);

  if (typeof content !== "undefined") {
    await Bun.write(file, content);
  }

  return file;
};

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("parseConfigFile", () => {
  test("returns default config when file is missing in non-strict mode", async () => {
    const file = await createTempConfigFile();

    expect(await parseConfigFile(file)).toEqual(DefaultConfig);
  });

  test("throws when file is missing in strict mode", async () => {
    const file = await createTempConfigFile();

    await expect(parseConfigFile(file, true)).rejects.toThrow(
      "Config file not found",
    );
  });

  test("parses a complete valid config", async () => {
    const file = await createTempConfigFile(
      JSON.stringify({
        version: 2,
        providerProfiles: {
          advanced: "deepseek/deepseek-reasoner",
          balanced: "openai/gpt-5",
          basic: "openaiCompatible/local-model",
        },
        providers: {
          deepseek: {
            apiKeyEnv: "DEEPSEEK_API_KEY",
            models: ["deepseek-chat", "deepseek-reasoner"],
            baseUrl: "https://api.deepseek.com",
            options: {
              timeout: 30_000,
            },
          },
          openai: {
            apiKeyEnv: "OPENAI_API_KEY",
            models: ["gpt-4o", "gpt-5"],
          },
        },
        gateway: {
          enable: true,
          channels: [
            {
              source: "cli",
              enable: true,
              description: "Command line access",
            },
          ],
        },
      }),
    );

    expect(await parseConfigFile(file)).toEqual({
      version: 2,
      theme: "nord",
      providerProfiles: {
        advanced: "deepseek/deepseek-reasoner",
        balanced: "openai/gpt-5",
        basic: "openaiCompatible/local-model",
      },
      providers: {
        deepseek: {
          apiKeyEnv: "DEEPSEEK_API_KEY",
          models: ["deepseek-chat", "deepseek-reasoner"],
          baseUrl: "https://api.deepseek.com",
          options: {
            timeout: 30_000,
          },
        },
        openai: {
          apiKeyEnv: "OPENAI_API_KEY",
          models: ["gpt-4o", "gpt-5"],
          baseUrl: undefined,
          options: undefined,
        },
      },
      transport: {
        formalConversationMaxOutputTokens: undefined,
      },
      gateway: {
        enable: true,
        channels: [
          {
            source: "cli",
            enable: true,
            description: "Command line access",
          },
        ],
      },
    });
  });

  test("fills missing sections with default config", async () => {
    const file = await createTempConfigFile(
      JSON.stringify({
        version: 2,
      }),
    );

    expect(await parseConfigFile(file)).toEqual(DefaultConfig);
  });

  test("fills missing provider profile fields with defaults", async () => {
    const file = await createTempConfigFile(
      JSON.stringify({
        providerProfiles: {
          advanced: "deepseek/deepseek-reasoner",
        },
      }),
    );

    expect(await parseConfigFile(file)).toEqual({
      ...DefaultConfig,
      providerProfiles: {
        advanced: "deepseek/deepseek-reasoner",
        balanced: DefaultConfig.providerProfiles.balanced,
        basic: DefaultConfig.providerProfiles.basic,
      },
    });
  });

  test("parses theme when it is a valid string", async () => {
    const file = await createTempConfigFile(
      JSON.stringify({
        theme: "ocean",
      }),
    );

    expect(await parseConfigFile(file)).toEqual({
      ...DefaultConfig,
      theme: "ocean",
    });
  });

  test("supports legacy themeName field", async () => {
    const file = await createTempConfigFile(
      JSON.stringify({
        themeName: "paper",
      }),
    );

    expect(await parseConfigFile(file)).toEqual({
      ...DefaultConfig,
      theme: "paper",
    });
  });

  test("throws when theme is an empty string", async () => {
    const file = await createTempConfigFile(
      JSON.stringify({
        theme: "",
      }),
    );

    await expect(parseConfigFile(file)).rejects.toThrow("Invalid config.theme");
  });

  test("throws when theme is not a string", async () => {
    const file = await createTempConfigFile(
      JSON.stringify({
        theme: true,
      }),
    );

    await expect(parseConfigFile(file)).rejects.toThrow("Invalid config.theme");
  });

  test("warns but keeps providerProfiles when model names are unfamiliar", async () => {
    const warnings: string[] = [];
    const warn = (path: string, message: string) => {
      warnings.push(`${path}: ${message}`);
    };

    const file = await createTempConfigFile(
      JSON.stringify({
        providerProfiles: {
          advanced: "deepseek/invalid-model",
        },
      }),
    );

    expect(await parseConfigFile(file, false, { warn })).toEqual({
      ...DefaultConfig,
      providerProfiles: {
        advanced: "deepseek/invalid-model",
        balanced: DefaultConfig.providerProfiles.balanced,
        basic: DefaultConfig.providerProfiles.basic,
      },
    });
    expect(warnings[0]).toContain("config.providerProfiles.advanced");
  });

  test("warns but keeps providerProfiles when provider names are unfamiliar", async () => {
    const warnings: string[] = [];
    const warn = (path: string, message: string) => {
      warnings.push(`${path}: ${message}`);
    };

    const file = await createTempConfigFile(
      JSON.stringify({
        providerProfiles: {
          advanced: "custom/model-x",
        },
      }),
    );

    expect(await parseConfigFile(file, false, { warn })).toEqual({
      ...DefaultConfig,
      providerProfiles: {
        advanced: "custom/model-x",
        balanced: DefaultConfig.providerProfiles.balanced,
        basic: DefaultConfig.providerProfiles.basic,
      },
    });
    expect(warnings[0]).toContain("config.providerProfiles.advanced");
  });

  test("keeps openaiCompatible providerProfiles when model id contains extra slashes", async () => {
    const file = await createTempConfigFile(
      JSON.stringify({
        providerProfiles: {
          advanced: "openaiCompatible/meta-llama/Llama-3.3-70B-Instruct",
        },
      }),
    );

    expect(await parseConfigFile(file)).toEqual({
      ...DefaultConfig,
      providerProfiles: {
        advanced: "openaiCompatible/meta-llama/Llama-3.3-70B-Instruct",
        balanced: DefaultConfig.providerProfiles.balanced,
        basic: DefaultConfig.providerProfiles.basic,
      },
    });
  });

  test("falls back to default when providerProfiles format is invalid", async () => {
    const warnings: string[] = [];
    const warn = (path: string, message: string) => {
      warnings.push(`${path}: ${message}`);
    };

    const file = await createTempConfigFile(
      JSON.stringify({
        providerProfiles: {
          advanced: "deepseek-invalid-model",
        },
      }),
    );

    expect(await parseConfigFile(file, false, { warn })).toEqual({
      ...DefaultConfig,
      providerProfiles: {
        advanced: DefaultConfig.providerProfiles.advanced,
        balanced: DefaultConfig.providerProfiles.balanced,
        basic: DefaultConfig.providerProfiles.basic,
      },
    });
    expect(warnings[0]).toContain("config.providerProfiles.advanced");
  });

  test("ignores unknown provider keys", async () => {
    const file = await createTempConfigFile(
      JSON.stringify({
        providers: {
          custom: {
            apiKeyEnv: "CUSTOM_API_KEY",
            models: ["whatever"],
          },
          deepseek: {
            apiKeyEnv: "DEEPSEEK_API_KEY",
            models: ["deepseek-chat"],
          },
        },
      }),
    );

    const config = await parseConfigFile(file);

    expect(config.providers).toEqual({
      deepseek: {
        apiKeyEnv: "DEEPSEEK_API_KEY",
        models: ["deepseek-chat"],
        baseUrl: undefined,
        options: undefined,
      },
    });
  });

  test("throws when provider apiKeyEnv is invalid", async () => {
    const file = await createTempConfigFile(
      JSON.stringify({
        providers: {
          deepseek: {
            apiKeyEnv: "",
            models: ["deepseek-chat"],
          },
        },
      }),
    );

    await expect(parseConfigFile(file)).rejects.toThrow(
      "Invalid config.providers.deepseek.apiKeyEnv",
    );
  });

  test("warns but keeps provider models when model names are unfamiliar", async () => {
    const warnings: string[] = [];
    const warn = (path: string, message: string) => {
      warnings.push(`${path}: ${message}`);
    };

    const file = await createTempConfigFile(
      JSON.stringify({
        providers: {
          openai: {
            apiKeyEnv: "OPENAI_API_KEY",
            models: ["future-openai-model"],
          },
        },
      }),
    );

    expect(await parseConfigFile(file, false, { warn })).toEqual({
      ...DefaultConfig,
      providers: {
        openai: {
          apiKeyEnv: "OPENAI_API_KEY",
          models: ["future-openai-model"],
          baseUrl: undefined,
          options: undefined,
        },
      },
    });
    expect(warnings[0]).toContain("config.providers.openai.models[0]");
  });

  test("parses transport formal conversation max output tokens", async () => {
    const file = await createTempConfigFile(
      JSON.stringify({
        transport: {
          formalConversationMaxOutputTokens: 256,
        },
      }),
    );

    expect(await parseConfigFile(file)).toEqual({
      ...DefaultConfig,
      transport: {
        formalConversationMaxOutputTokens: 256,
      },
    });
  });

  test("throws when transport formal conversation max output tokens is invalid", async () => {
    const file = await createTempConfigFile(
      JSON.stringify({
        transport: {
          formalConversationMaxOutputTokens: 0,
        },
      }),
    );

    await expect(parseConfigFile(file)).rejects.toThrow(
      "Invalid config.transport.formalConversationMaxOutputTokens",
    );
  });

  test("throws when provider baseUrl is invalid", async () => {
    const file = await createTempConfigFile(
      JSON.stringify({
        providers: {
          deepseek: {
            apiKeyEnv: "DEEPSEEK_API_KEY",
            models: ["deepseek-chat"],
            baseUrl: "",
          },
        },
      }),
    );

    await expect(parseConfigFile(file)).rejects.toThrow(
      "Invalid config.providers.deepseek.baseUrl",
    );
  });

  test("throws when provider options is invalid", async () => {
    const file = await createTempConfigFile(
      JSON.stringify({
        providers: {
          deepseek: {
            apiKeyEnv: "DEEPSEEK_API_KEY",
            models: ["deepseek-chat"],
            options: [],
          },
        },
      }),
    );

    await expect(parseConfigFile(file)).rejects.toThrow(
      "Invalid config.providers.deepseek.options",
    );
  });

  test("throws when gateway enable is invalid", async () => {
    const file = await createTempConfigFile(
      JSON.stringify({
        gateway: {
          enable: "yes",
        },
      }),
    );

    await expect(parseConfigFile(file)).rejects.toThrow(
      "Invalid config.gateway.enable",
    );
  });

  test("throws when gateway channels is invalid", async () => {
    const file = await createTempConfigFile(
      JSON.stringify({
        gateway: {
          channels: {},
        },
      }),
    );

    await expect(parseConfigFile(file)).rejects.toThrow(
      "Invalid config.gateway.channels",
    );
  });

  test("throws when gateway channel source is invalid", async () => {
    const file = await createTempConfigFile(
      JSON.stringify({
        gateway: {
          channels: [
            {
              source: "",
            },
          ],
        },
      }),
    );

    await expect(parseConfigFile(file)).rejects.toThrow(
      "Invalid config.gateway.channels[0].source",
    );
  });

  test("throws when json content is invalid", async () => {
    const file = await createTempConfigFile("{invalid-json}");

    await expect(parseConfigFile(file)).rejects.toThrow();
  });

  test("throws when version is not 2", async () => {
    const file = await createTempConfigFile(
      JSON.stringify({
        version: 1,
      }),
    );

    await expect(parseConfigFile(file)).rejects.toThrow(
      "Invalid config.version",
    );
  });
});
