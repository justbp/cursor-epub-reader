# AI 提示词配置示例

在 Cursor 设置里搜索 `Cursor Epub › Ai: Prompts`，点击 `Edit in settings.json`，可以按下面格式覆盖内置提示词。

只需要配置你想改的 key，未配置的 key 会继续使用插件内置默认值。

## 可用变量

- `{bookTitle}`：书名
- `{author}`：作者
- `{chapterTitle}`：当前章节标题
- `{chapterIndex}`：当前章节序号，从 1 开始
- `{outputLanguage}`：输出语言
- `{text}`：章节正文
- `{selectedText}`：选中文本
- `{question}`：用户输入的问题
- `{contextTitle}`：上下文标题，例如 `章节内容：` 或 `选中文本：`
- `{contextText}`：当前任务实际使用的上下文文本
- `{commandLabel}`：命令名，例如 `/人物分析`
- `{commandTitle}`：命令标题
- `{truncationNotice}`：文本被截断时的提示
- `{qaInstruction}`：问答任务的上下文说明

## 常用配置示例

```json
{
  "cursorEpub.ai.prompts": {
    "system": "你是一个严谨的中文读书助手。只基于用户提供的书籍内容回答，不编造信息。输出清晰、结构化，适合保存为 Markdown。输出语言：{outputLanguage}。",
    "chapterSummary": "书名：{bookTitle}\n作者：{author}\n章节：{chapterTitle}\n\n请总结下面章节。\n\n输出格式：\n## 本章主旨\n## 核心论点\n## 关键概念\n## 值得摘录\n## 我的追问\n\n{truncationNotice}\n\n{text}",
    "qa": "书名：{bookTitle}\n章节：{chapterTitle}\n\n问题：{question}\n\n{qaInstruction}\n\n{contextTitle}\n{contextText}"
  }
}
```

## 完整内置默认提示词

下面是插件当前内置默认值，可以复制后按需修改。

```json
{
  "cursorEpub.ai.prompts": {
    "system": "你是一个严谨的读书助手。\n你只基于用户提供的书籍内容回答，不编造未提供的信息。\n输出应清晰、结构化、适合保存为 Markdown 笔记。\n如果内容不足以回答，请说明不足之处。\n输出语言：{outputLanguage}。",
    "chapterSummary": "书名：{bookTitle}\n作者：{author}\n章节：{chapterTitle}\n\n请总结下面的章节内容。\n\n输出格式：\n## 一句话概括\n## 核心要点\n## 重要概念\n## 值得摘录\n## 继续阅读的问题\n\n{truncationNotice}\n\n{text}",
    "chunkSummary": "书名：{bookTitle}\n作者：{author}\n章节：{chapterTitle}\n分块：{chunkIndex} / {chunkCount}\n\n请基于下面这一段章节内容，提炼局部摘要。输出 5-8 条要点，不要扩展未提供的信息。\n\n{text}",
    "finalSummary": "书名：{bookTitle}\n作者：{author}\n章节：{chapterTitle}\n\n下面是同一章节不同分块的局部摘要。请合成为一个完整章节总结。\n\n输出格式：\n## 一句话概括\n## 核心要点\n## 重要概念\n## 值得摘录\n## 继续阅读的问题\n\n{text}",
    "selectionExplain": "书名：{bookTitle}\n作者：{author}\n当前章节：{chapterTitle}\n\n请解释下面的选中文本。只基于选中文本和已提供的元数据回答。\n\n输出格式：\n## 简明解释\n## 放在本章中的作用\n## 可能的延伸理解\n\n{truncationNotice}\n\n{selectedText}",
    "selectionSummary": "书名：{bookTitle}\n作者：{author}\n当前章节：{chapterTitle}\n\n请总结下面的选中文本。只基于选中文本和已提供的元数据回答。\n\n输出格式：\n## 摘要\n## 要点\n## 可继续追问\n\n{truncationNotice}\n\n{selectedText}",
    "chapterNote": "书名：{bookTitle}\n作者：{author}\n章节：{chapterTitle}\n\n请把下面的章节整理成适合保存的 Markdown 读书笔记。\n\n输出格式：\n# {chapterTitle}\n## 摘要\n## 结构\n## 关键观点\n## 概念与术语\n## 摘录\n## 我的思考\n\n摘录只能来自原文，不要伪造引用。\n{truncationNotice}\n\n{text}",
    "qa": "书名：{bookTitle}\n作者：{author}\n章节：{chapterTitle}\n\n问题：{question}\n\n{qaInstruction}\n\n{contextTitle}\n{contextText}",
    "customCommand": "书名：{bookTitle}\n作者：{author}\n章节：{chapterTitle}\n\n请根据下面内容完成命令：{commandTitle}\n\n用户输入：{question}\n\n{contextTitle}\n{contextText}"
  }
}
```

## 自定义命令示例

`cursorEpub.ai.commands` 可以新增 `/` 命令。`context` 决定命令需要什么输入：

- `chapter`：使用当前章节
- `selection`：需要选中文本
- `question`：需要输入问题，使用当前章节
- `selectionQuestion`：需要选中文本，也需要输入问题

```json
{
  "cursorEpub.ai.commands": [
    {
      "label": "/人物分析",
      "title": "人物分析",
      "detail": "分析选中文本中的人物变化",
      "context": "selectionQuestion",
      "prompt": "书名：{bookTitle}\n章节：{chapterTitle}\n\n用户问题：{question}\n\n请基于选中文本分析人物的动机、变化和冲突。\n\n选中文本：\n{selectedText}"
    },
    {
      "label": "/金句提炼",
      "title": "金句提炼",
      "detail": "从当前章节提炼可摘录句子",
      "context": "chapter",
      "prompt": "请从当前章节中提炼 5 条值得摘录的句子，并说明每条为什么值得摘录。\n\n章节：{chapterTitle}\n\n{text}"
    }
  ]
}
```
