---
title: "Win系统提权：服务启动、远程管理、进程注入、令牌窃取"
pubDate: 2026-08-18
tags:
  - 安全
  - 提权
---

从 Administrator 到 SYSTEM 的四种方法。前提场景：钓鱼拿到计算机用户权限，需要 SYSTEM 做敏感操作或权限维持  降权——域环境里和域用户通信，要么是域用户要么是 SYSTEM，Administrator 反而不行，提权不上去就得降权

## 服务启动（sc 命令）

Windows 服务默认以 SYSTEM 运行    创建服务指向恶意程序，启动即 SYSTEM：

```shell
sc Create ulin binPath= "C:\Users\Administrator\Desktop\artifact.exe"
# 注意 binPath= 后面必须有个空格
```

然后启动该服务，MSF/CS 上线就是 SYSTEM

## 远程管理（PsTools）

微软官方运维工具（https://docs.microsoft.com/zh-cn/sysinternals/downloads/pstools ），不会被杀软查杀、属于正常流量  目标机执行：

```shell
psexec.exe -accepteula -s -i -d cmd
```

弹出的新 CMD 就是 SYSTEM 权限，在里面跑恶意程序上线

## 进程注入

把恶意代码塞进其他合法进程让它替我运行——既隐藏自身，又继承对方的令牌/内存/网络连接，绕白名单/EDR/防火墙（免杀也用）

**MSF**：上线后 `ps` 看进程（要有 Administrator 权限才能看到 SYSTEM 进程），注入 SYSTEM 进程如 svchost.exe：

```shell
migrate <PID>
```

成功即 SYSTEM。反向降权也行（注入低权限进程）

**CS**：右键会话看进程列表 → 选中目标进程点注入按钮（自动选 payload）或命令行 `inject <PID>`。优先点按钮方式

## 令牌窃取

把 SYSTEM/Administrator 的访问令牌借过来放自己线程上变高权限，不用知道密码

**MSF**：

```shell
use incognito                           
list_tokens -u                          
impersonate_token "NT AUTHORITY\SYSTEM"  
```

**CS**：右键进程选令牌窃取，或命令：

```shell
steal_token <PID>   # 窃取进程令牌
spawnu <PID>        # 窃取令牌并上线新会话
```

## 要点

Administrator → SYSTEM 按场景选：能执行命令就用 sc 创建服务（最直接）；要伪装成正常运维流量用 PsTools 官方工具；已经上线了用 MSF migrate/CS inject 进程注入（顺带隐藏）；想复用现有高权限身份就 incognito 令牌窃取  降权的需求记住域那条规则：域通信只认域用户和 SYSTEM，Administrator 不行——提权不上去时降权到域用户照样打域内交互
