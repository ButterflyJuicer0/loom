// Meeting.tsx and meeting.ts (one file: their names differ only in case).
export default {
  // Meeting.tsx
  "Meeting mode": "会议模式",
  "Checking the speech models…": "正在检查语音模型…",
  "Meeting mode transcribes the meeting in this browser and tells voices apart, then the agent in this chat gives hints as it goes and writes the minutes at the end.":
    "会议模式会在本浏览器中实时转写会议并区分说话人，本会话的智能体会在会议中随时给出提示，结束后写出会议纪要。",
  "It needs the speech models first (about {size}, once). The server fetches them and passes them on; this browser keeps them.":
    "需要先下载语音模型（约 {size}，仅此一次）。模型由服务器获取后转交本浏览器保存。",
  "Downloading to this browser…": "正在下载到本浏览器…",
  "The server is unpacking the models…": "服务器正在解压模型…",
  "The server is fetching the models…": "服务器正在获取模型…",
  "On a computer, share your screen ": "在电脑上，共享屏幕时请",
  "with system audio": "同时共享系统音频",
  " on — that is how the other side is heard. Your microphone is you. Headphones keep the two apart.":
    "，这样才能听到对方的声音。麦克风收的是你自己的声音，戴上耳机可以把两边分开。",
  "No screen to share (a phone, or a meeting in the room): only the microphone is used.":
    "没有屏幕可共享时（用手机，或在会议室里开会），只使用麦克风。",
  "Starting the recognisers…": "正在启动语音识别…",
  Hide: "隐藏",
  Start: "开始",
  "Listening; voices are told apart": "正在聆听，并区分说话人",
  Listening: "正在聆听",
  "Listening…": "正在聆听…",
  "Listening (microphone only)…": "正在聆听（仅麦克风）…",
  "Send what was said so far and get hints now": "发送目前为止的内容，立即获取提示",
  Ask: "提问",
  "End the meeting and write the minutes": "结束会议并撰写纪要",
  End: "结束",
  "A meeting is open in this chat but not listening here.": "本会话有一场会议正在进行，但此页面没有在聆听。",
  Resume: "继续",

  // meeting.ts: errors the dialog shows
  "models: {status}": "无法获取语音模型状态（{status}）",
  "model bundle {bundle} is incomplete": "模型包 {bundle} 不完整",
  "download failed: {status}": "下载失败（{status}）",
  "download failed on the server": "服务器下载模型失败",
  "worker failed": "语音识别组件启动失败",
  "the speech models are not downloaded": "语音模型尚未下载",
  "could not start the meeting on the server": "无法在服务器上开始会议",
} satisfies Record<string, string>
