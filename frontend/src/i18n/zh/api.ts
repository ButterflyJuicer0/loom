// Errors and notices from api.ts that components show as they are.
export default {
  "Couldn't save that — {error}": "保存失败：{error}",
  "renameAgent failed: {status}": "服务器返回 {status}",
  "deleteAgent failed: {status}": "服务器返回 {status}",
  "could not list the files: {status}": "无法列出文件（{status}）",
  "the file is no longer there": "文件已不存在",
  "too big to zip (over 1 GB)": "超过 1 GB，无法打包为 zip",
  "download failed: {status}": "下载失败（{status}）",
  "canvas failed: {status}": "画布加载失败（{status}）",
  "viewer failed: {status}": "预览加载失败（{status}）",
  "upload failed: {status}": "上传失败（{status}）",
  "request failed: {status}": "请求失败（{status}）",
  "This server": "本服务器",
  "image failed: {status}": "图片生成失败（{status}）",
} satisfies Record<string, string>
