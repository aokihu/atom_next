/**
 * Conversation Message Types
 * @author aokihu <aokihu@gmail.com>
 * @version 0.5.3
 * @description 统一收敛输出消息组件共享的 props 类型，避免在多个消息组件中重复声明。
 */

import { type TuiMessage } from "@/tui/model";
import type { TuiThemeScheme } from "@/tui/theme";

export type ConversationMessageProps = {
  message: TuiMessage;
  theme: TuiThemeScheme;
};
