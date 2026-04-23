---
title: 从零搓一个 CTF AI Agent — 黑板架构 + DAG 多 Agent 框架
description: 用 Python 搭建一个基于黑板架构和 DAG 规划的多 Agent CTF 解题框架，三省六部协同解题，支持全题型、多模型切换。
pubDate: 2026-04-24
tags: ['CTF', 'AI', 'Python', 'Docker', '安全', '多Agent']
---

## 从零搓一个 CTF AI Agent

打 CTF 的时候总有些题想让人工智能帮忙分析，于是干脆自己搓了一个 Agent。不是简单的单 Agent 循环，而是基于**黑板架构 + DAG 规划**的多 Agent 协作框架。



核心特性：
- **三省六部多 Agent 架构** — Reasoner / Strategist / Verifier 三省 + Direction / Compressor / Hallucination 六部
- **DAG 任务规划** — LLM 自动分解解题步骤为依赖图，独立任务并行执行
- **黑板共享记忆** — 所有 Agent 读写同一块黑板，事实、策略、工具结果全局共享
- **难度自适应** — Easy 用单 Agent，Medium 双省 + 方向探索，Hard 全员上阵
- **6 类题型全覆盖** — Web / Crypto / Reverse / Pwn / Forensics / Misc
- **多模型实时切换** — GLM（智谱）/ OpenAI / Claude / Ollama
- **流式 SSE 输出** — 浏览器实时看到每个 Agent 的推理过程

## 架构总览

```
                          ┌──────────────────────────────┐
                          │         Orchestrator         │
                          │    (难度评估 + DAG 调度)      │
                          └──────┬───────┬───────┬───────┘
                                 │       │       │
                    ┌────────────┤       │       ├────────────┐
                    ▼            ▼       ▼       ▼            ▼
              ┌──────────┐ ┌────────┐ ┌────────┐ ┌──────────────┐
              │ Reasoner │ │Strategist│ │Verifier│ │ Direction 1~4│
              │  (分析)   │ │ (策略)  │ │ (验证)  │ │  (方向探索)   │
              └────┬─────┘ └───┬────┘ └───┬────┘ └──────┬───────┘
                   │           │          │             │
                   └───────────┴────┬─────┴─────────────┘
                                    ▼
                           ┌────────────────┐
                           │   Blackboard   │
                           │  (共享记忆)     │
                           │ facts / vulns  │
                           │ strategies     │
                           │ tool_history   │
                           │ flags          │
                           └────────────────┘
                                    ▲
                    ┌───────────────┼───────────────┐
                    │               │               │
              ┌──────────┐   ┌──────────┐   ┌──────────┐
              │Compressor│   │Hallucin. │   │   LLM    │
              │ (记忆压缩)│   │(幻觉检测) │   │ Provider │
              └──────────┘   └──────────┘   └──────────┘
```

## 核心设计：黑板架构

黑板（Blackboard）是整个系统的共享记忆区。所有 Agent 不直接通信，而是通过读写黑板来协作：

```python
class Blackboard:
    # 题目信息
    challenge_description: str
    category: str
    difficulty: str          # easy / medium / hard

    # 结构化工作记忆
    known_facts: list[str]                    # 已确认的事实
    identified_vulnerabilities: list[str]     # 发现的漏洞
    proposed_strategies: list[dict]           # 提出的策略 + 置信度
    attempted_approaches: list[dict]          # 尝试过的方法
    tool_history: list[dict]                  # 工具调用记录
    direction_weights: dict[str, float]       # 方向权重
    hallucination_flags: list[dict]           # 幻觉标记
    flags_found: list[str]                    # 找到的 flag
```

每个 Agent 只做三件事：
1. **读** — `blackboard.get_context_for_agent(name)` 获取定制化上下文
2. **想** — 调用 LLM 推理
3. **写** — 把发现写回黑板（`add_fact`、`add_vulnerability`、`add_strategy`…）

上下文有字符预算（3000 chars），自动压缩历史，保证不超出 LLM 窗口。

## 核心设计：三省六部

借鉴古代治理架构，设计了三层 Agent 体系：

### 三省（核心大脑）

| 省 | 职责 | 输出标记 |
|----|------|----------|
| **Reasoner** | 分析题目，识别漏洞，执行工具 | `[FACT]`、`[VULN]` |
| **Strategist** | 规划攻击策略，排列优先级 | `STRATEGY:`、`DIRECTION_WEIGHT:` |
| **Verifier** | 交叉验证，检测错误，确认 flag | `[VERIFIED]`、`[UNVERIFIED]`、`[CONFIRMED]` |

### 六部（辅助机关）

| 部 | 职责 |
|----|------|
| **Direction 1~4** | 每个方向 Agent 专注一条解题路径，标记 `PROMISING` 或 `DEAD_END` |
| **Compressor** | 每 N 轮压缩工作记忆，防止上下文膨胀 |
| **Hallucination** | 交叉验证 Agent 输出，标记可疑声明 |

### 难度自适应

```python
# Easy 题：单 Agent 足矣
"easy":   { provinces: ["reasoner"], directions: 0 }

# Medium 题：双省 + 2 方向
"medium": { provinces: ["reasoner", "strategist"], directions: 2 }

# Hard 题：全员上阵
"hard":   { provinces: ["reasoner", "strategist", "verifier"], directions: 4 }
```

LLM 先评估题目难度，再决定激活多少 Agent。简单题不浪费 token，难题火力全开。

## 核心设计：DAG 规划

传统做法是 round-robin 轮转（Reasoner → Strategist → Direction → …），效率低且浪费并行机会。

DAG 规划的思路：

1. **LLM 生成计划** — 根据题目描述，LLM 输出一个 JSON 格式的任务依赖图
2. **并行执行** — 没有依赖关系的任务同时跑
3. **动态调整** — 如果进度停滞，重新规划

```
         [analyze]              ← 无依赖，立即执行
          /      \
   [explore_1]  [explore_2]    ← 依赖 analyze，但互相独立，并行执行
          \      /
          [gate]                ← 等所有探索完成，选最优方向
            |
         [execute]              ← 执行最佳攻击方案
            |
         [verify]               ← 验证结果（Hard 题才有）
```

DAG Node 定义：

```python
@dataclass
class DAGNode:
    id: str                    # 唯一标识
    node_type: NodeType        # analyze / explore / execute / verify / gate
    description: str           # 任务描述
    agent_name: str            # 分配给哪个 Agent
    dependencies: list[str]    # 依赖的节点 ID
    state: NodeState           # pending / ready / running / completed / failed
    priority: float            # 优先级（高优先先执行）
```

执行器逻辑：

```python
while not all_done():
    ready = get_ready_nodes()        # 找出所有依赖已完成的节点
    batch = ready[:max_parallel]     # 取前 N 个
    asyncio.gather(*[run(node) for node in batch])  # 并行执行
```

关键优化：
- **Gate 节点**：多分支汇合点，等所有探索完成后再决策
- **失败传播**：节点失败后，依赖它的下游节点自动 skip
- **DAG 重规划**：如果所有节点跑完还没找到 flag，用 LLM 生成新的子任务

## 工具层

四个工具供所有 Agent 共享：

| 工具 | 能力 |
|------|------|
| `PythonExecutor` | subprocess 执行 Python，跑 exploit、z3、密码学脚本 |
| `ShellRunner` | 执行 Shell 命令，带危险命令拦截 |
| `WebSearch` | DuckDuckGo 搜索 writeup |
| `FileAnalyzer` | 文件类型检测、strings、hex dump、元数据 |

工具调用协议 — LLM 输出特殊代码块：

````
```tool
{"tool": "python_executor", "args": {"code": "import hashlib\nprint(hashlib.md5(b'admin').hexdigest())"}}
```
````

## LLM 提供者层

统一接口，运行时切换：

```python
providers = {
    "glm":    GLMProvider,     # 智谱清言，API 兼容 OpenAI 格式
    "openai": OpenAIProvider,
    "claude": ClaudeProvider,
    "ollama": OllamaProvider,  # 本地模型
}
```

GLM 的实现尤其简洁 — 直接复用 `openai` 库，只改 `base_url`：

```python
self._client = OpenAI(
    api_key=config.glm_api_key,
    base_url="https://open.bigmodel.cn/api/paas/v4",
)
```

## 项目结构

```
ctf-agent/
├── ctf_agent/
│   ├── config.py                  # 配置管理
│   ├── llm/                       # LLM 提供者
│   │   ├── base.py
│   │   ├── glm_provider.py
│   │   ├── openai_provider.py
│   │   ├── claude_provider.py
│   │   └── ollama_provider.py
│   ├── tools/                     # 工具层
│   │   ├── python_executor.py
│   │   ├── shell_runner.py
│   │   ├── web_search.py
│   │   └── file_analyzer.py
│   ├── solvers/                   # 题型特化 Solver
│   ├── agent/
│   │   ├── blackboard.py          # 黑板（共享记忆）
│   │   ├── dag.py                 # DAG 规划器 + 执行器
│   │   ├── orchestrator.py        # 总调度器
│   │   ├── difficulty.py          # 难度评估
│   │   ├── router.py              # 题型分类
│   │   ├── base_agent.py          # Agent 基类
│   │   ├── provinces/             # 三省
│   │   │   ├── reasoner.py        #   分析推理
│   │   │   ├── strategist.py      #   策略规划
│   │   │   └── verifier.py        #   验证确认
│   │   └── ministries/            # 六部
│   │       ├── direction.py       #   方向探索
│   │       ├── compressor.py      #   记忆压缩
│   │       └── hallucination.py   #   幻觉检测
│   └── web/
│       ├── server.py              # FastAPI 后端
│       └── static/
│           ├── index.html
│           └── style.css
├── Dockerfile
├── docker-compose.yml
└── requirements.txt
```

## 部署

```bash
# 1. 传到服务器
scp -r ctf-agent root@你的服务器:/root/

# 2. 配置
cd /root/ctf-agent
cp .env.example .env
# 填入 GLM_API_KEY

# 3. 启动
docker compose up -d ctf-agent



## 总结

这个项目的核心设计理念：

1. **黑板架构** — Agent 之间不直接通信，通过共享黑板协作，松耦合、可扩展
2. **DAG 规划** — 自动分解任务、并行执行、动态调整，比 round-robin 高效得多
3. **三省六部** — 不同 Agent 有不同职责，分工明确，互相验证
4. **难度自适应** — 简单题轻量跑，难题火力全开，不浪费 token
5. **多模型切换** — 同一套接口适配所有模型，GLM/OpenAI/Claude/Ollama 随时切

这个框架不限于 CTF，任何需要多 Agent 协作的复杂任务都可以复用这套黑板 + DAG 架构。
