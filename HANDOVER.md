# 运行与维护提示

- 修改 preset 后必须真正重启 DSH 进程：改文件不等于已重启，伪重启不生效。详见 [INSTALL.md](INSTALL.md)「常见报错」。
- 面板加载异常（`Failed to load plugins` / `loaded without registering`）时，先确认进程已真正重启，再核对迁移配置。详见 [INSTALL.md](INSTALL.md)「迁移」。
- DSH Web 服务日志：`~/.dsh-web.log`。
