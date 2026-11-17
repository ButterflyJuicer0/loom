// Projects.tsx: the new/edit project dialog.
export default {
  Project: "项目",
  "New project": "新建项目",
  Name: "名称",
  "e.g. Blog": "例如：博客",
  Workspace: "工作区",
  "Every session in the project starts here.": "项目中的每个会话都从这里开始。",
  Instructions: "说明",
  "What every session in this project should know or do.": "这个项目里每个会话都该知道或照做的事。",
  "Added to each session's system prompt. Claude Code sessions pick up a change on their next turn.":
    "会加入每个会话的系统提示词。Claude Code 会话在下一轮生效。",
  Create: "创建",
  "Delete {name}?": "删除“{name}”？",
  "Its {n} session and their history, and the workspace {workspace} with everything in it. This cannot be undone.":
    "项目的 {n} 个会话及其历史记录，连同工作区 {workspace} 里的全部内容都会被删除，且无法恢复。",
  "Its {n} sessions and their history, and the workspace {workspace} with everything in it. This cannot be undone.":
    "项目的 {n} 个会话及其历史记录，连同工作区 {workspace} 里的全部内容都会被删除，且无法恢复。",
} satisfies Record<string, string>
