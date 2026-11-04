---
name: loom-meeting
description: Loom's meeting mode, from the agent's side — live hints from transcript batches, minutes at the end, and the hotword list that makes the speech recogniser hear names right (add customers, people and products; fix what it keeps mishearing). Use in a chat that got 【会议模式开始】, or when the user asks to add/remove hotwords ("加热词", "这个词总听错", "热词里去掉 X") or to change the meeting prompt.
---

# loom-meeting

The page transcribes the meeting in the browser (sherpa-onnx, Chinese + English)
and Loom sends you a batch about every 30 s: `[HH:MM:SS] 说话人: 内容`. 「我」 is the
user's microphone; 「对方1/2…」 are voices from the shared screen's system audio,
told apart by sound (labels can drift). The opening message holds the rules for
hints and minutes and the paths of the transcript file and the hotword file.

## The transcript is speech recognition — read through its mistakes

It mishears, most of all English product names, people and companies, and
writes English in capitals: `COSPARK`/`COSBACK` = CallSpark, `LIBA` = Tuesday,
`BED ROCK` = Bedrock, a customer's name split into near-homophones. Work out
what was meant from the meeting's subject, the calendar invite, the account in
SFDC and the rest of the talk, and **write the right word** in hints and in the
minutes. Don't point out the recogniser's mistakes to the user — just use the
correct word. If a misheard word changes the meaning and you can't tell, say so
in one line.

## Hotwords: make it hear names right

The recogniser favours the words in its hotword list. The list = built-in AWS
product names + the lines of `~/.loom/meeting/hotwords.txt` (the path is also
in the opening message). Edit that file; nothing else.

- One word or phrase per line, as it is spoken and written: `Amazon Bedrock`,
  `CallSpark`, `宁德时代`, `张伟`. Case doesn't matter.
- Optional weight at the end: `CallSpark :3.0` (default 2.0; go above 3 only
  for a word that is still misheard).
- `-Word` removes a word, built-in ones included (`-MAP` when "map" keeps
  turning into the AWS programme).
- `#` starts a comment.

**When to add, without being asked** (append; don't rewrite the file):
- At the start, once you know the meeting: the customer's company and product
  names, attendees' names, the AWS services the invite or SFDC opportunity is
  about.
- During it, when a name keeps coming out wrong (twice is enough), or a proper
  noun is clearly going to come up again.
- Not ordinary words, not one-off words — every hotword pulls other sounds
  towards itself, so keep the list to names that matter. Over ~300 lines, prune
  the stale ones.

The file is global: what you add helps every later meeting too. A change
reaches a running meeting within one batch: the page loads the new list and
the recogniser switches at the next pause (a second or two of reloading). Say
nothing about it in the hints unless the user asked.

When the user asks ("加个热词 X", "X 总是识别错", "去掉 Y"), edit the file and
reply in one line with what changed.

## Other knobs

- The opening prompt: `~/.loom/meeting/prompt.md` replaces the built-in one
  (the user's call; copy the current one from the chat's first meeting message
  and edit it).
- Transcripts: `~/.loom/sessions/<session>/meeting/<start>.md`, one per meeting.
- End, ten minutes of silence, or a closed page → 【会议结束】: read the whole
  transcript file, not just what is left in the conversation, for the minutes.
