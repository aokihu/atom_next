/**
 * Assistant Conversation Message
 * @author aokihu <aokihu@gmail.com>
 * @version 0.5.3
 * @description 负责渲染输出流中的助理消息与等待态消息，后续可以独立增加交互或视觉样式。
 */

import { type ConversationMessageProps } from "./types";

type AssistantConversationMessageContentProps = {
  content: string;
  theme: ConversationMessageProps["theme"];
};

const AssistantConversationMessageContent = ({
  content,
  theme,
}: AssistantConversationMessageContentProps) => {
  return (
    <box
      style={{
        width: "100%",
        flexDirection: "column",
        marginBottom: 1,
        paddingLeft: 1,
        border: ["left"],
        borderColor: theme.border,
      }}
    >
      <text fg={theme.accent}>Assistant</text>
      <text fg={theme.text} content={content} />
    </box>
  );
};

export const AssistantConversationMessage = ({
  message,
  theme,
}: ConversationMessageProps) => {
  return (
    <AssistantConversationMessageContent
      content={message.content}
      theme={theme}
    />
  );
};

export const AssistantConversationLoading = ({
  content,
  theme,
}: AssistantConversationMessageContentProps) => {
  return (
    <AssistantConversationMessageContent content={content} theme={theme} />
  );
};
