# Mulby Skills

面向 AI 编码工具的 Mulby 开发技能集合。

## `develop-mulby-plugin`

用于创建、修改、验证和打包 Mulby 插件。

这个 skill 会指导 AI 选择插件模板、设计 `manifest.json`、实现后端或 UI、选择 Mulby API、处理插件图标，并在交付前完成构建和打包检查。

主要内容：

- `SKILL.md`：插件开发工作流和交付检查清单
- `references/cli-workflow.md`：插件创建、构建、打包命令
- `references/plugin-development-guide.md`：插件开发规则和集成说明
- `references/api-map.md`：Mulby API 导航
- `references/apis/`：各模块 API 文档
- `scripts/invoke_mulby_cli.mjs`：跨平台调用 Mulby CLI 的脚本

## `generate-electron-icons`

用于从 SVG 生成 Electron 应用图标和托盘图标。

这个 skill 会指导 AI 生成 Windows、macOS、Linux 所需的图标资源，包括 `.ico`、`.icns`、多尺寸 PNG 和托盘图标。

主要内容：

- `SKILL.md`：图标生成工作流和质量检查清单
- `references/platform-requirements.md`：各平台图标尺寸和格式要求
- `scripts/generate_electron_icons.py`：图标生成主脚本
- `scripts/render_svg_variants.mjs`：SVG 渲染辅助脚本
