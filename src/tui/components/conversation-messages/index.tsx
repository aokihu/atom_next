/**
 * Conversation Message Card
 * @author aokihu <aokihu@gmail.com>
 * @version 0.5.3
 * @description 统一分发输出流中的不同角色消息组件，避免列表层继续堆积角色判断。
 */

import { ErrorConversationMessage } from "./error-message";
import { AssistantConversationMessage } from "./assistant-message";
import { UserConversationMessage } from "./user-message";
import { type ConversationMessageProps } from "./types";

export const ConversationMessageCard = ({
  message,
  theme,
}: ConversationMessageProps) => {
  if (message.role === "user") {
    return <UserConversationMessage message={message} theme={theme} />;
  }

  if (message.role === "assistant") {
    return <AssistantConversationMessage message={message} theme={theme} />;
  }

  return <ErrorConversationMessage message={message} theme={theme} />;
};
