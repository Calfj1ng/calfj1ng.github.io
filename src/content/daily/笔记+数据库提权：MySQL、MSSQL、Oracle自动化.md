---
title: "数据库提权：MySQL、MSSQL、Oracle自动化"
pubDate: 2026-08-19
tags:
  - 安全
  - 提权
---

Win 提权数据库篇，路线还是那条：Web 权限 → 数据库权限 → 计算机系统权限。以工具为主，实战拿到账密直接一把梭

## 三个数据库先认识

| 数据库 | 端口 | 最高权限账户 | 默认外连 |
|---|---|---|---|
| MySQL | 3306 | root | 否 |
| MSSQL | 1433 | sa | 是 |
| Oracle | 1521 | SYS / SYSTEM | 是 |

## 提权流程

**1、拿账密**的四条路：

```shell
SQL注入漏洞
数据库存储文件或备份文件
网站源码里的数据库配置文件
工具/脚本爆破（解决外连问题）
```

**2、自动化提权项目**

- MDUT：https://github.com/SafeGroceryStore/MDUT
- Sylas：https://github.com/Ryze-T/Sylas
- Databasetools：https://github.com/Hel10-Web/Databasetools

**3、解决不支持外连**（MySQL 默认不让连）：两种办法——用 Web 权限建代理节点让工具走隧道（内网打法），或者连上数据库执行 SQL 开外连。数据库管理中执行：

MySQL：

```mysql
GRANT ALL PRIVILEGES ON *.* TO '账号'@'%' IDENTIFIED BY '密码' WITH GRANT OPTION;
flush privileges;
```

MSSQL（开 Ad Hoc 分布式查询）：

```sql
EXEC sp_configure 'show advanced options', 1;
RECONFIGURE;
EXEC sp_configure 'Ad Hoc Distributed Queries', 1;
RECONFIGURE;
```

Oracle：

```sql
ALTER SYSTEM SET REMOTE_LOGIN_PASSWORDFILE=EXCLUSIVE SCOPE=SPFILE;
SHUTDOWN IMMEDIATE;
STARTUP;
```

## MySQL 提权

条件：root 密码 + `secure-file-priv` 为空 + 存在 `MySQL\lib\plugin` 目录。技术：UDF、MOF、启动项、反弹 shell

演示环境 WinServer2022 + phpstudy + MySQL5.7 + Zblog，连接后翻出数据库配置，MDUT 启动：

```shell
java8 -jar .\Multiple.Database.Utilization.Tools-2.1.1-jar-with-dependencies.jar
```

先按上面的 GRANT 开外连再测，成功后直接执行命令——不用 UDF 也能出结果；不行就点 UDF 提权再执行。UDF 报错的话，在 `C:\phpstudy_pro\Extensions\MySQL5.7.26` 下手动建 `lib\plugin` 目录

## MSSQL 提权

条件：sa 密码。技术：`xp_cmdshell`、`sp_oacreate`、CLR 沙盒

拿 Web 权限翻出 sa 账密，自带数据库管理工具连上验证没问题，然后 MDUT 直接连（默认支持外连不用折腾），进去一个个试

## Oracle 提权

条件：数据库账密。模式：DBA、普通用户、注入模式。同样工具梭哈，MDUT/Template 连上选对应模式打

## 要点

这讲核心记流程：翻配置文件拿账密 → 判数据库类型 → MySQL 先解决外连（GRANT 那两条或隧道代理）→ MDUT 一把梭。三库口诀：MySQL 看 UDF（secure-file-priv + lib/plugin 目录俩前提），MSSQL 三件套 xp_cmdshell/sp_oacreate/CLR，Oracle 分 DBA/普通用户/注入三种模式
