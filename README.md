# bili-dynamic-push

TRSS-Yunzai / Yunzai-Bot 群聊 B 站动态推送插件。

## 功能

- 按群设置需要检测的 UP 主 B 站 UID
- 管理本群检测 UID 列表
- 只有主人可以修改推送设置
- 支持推送时 @全体成员
- 支持推送时 @指定成员
- 调用 `bili-card-plugin` 生成高清动态 UI 卡片
- @、卡片图片与“UP主的动态 + 链接”合并为一条群消息

## 安装

将 `bili-dynamic-push` 目录放到 Yunzai 的 `plugins/` 目录下，然后重启 Yunzai。

高清推送需同时安装 `plugins/bili-card-plugin`。如 UI 插件临时渲染失败，动态监控、基线和推送记录不受影响，会回退为 B站原封面。

主插件文件路径应为：

```text
Yunzai/plugins/bili-dynamic-push/biliDynamicPush.js
```

插件会自动创建配置文件：

```text
data/bili-dynamic-push/config.json
```

新动态的发送顺序为（同一条消息）：

```text
@指定成员 / @全体成员
[高清动态 UI 图片]
XXX的动态 https://www.bilibili.com/opus/...
```

## 命令

```text
#动态推送帮助
#动态推送添加 123456
#动态推送删除 123456
#动态推送列表
#动态推送@全体 开启
#动态推送@全体 关闭
#动态推送@成员 添加 10001
#动态推送@成员 删除 10001
#动态推送@成员列表
#动态推送cookie设置 SESSDATA=xxx; bili_jct=xxx; DedeUserID=xxx
#动态推送cookie状态
#动态推送cookie删除
```

设置命令需要在接收推送的群聊中执行，且仅主人可用。

## 说明

添加 UID 时，插件会把该 UP 当前最新动态作为基线，之后定时检查到的新动态才会推送，避免首次添加时刷屏。

如果 B 站接口返回 `HTTP 412`，通常是触发风控。插件会自动尝试使用游客 `buvid3/buvid4` Cookie；如果仍然失败，建议主人使用浏览器登录 B 站后复制 Cookie，并通过 `#动态推送cookie设置 ...` 配置。

默认每 2 分钟检查一次。插件使用 B 站 Web 动态接口：

```text
https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space
```

接口需要 WBI 签名，插件会自动获取并缓存 WBI Key。
