---
title: "数据库提权：MySQL、MSSQL、Oracle自动化"
pubDate: 2026-08-20
tags:
  - 安全
  - 提权
---

路线是：Web 权限 → 数据库权限 → 计算机系统权限

## 三个数据库先认识

| 数据库 | 性质 | 端口 | 最高权限账户 | 默认外连 | 适用场景 |
|---|---|---|---|---|---|
| MySQL | 开源 | 3306 | root | 否 | 网站、初创公司，和 PHP/Python/Java 集成好 |
| MSSQL | 微软闭源（SQL Server） | 1433 | sa | 是 | 企业、政府，和 Windows/.NET 深度绑定 |
| Oracle | Oracle 闭源 | 1521 | SYS / SYSTEM | 是 | 金融、电信、大型机构的关键业务 |

MySQL 和 MSSQL/Oracle 的默认外连差异直接决定打法：MySQL 拿到账密也连不上，必须先解决外连；后两个能直连，拿到账密就等于拿到入口

## 提权流程

### 1、获取数据库账号密码

```shell
网站存在SQL注入漏洞
数据库的存储文件或备份文件
网站应用源码中的数据库配置文件
采用工具或脚本爆破账号密码
```

最常见的还是第三条：拿下 Web 权限（马哥斯拉/蚁剑连接）后翻源码目录找配置文件——PHP 看数据库连接文件、Zblog/WordPress 各有固定位置，翻出 host/账号/密码

### 2、自动化提权项目

- **MDUT - 图形化**：https://github.com/SafeGroceryStore/MDUT
- **Sylas - 图形化**：https://github.com/Ryze-T/Sylas

MDUT 启动方式（java8 环境）：

```shell
java8 -jar .\Multiple.Database.Utilization.Tools-2.1.1-jar-with-dependencies.jar
```

但

### 3、解决不支持外连的问题

数据库不让从外网直连时有两种办法：

1. **隧道代理**：利用已有 Web 权限建代理节点，工具连接走代理 等同于本地连接。内网渗透通用解法
2. **数据库配置**：利用已有权限执行 SQL 直接开启外连。数据库管理功能连上后执行：

MySQL

```mysql
GRANT ALL PRIVILEGES ON *.* TO '账号'@'%' IDENTIFIED BY '密码' WITH GRANT OPTION;
flush privileges;
```

`'%'` 就是允许任何 IP 连，flush 让权限立即生效

MSSQL

```sql
EXEC sp_configure 'show advanced options', 1;
RECONFIGURE;
EXEC sp_configure 'Ad Hoc Distributed Queries', 1;
RECONFIGURE;
```

Oracle

```sql
ALTER SYSTEM SET REMOTE_LOGIN_PASSWORDFILE=EXCLUSIVE SCOPE=SPFILE;
SHUTDOWN IMMEDIATE;
STARTUP;
```

## MySQL 提权

**提权条件**：

1. root 密码
2. `my.ini/my.conf` 里 `secure-file-priv` 为空
3. 存在 `MySQL\lib\plugin` 目录

**提权技术**：UDF、MOF、启动项、反弹 shell

**MDUT 打法**：

1. 启动 MDUT，选 MySQL 填账密，点测试连接——会失败，因为 MySQL 默认不许外连
2. 数据库管理里执行上面的 GRANT 两条开外连
3. 回 MDUT 再测，连接成功
4. 直接点执行命令——不用 UDF 也能出结果
5. 原始执行不了就点 UDF 提权，再执行命令

## MSSQL 提权

**提权条件**：知道 sa 密码

**提权技术**

- **xp_cmdshell**：扩展存储过程，直接执行系统命令。2005 之后默认关闭，利用前要先启用（EXEC sp_configure 'xp_cmdshell', 1）
- **sp_oacreate**：调 COM 组件（OLE 自动化）执行命令，xp_cmdshell 被删时的替补
- **CLR 沙盒**：写 .NET 程序集进数据库当存储过程跑，前两个都不行时的替补

**演示流程**：哥斯拉拿 Web 权限 → 翻出 sa 账密 → 哥斯拉自带数据库管理工具连接验证 → MDUT 直接连，三个技术一个个试

## Oracle 提权

**提权条件**：知道数据库账号密码（不一定是 SYS/SYSTEM，普通用户的账密也有对应打法）

**提权技术**（三种模式，看手上账密的权限选）：

- **DBA 模式**：拿到的是 DBA 高权限账密，直接命令执行
- **普通用户模式**：低权限账密，先提权到 DBA 再执行
- **注入模式**：目标不让直连数据库，只有注入点时走这条

## 要点

MySQL 这条线就是开外连后打 UDF，MSSQL 这条线就是打 xp_cmdshell，Oracle 这条线就是按 DBA、普通用户、注入三种模式去执行系统命令
