---
title: 从零搓一个 CTF AI Agent
description: 用 Python + FastAPI + Docker 搭建一个支持全题型、多模型切换的 CTF 自动解题 Agent，部署到服务器通过浏览器使用。
pubDate: 2026-04-23
tags: ['CTF', 'AI', 'Python', 'Docker', '安全']
---

## 从零搓一个 CTF AI Agent

打 CTF 的时候总有些题想让人工智能帮忙分析，于是干脆自己搓了一个 Agent，支持全题型、多模型切换，部署到服务器上用浏览器就能打。

## 最终效果

浏览器打开 `http://你的服务器:5050`，输入题目描述，Agent 自动分类题型、分析、调工具、找 flag。

支持的功能：
- **6 类题型全覆盖** — Web / Crypto / Reverse / Pwn / Forensics / Misc
- **多模型实时切换** — GLM（智谱）/ OpenAI / Claude / Ollama 本地模型
- **4 种工具** — Python 代码执行、Shell 命令、Web 搜索、文件分析
- **流式输出** — SSE 实时推送 Agent 推理过程
- **Docker 一键部署**

## 项目结构

```
ctf-agent/
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── pyproject.toml
├── .env.example
├── ctf_agent/
│   ├── config.py              # 配置管理（多模型 API Key）
│   ├── cli.py                 # CLI 交互模式
│   ├── __main__.py
│   ├── llm/                   # LLM 提供者层
│   │   ├── base.py            # 抽象接口
│   │   ├── glm_provider.py    # 智谱 GLM
│   │   ├── openai_provider.py
│   │   ├── claude_provider.py
│   │   └── ollama_provider.py
│   ├── tools/                 # 工具层
│   │   ├── base.py
│   │   ├── python_executor.py # Python 沙箱执行
│   │   ├── shell_runner.py    # Shell 命令执行
│   │   ├── web_search.py      # DuckDuckGo 搜索
│   │   └── file_analyzer.py   # 文件/二进制分析
│   ├── solvers/               # 题型求解器
│   │   ├── base.py
│   │   ├── web.py
│   │   ├── crypto.py
│   │   ├── reverse.py
│   │   ├── pwn.py
│   │   ├── forensics.py
│   │   └── misc.py
│   ├── agent/
│   │   ├── core.py            # Agent 核心编排
│   │   └── router.py          # 题型自动分类
│   └── web/
│       ├── server.py          # FastAPI 后端
│       └── static/
│           ├── index.html     # Web 前端
│           └── style.css
```

## 架构设计

整体架构分四层：

```
浏览器 → FastAPI 后端 → Agent Core → LLM（GLM/OpenAI/Claude/Ollama）
                              ↓
                         Tool System
                    （Python/Shell/搜索/文件分析）
```

### 1. LLM 提供者层

定义了一个 `BaseLLM` 抽象接口，所有模型提供者统一实现 `chat()` 方法：

```python
class BaseLLM(ABC):
    @abstractmethod
    def chat(self, messages: list[dict], temperature=None, max_tokens=None) -> str: ...
    
    @abstractmethod
    def model_name(self) -> str: ...
```

每个 Provider 只做一件事：把 messages 喂给对应的 API，返回文本。GLM 的 API 兼容 OpenAI 格式，所以直接复用 `openai` 库，改一下 `base_url` 就行：

```python
from openai import OpenAI

class GLMProvider(BaseLLM):
    def __init__(self, config):
        self._client = OpenAI(
            api_key=config.glm_api_key,
            base_url="https://open.bigmodel.cn/api/paas/v4",
        )
    
    def chat(self, messages, temperature=None, max_tokens=None) -> str:
        response = self._client.chat.completions.create(
            model=self.config.glm_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return response.choices[0].message.content
```

运行时切换模型就是换个 Provider 实例，一行搞定。

### 2. 工具层

四个工具，每个继承 `BaseTool`，实现 `run()` 方法：

| 工具 | 能力 |
|------|------|
| `PythonExecutor` | 通过 subprocess 执行 Python 代码，用于写 exploit 脚本、z3 求解、密码学计算 |
| `ShellRunner` | 执行 Shell 命令，curl 探测、checksec、file 命令等，带危险命令拦截 |
| `WebSearch` | DuckDuckGo 搜索，搜 writeup 和参考 |
| `FileAnalyzer` | 文件类型检测、strings 提取、hex dump、元数据分析 |

工具的调用方式是 LLM 在回复中输出特殊格式的代码块：

````
```tool
{"tool": "python_executor", "args": {"code": "print(2**256)"}}
```
````

Agent 解析到这个块后执行工具，把结果回注到对话中，继续推理。

### 3. 题型求解器

6 个 Solver，每个有专门的 System Prompt：

```python
class WebSolver(BaseSolver):
    @property
    def system_prompt(self) -> str:
        return (
            "You are an elite web security expert specializing in CTF web challenges. "
            "You have deep expertise in: SQL injection, XSS, SSRF, LFI/RFI, SSTI, "
            "XXE injection, CSRF, IDOR, JWT attacks, deserialization..."
        )
    
    def get_tools(self):
        return [PythonExecutor(self.config), ShellRunner(self.config), ...]
```

不同题型配不同工具组合。Crypto 不需要 Shell（防止瞎跑命令），Pwn 和 Reverse 全给。

### 4. 题型路由

关键词打分分类器，对题目描述做关键词匹配，得分最高的类别胜出：

```python
def classify_challenge(description: str) -> str:
    scores = {"web": 0, "crypto": 0, "reverse": 0, "pwn": 0, "forensics": 0, "misc": 0}
    for category, keywords in KEYWORDS.items():
        for kw in keywords:
            scores[category] += len(re.findall(re.escape(kw), text))
    return max(scores, key=scores.get)
```

也可以手动覆盖，底部选栏直接指定。

### 5. Web 层

FastAPI 后端 + 纯 HTML/CSS/JS 前端。关键点是用 SSE（Server-Sent Events）做流式输出，Agent 每一步推理都实时推送到浏览器：

```python
async def solve_stream(agent, description, files, category):
    yield json.dumps({"type": "category", "content": cat})
    for turn in range(20):
        yield json.dumps({"type": "thinking", "content": f"Turn {turn+1}..."})
        response = await asyncio.to_thread(agent.llm.chat, agent._conversation)
        yield json.dumps({"type": "response", "content": response})
        # ... 解析工具调用、执行、返回结果
        if flag:
            yield json.dumps({"type": "flag", "content": flag})
            return
```

前端用 `fetch` + `ReadableStream` 消费 SSE，逐条解析 JSON 事件渲染到聊天区。

## 部署

### Docker 一键启动

```bash
# 1. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 GLM_API_KEY

# 2. 启动
docker compose up -d ctf-agent

# 3. 访问
http://你的服务器IP:5050
```

### docker-compose.yml

```yaml
services:
  ctf-agent:
    build: .
    ports:
      - "5050:5050"
    environment:
      - DEFAULT_LLM=glm
      - GLM_API_KEY=${GLM_API_KEY}
    restart: unless-stopped

  ollama:                    # 可选：本地模型
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama-data:/root/.ollama
```

如果只要 API 模式（不需要 GPU），只启动 `ctf-agent` 就行。要跑本地模型就一起启动 `ollama`，在网页上切到 ollama 即可。

## 使用示例

打开浏览器，输入题目描述：

> 这道题给了一个登录页面 http://xxx.com/login，试了 admin' OR 1=1-- 返回了错误信息...

Agent 会：
1. 自动识别为 Web 题
2. 调用 Shell 工具 curl 探测目标
3. 分析响应，构造注入 payload
4. 调用 Python 执行自动化脚本
5. 提取 flag

整个过程实时显示在聊天区，工具调用可折叠查看。

## 总结

这个项目的核心思路：

1. **统一 LLM 接口** — 不同模型同一套调用方式，运行时切换
2. **工具调用协议** — 用 markdown 代码块约定工具调用格式，简单可靠
3. **题型特化 Prompt** — 不同类别用不同的 System Prompt，专业度拉满
4. **流式 SSE** — Agent 思考过程实时可见，不会对着空白页面干等

项目地址在桌面 `ctf-agent` 目录，有兴趣可以自己改着玩。
