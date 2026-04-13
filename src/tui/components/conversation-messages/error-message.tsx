/**
 * Error Conversation Message
 * @author aokihu <aokihu@gmail.com>
 * @version 0.5.3
 * @description 负责渲染输出流中的错误消息，便于后续单独调整错误态表现。
 */

import { type ConversationMessageProps } from "./types";

export const ErrorConversationMessage = ({
  message,
  theme,
}: ConversationMessageProps) => {
  return (
    <box
      style={{
        width: "100%",
        flexDirection: "column",
        marginBottom: 1,
        backgroundColor: theme.panel,
      }}
    >
      <text fg={theme.danger}>Error</text>
      <text fg={theme.text} content={message.content} />
    </box>
  );
};
