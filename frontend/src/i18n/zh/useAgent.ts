// useAgent.ts: why a chat did not join, or a message did not get through
// (shown after "Not sent:").
export default {
  "Can't reach the server to start this chat — trying again…": "连不上服务器，无法开始此会话，正在重试…",
  "join failed": "连接失败",
  "join timed out": "连接超时",
  "the connection dropped before it was confirmed": "连接在确认送达前断开",
  "not connected": "未连接",
  "the server refused it": "服务器拒绝了这条消息",
  "no answer — the connection may be weak": "没有回应，网络可能不稳定",
  "couldn't start this chat — the connection may be weak": "无法开始此会话，网络可能不稳定",
  "its files were lost when the page reloaded — attach them again": "页面重新加载后文件已丢失，请重新添加",
  "upload failed": "上传失败",
} satisfies Record<string, string>
