---
title: 加密栏目使用说明
pubDate: 2026-08-03
tags:
  - 测试
  - meta
---

## 这里是第一篇每日学习笔记

你看到这段文字说明密码输入正确 ✅。

### 怎么写新笔记

1. 在 `src/content/daily/` 下新建一个 `.md` 文件，比如 `2026-08-04-pwn-notes.md`
2. 文件头部必须有 frontmatter：

   ```yaml
   ---
   title: 你的标题
   pubDate: 2026-08-04
   tags:
     - pwn
     - ctf
   ---
   ```

3. 下面就是正文，支持完整 markdown（代码块、列表、表格、图片都行）
4. `git push` 后，GitHub Actions 会重新构建，密码不变的话老链接照常打开

### 注意

- 这篇文章在浏览器里是加密的，但**仓库里的源码是公开的**
- 想真正私密的内容，请用别的工具（Obsidian / Notion / 私有仓库）
- 改密码 = 改 `.env` 和 GitHub secret，然后重新 `git push` 触发构建

### 测试一下

代码块渲染：

```python
def hello():
    print("encrypted but readable in source")
```

列表渲染：

- 第一项
- 第二项
  - 嵌套项
