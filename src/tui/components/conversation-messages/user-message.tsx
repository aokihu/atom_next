/**
 * User Conversation Message
 * @author aokihu <aokihu@gmail.com>
 * @version 0.5.3
 * @description 负责渲染输出流中的用户消息，后续可单独扩展用户消息的样式与交互。
 */

import { type ConversationMessageProps } from "./types";

export const UserConversationMessage = ({
  message,
  theme,
}: ConversationMessageProps) => {
  return (
    <box
      style={{
        width: "100%",
        flexDirection: "column",
        marginBottom: 1,
        paddingLeft: 1,
        border: ["left"],
        borderColor: theme.accent,
      }}
    >
      <text fg={theme.user}>User</text>
      <text fg={theme.text} content={message.content} />
    </box>
  );
};
