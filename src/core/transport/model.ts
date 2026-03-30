/**
 * 提供一个统一并且快捷的方式切换AI-SDK的模型
 * @author aokihu <aokihu@gmail.com>
 * @version 1.0
 */
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { deepseek } from "@ai-sdk/deepseek";

type ProviderID = "deepseek";

/* ==================== */
/*       Private        */
/* ==================== */

const withDeepseek: (
  model: "deepseek-chat" | "deepseek-reasoner",
) => LanguageModelV3 = (model) => {
  return deepseek.languageModel(model);
};

/* ==================== */
/*       Public         */
/* ==================== */

/**
 * 根据供应商创建模型
 * @param withProvider 模型供应商
 * @param model 模型名称
 */
export const createModelWithProvider = (
  provider: ProviderID,
  model: string,
) => {
  if (provider === "deepseek")
    return withDeepseek(model as "deepseek-chat" | "deepseek-reasoner");
};
