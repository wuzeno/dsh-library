# DSH 资料库 v1.0.1 · 新对话默认通用模式

这次调整只有一个使用习惯：**新建对话默认使用通用模式**。平时直接聊天，需要参考项目文件时，再点击对话框里的资料范围入口，手动开启资料库模式。

## 已有对话怎么处理？

已有对话在当前工作区内保存的模式选择保持不变。如果之前已经手动开启资料库模式，更新后仍然保留；没有有效保存记录的对话采用新的通用模式默认值。新对话与 fork 不继承其他会话的模式或额外授权。

工作区资料库、已导入文件和存储位置均保持原样。本次无需重新导入资料。

## 下载与更新

下载 **`dsh-library-1.0.1.tgz`** 插件安装包，在 DSH 插件管理器中更新并启用。完整退出 DSH（含托盘后台进程），再重新启动并刷新页面，以确保新版前后端一起生效。

附件：
- `dsh-library-1.0.1.tgz`：插件安装包。
- `dsh-library-1.0.1-source.zip`：公开源码、测试和文档。
- `dsh-library-1.0.1-SHA256SUMS.txt`：两份归档的 SHA-256 校验和。

## 验证

本地完整回归共 268 项，266 通过、2 跳过、0 失败。新增覆盖新对话默认通用、未开启时不注入资料或交付附件、手动开启后可用、已保存选择重启后保持，以及切回通用模式后的读取限制。跨平台结果见仓库 GitHub Actions。

## English

New conversations now start in **general mode**. To reference project files, open the library scope control in the conversation and enable library mode. Explicitly saved choices remain unchanged. Your libraries, imported files, and storage location are preserved. Fully restart DSH after updating.
