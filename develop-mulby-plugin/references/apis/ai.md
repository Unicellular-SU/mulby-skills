# AI API (ai)
本文档描述 AI API (ai) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.mulby.ai`
> - 插件后端：`context.api.ai`

> 安全边界：
> - 插件可使用 `ai.call`、`abort`、`allModels`、附件 `buffer` 上传、Token 估算、旧图片接口、`images.providers.describe`、`images.validateInput` 和 `images.tasks.*` 持久化任务。图片任务、事件、输入附件和制品均按插件身份隔离；系统应用可查看全部任务。
> - 宿主**管理/写入**能力仅允许系统渲染窗口（主应用/设置页/首次引导页）调用，插件 UI 由 IPC 层拒绝：AI 设置读写（`settings.get`/`update`）、Provider 探测与连接测试（`models.fetch`、`testConnection`/`testConnectionStream`）、MCP 服务器增删改与连通性/日志（`mcp.getServer`/`upsertServer`/`removeServer`/`activateServer`/`deactivateServer`/`restartServer`/`checkServer`/`abort`/`getLogs`）、Skills 安装/删除/启停/刷新（`skills.refresh`/`install`/`remove`/`enable`/`disable`）、WebSearch 全局配置读写（`tooling.webSearch.get`/`update`）、插件工具禁用写入（`tooling.pluginTools.setDisabled`）。
> - 以下**只读发现 / 低敏切换**能力对插件 UI 开放（不含密钥与全局敏感配置）：`skills.list`/`listEnabled`/`get`/`preview`/`resolve`、`mcp.listServers`（返回脱敏视图）/`listTools`、`tooling.webSearch.getSettings`/`setActiveProvider`、`tooling.pluginTools.getDisabled`。
> - `attachments.upload({ filePath })` 仅允许系统渲染窗口使用；插件 UI/后端如需上传文件，应先在已授权范围内读取为 `ArrayBuffer`/`buffer` 后再上传，避免让主进程代读任意本地路径。

---

## 基础调用

### call(option, onChunk?)
[Renderer] [Backend]
调用文本模型。`onChunk` 传入时启用流式回调。

```javascript
const message = await ai.call({
  model: 'openai:gpt-4o-mini',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello' }
  ]
});
```

**参数**:
- `option` (AiOption)
  - `model` (string) - 模型 ID（如 `openai:gpt-4o-mini`）
  - `messages` (AiMessage[]) - 对话消息
  - `params` (AiModelParameters) - 覆盖参数（可选）。除 `temperature`/`topP`/`maxOutputTokens`/`reasoningEffort`/`thinking` 外，还支持 `responseFormat`/`jsonSchema` 等**结构化输出**参数（见下文「结构化输出（JSON 模式 / JSON Schema）」）
  - `tools` (AiTool[]) - 工具定义（Function Calling）
  - `capabilities` (string[]) - 内置工具能力声明（可选）
  - `internalTools` (string[]) - 旧版内置工具声明（可选，已废弃，建议改用 `capabilities`）
  - `toolingPolicy` (object) - 内置工具能力策略（可选）
  - `mcp` (AiMcpSelection) - MCP 工具选择策略（可选）
  - `skills` (AiSkillSelection) - 技能选择策略（可选）
  - `toolContext` (AiToolContext) - 工具执行上下文（可选）
  - `maxToolSteps` (number) - 工具调用最大步数（默认 20，范围 1-300）

**返回值**:
- Renderer：`Promise<AiMessage>`；最终消息包含可选 `usage`
- Backend：`Promise<AiMessage>`
- 仅 Renderer 流式调用的第一个 chunk 会携带合成字段 `__requestId`，可用于后续调用 `ai.abort(requestId)` 中止请求；该字段只存在于流式回调，不属于最终 `AiMessage`

```javascript
const req = ai.call(
  {
    model: 'openai:gpt-4o-mini',
    messages: [{ role: 'user', content: 'Tell me a joke.' }]
  },
  (chunk) => console.log(chunk.content)
);

// ❌ 错误：在渲染进程（contextBridge 环境）中，req.abort 不可用
// req.abort?.();

// ✅ 正确：使用独立的 ai.abort(requestId)（见下文）
```

> 插件 Backend 运行在隔离 UtilityProcess 中，函数回调和 Promise 自定义属性不能经 `postMessage` 传递，因此 `context.api.ai.call()` / `mulby.ai.call()` 只支持等待最终结果，不会收到 `onChunk`，也不能使用 `req.abort()`。需要可中止的文本流时请在 Renderer 调用。

### 结构化输出（JSON 模式 / JSON Schema）

通过 `option.params` 让模型从**源头**产出结构化结果，而非靠提示词约束后再解析。把"是否合法 JSON / 是否符合结构"的保证从软（prompt）提升到 API 级。

**参数**（均在 `params` 内，可选）：
- `responseFormat`: `'json_object' | 'json_schema'`
  - `'json_object'`：约束输出为**合法 JSON**（不含前言/markdown 围栏），结构由你的 prompt 描述。最通用、最稳妥。
  - `'json_schema'`：进一步要求输出**符合 `jsonSchema`**。需配合 `jsonSchema`。
- `jsonSchema` (`Record<string, unknown>`)：JSON Schema（建议 draft 2020-12 子集），`responseFormat: 'json_schema'` 时生效。
- `jsonSchemaName` (string)：schema 名称（OpenAI 需要），默认 `output`。
- `strict` (boolean)：严格模式（OpenAI `strict` / 增强遵守），默认 `true`。严格模式下 schema 通常需为"封闭"结构（所有字段在 `required`、`additionalProperties: false`）。

> 使用 `json_object` 时，请确保你的提示词中出现 "JSON" 字样（OpenAI 等要求），否则部分 provider 会拒绝。

**Provider 覆盖**：
| Provider | 机制 | 状态 |
|---|---|---|
| OpenAI / openai-compatible / ollama / deepseek / openrouter / azure | 请求体 `response_format` | ✅ |
| 走 AI SDK 的 provider（含 Google Gemini） | AI SDK `Output`（自动映射 Gemini `responseSchema` 等） | ✅（无 `tools` 时） |
| Anthropic 原生端点 | — | ⚠️ 暂不注入（其原生结构化字段尚不稳定），建议经 SDK 或在应用层兜底 |

> 注意：`responseFormat` 与 `tools`（函数调用）不建议同时使用；当存在工具时结构化输出不会启用。少数老旧端点可能不支持 `response_format`，建议仍在应用层对结果做校验/重试。

**示例 — JSON 模式（推荐，最稳妥）**：
```javascript
const msg = await window.mulby.ai.call({
  model,
  messages: [
    { role: 'system', content: '只输出一个合法的 JSON 对象，包含 scenes 数组。' },
    { role: 'user', content: storyText }
  ],
  params: { responseFormat: 'json_object' }
});
const data = JSON.parse(msg.content); // 已是合法 JSON
```

**示例 — JSON Schema（约束结构）**：
```javascript
const msg = await window.mulby.ai.call({
  model,
  messages: [{ role: 'user', content: '提取人物信息' }],
  params: {
    responseFormat: 'json_schema',
    jsonSchemaName: 'person',
    strict: false,
    jsonSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' }
      },
      required: ['name']
    }
  }
});
```

### abort(requestId)
[Renderer] [Backend]
中止指定请求 ID 的进行中调用。**在渲染进程（插件 UI）中，这是唯一可靠的中止方式。**

```javascript
await ai.abort(requestId);
```

> **重要**：在渲染进程中，`ai.call()` 返回的 `req.abort()` 方法由于 Electron `contextBridge` 的序列化限制**无法正常工作**（附加在 Promise 对象上的属性在跨越 context 边界时会丢失）。请始终使用 `ai.abort(requestId)`。

---

## ⚠️ 流式调用 + 中止 完整最佳实践（渲染进程）

在渲染进程（插件 UI）中实现流式 AI 调用并支持用户中止，必须遵循以下模式：

```tsx
import { useRef, useState } from 'react';

const ai = () => (window as any).mulby?.ai;

function MyAiComponent() {
  const [isStreaming, setIsStreaming] = useState(false);
  const abortedRef = useRef(false);        // 用户已点击中止的标志
  const requestIdRef = useRef<string | null>(null);  // 当前请求的 requestId

  const handleSend = async (userMessage: string) => {
    abortedRef.current = false;
    requestIdRef.current = null;
    setIsStreaming(true);

    try {
      const req = ai().call(
        { model: 'openai:gpt-4o-mini', messages: [{ role: 'user', content: userMessage }] },
        (chunk: any) => {
          // 第一个 chunk 携带 __requestId，必须捕获以便后续中止
          if (chunk.__requestId) {
            requestIdRef.current = chunk.__requestId;
            return;
          }
          // 用户已中止时忽略后续 chunk（防止 UI 继续更新）
          if (abortedRef.current) return;

          if (chunk.chunkType === 'text') {
            // 更新 UI...
          }
        }
      );

      const finalMsg = await req;
      if (abortedRef.current) return; // 中止后不写入最终结果

      // 使用 finalMsg...
    } catch (err: any) {
      const isAbort = abortedRef.current
        || err?.name === 'AbortError'
        || String(err?.message).toLowerCase().includes('aborted');
      if (isAbort) return; // 中止后静默退出
      // 处理其他错误...
    } finally {
      setIsStreaming(false);
    }
  };

  const handleStop = () => {
    abortedRef.current = true;
    // ✅ 正确：使用顶层 ai.abort(requestId)，contextBridge 安全
    if (requestIdRef.current) {
      ai()?.abort?.(requestIdRef.current);
    }
    setIsStreaming(false);
  };

  return (
    <div>
      {isStreaming && <button onClick={handleStop}>停止</button>}
    </div>
  );
}
```

**关键点说明**：

| 事项 | 说明 |
|------|------|
| `req.abort()` | ❌ 渲染进程不可用。原因：`contextBridge` 序列化时会丢失附加在 Promise 上的属性 |
| `ai.abort(requestId)` | ✅ 渲染进程唯一可靠的中止方式，通过标准 IPC 通道发送 |
| `chunk.__requestId` | 第一个 chunk 携带的请求 ID，**必须在 chunk 回调中捕获** |
| `abortedRef` | 必须用 `useRef`（不是 `useState`），中止后立刻同步生效，防止后续 chunk 继续写入 UI |
| `catch` 中 isAbort 判断 | `abort` 会导致 Promise reject，需要在 catch 中静默处理 |

### MCP 参与调用

当 `option.mcp.mode !== 'off'` 时，AI 调用会自动挂载 MCP 工具（来自已启用的 MCP 服务器），并按 `serverIds/allowedToolIds` 与 `toolContext.mcpScope` 做过滤。

```javascript
const result = await ai.call({
  model: 'openai:gpt-4o-mini',
  messages: [{ role: 'user', content: '帮我调用本地文件工具列目录' }],
  mcp: {
    mode: 'manual',
    serverIds: ['filesystem'],
    allowedToolIds: ['mcp__filesystem__list_directory']
  }
});
```

> `allowedToolIds` 支持传工具 ID（推荐）或工具名。  
> MCP 工具 ID 格式：`mcp__<serverId>__<toolName>`。

---

## 工具调用（Function Calling）

Mulby 提供 **两种相互独立** 的"插件工具"机制，新手非常容易混淆。两者**互不依赖、互不必要**：

| 维度 | A. 插件内部工具（`option.tools` 直传） | B. 全局共享工具（`manifest.tools` 注册） |
|---|---|---|
| 适用场景 | 插件**自己**调用 `ai.call` 时让模型回调本插件的方法 | 把工具**暴露**给 Mulby 内置 AI、其他插件、以及外部 MCP 客户端（Claude / Cursor / Cherry Studio） |
| 是否需要在 `manifest.tools` 声明 | ❌ **不需要** | ✅ **必须**声明 |
| 是否需要调用 `api.tools.register(name, handler)` | ❌ **不需要** | ✅ 必须在 host-worker 内注册 handler |
| 工具命名 | 直接用插件 host 导出的方法名（如 `getSystemInfo`） | 自动包装为 `plugin_tool__{sanitizedPluginId}__{toolName}`（系统会做规范化与重名去重） |
| 工具执行路径 | 宿主收到 AI 的 tool_call 后，按 host RPC 协议直接调用 `host.{toolName}(args)`（不区分前缀，是 toolExecutor 的兜底分支） | 宿主从 `plugin_tool__` 前缀解出 sanitizedId，查 `PluginToolRegistry` 还原原始 pluginId，调用对应插件 host-worker 内 `register` 注册的 handler |
| 工具可见性 | 仅在本次 `ai.call` 调用中对 AI 模型可见 | 全局可见：Mulby 内置 AI / 其他插件的 AI 调用 / 外部 AI 客户端（通过 MCP Server）都能看到 |
| 是否可被用户禁用 | 否（每次 `ai.call` 时动态传入） | 是（设置中按 `pluginId:toolName` 禁用，影响所有调用方） |
| 进度上报通道 | 暂不支持中途进度（仅 `tool-call`/`tool-result` chunk） | 通过 handler 第二参数 `ctx.sendProgress(...)` 上报，对应 `chunkType: 'tool-progress'` |

> **结论**：如果你只是想让 AI 在本插件内调用一两个本地方法，请使用方式 A，**不要**画蛇添足往 `manifest.tools` 加声明。`manifest.tools` 是用来"对外公开"的契约，只有当你希望其他插件、设置面板里的 AI 助手、外部 Claude/Cursor 等也能发现并调用这个工具时，才需要它。

---

### 方式 A：插件内部使用 `option.tools`

工具仅对本次 `ai.call` 可见，工具名直接对应插件 `main.ts` 中导出的方法。`docs/apis/host.md` 详细介绍了 host 方法的导出方式（直接导出 / `export const host = {...}` / `export const api = {...}`）。

```ts
// main.ts （插件后端，运行在 host-worker）
export const host = {
  async getSystemInfo(context: PluginContext) {
    const os = require('node:os')
    return { platform: os.platform(), release: os.release() }
  },

  async runWithTools(context: PluginContext, input: { messages: AiMessage[] }) {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'getSystemInfo',           // 直接是 host 的方法名，无前缀
          description: '获取系统信息',
          parameters: { type: 'object', properties: {} }
        }
      }
    ]

    return await context.api.ai.call({
      model: 'openai:gpt-4o-mini',
      messages: input.messages,
      tools,
      maxToolSteps: 20
    })
  }
}
```

**UI 进程触发后端：**

```ts
const result = await window.mulby.host.call('my-plugin', 'runWithTools', {
  messages: [{ role: 'user', content: '我的系统信息是什么？' }]
})
```

> 实现细节：宿主的 `setAiToolExecutor` 在分发工具调用时会优先匹配内置工具（`mulby_*`）、MCP 工具（`mcp__*`）、注册的插件工具（`plugin_tool__*`）；都不命中时，**兜底**直接通过 `hostManager.callHostMethod(pluginName, name, [args])` 调用同名 host 方法。这就是方式 A 不需要任何注册的原因——只要 `option.toolContext.pluginName` 携带（`api.ai.call` 自动注入），AI 选择的工具名就会被路由到该插件的 host RPC。

---

### 方式 B：通过 `manifest.tools` 暴露给所有 AI

适用于把工具公开给生态，例如：你写了一个二维码插件，希望 Mulby 设置里的 AI 助手、其他插件的 AI、Claude Desktop / Cursor 都能调用 `qrcode.generate`。

**Step 1：在 `manifest.json` 声明 schema**

```json
{
  "name": "qrcode",
  "tools": [
    {
      "name": "generate",
      "description": "Generate a QR code from text",
      "inputSchema": {
        "type": "object",
        "properties": {
          "text": { "type": "string" },
          "size": { "type": "number" }
        },
        "required": ["text"]
      }
    }
  ]
}
```

**Step 2：在 host-worker（`main.ts`）注册 handler**

```ts
mulby.tools.register('generate', async (args, ctx) => {
  ctx?.sendProgress({ progress: 1, total: 4, message: '准备文件' })
  // ...
  ctx?.sendProgress({ progress: 4, total: 4, message: '完成' })
  return { dataUrl: '...' }
})
```

> `mulby.tools.register` 必须在 host-worker 内调用（即插件 `main.ts` 运行的 UtilityProcess）。在主进程兜底实现里 `tools.register` 是空操作，这是设计如此（详见 `src/main/plugin/api.ts` 的 740 行附近注释）。
>
> 如需动态移除已注册的全局工具，调用 `mulby.tools.unregister(name)`（同样在 host-worker 内调用）。

**Step 3：自动生效**

注册成功后，工具会以 `plugin_tool__qrcode__generate` 名称：
- 自动加入 Mulby 内置 AI 工具池（其他插件 / 设置面板 AI 也可见）；
- 通过 MCP Server 同步给外部 AI 客户端（如 Claude Desktop、Cursor）。

**接收进度事件：**

流式 `ai.call(option, onChunk)` 在工具执行期间会收到 `chunkType: 'tool-progress'`：

```ts
await ai.call(option, (chunk) => {
  if (chunk.chunkType === 'tool-progress') {
    console.log(chunk.tool_progress)
  }
})
```

`tool_progress` 包含 `{ id?, name, progress, total?, message? }`。同一进度也会在该工具被外部 MCP 客户端调用时转发为 MCP progress notification。

---

### 速记决策

- **只想让 AI 调一下我的本地函数** → 方式 A，`option.tools` 直接传，不碰 manifest。
- **想让别人也能用我这个工具** → 方式 B，写 `manifest.tools` + `register`。
- **不确定？** → 先方式 A，等需要对外暴露时再升级到方式 B。

### 内置工具能力（Capabilities）

`option.capabilities` 接受以下能力名（见 `src/main/ai/tools/capabilities.ts`），命中后会按需注入对应的 Mulby 内置工具。每个能力都对应一个内置工具：

| Capability | 对应工具名 | 说明 | 高风险 |
|--------|----------|------|---|
| `shell.exec` | `mulby_run_command` | 执行外部命令 | ✓ |
| `shell.script` | `mulby_run_script` | 执行已注册脚本 | ✓ |
| `fs.read` | `mulby_read_file` | 读取文件 | |
| `fs.list` | `mulby_list_dir` | 列出目录 | |
| `fs.search` | `mulby_search_text` | 文本搜索 | |
| `patch.apply` | `mulby_apply_patch` | 应用 unified diff | ✓ |
| `http.fetch` | `mulby_http_fetch` | HTTP 请求 | ✓ |
| `web.search` | `mulby_web_search` | 联网搜索 | |
| `web.fetch` | `mulby_web_fetch` | 抓取网页（Markdown） | |
| `git.status` | `mulby_git_status` | git status | ✓ |
| `git.diff` | `mulby_git_diff` | git diff | ✓ |
| `skill.activate` | `mulby_activate_skill` | 加载 Skill 正文 | |

> 能力是否默认允许由宿主 `capabilityPolicy.defaultAppCapabilities` 和用户全局授权共同决定。当前默认包含 `shell.exec`、`shell.script`、`fs.*`、`patch.apply`、`http.fetch`、`git.status`、`git.diff`；`web.search` / `web.fetch` 默认关闭。`toolingPolicy.capabilityAllowList` 可为本次会话额外放行能力，`capabilityDenyList` 和全局 deny 始终优先。

> 插件承载的 AI 还需要插件 manifest 显式声明对应权限。命令型能力（`shell.exec`、`shell.script`、`git.status`、`git.diff`、`patch.apply`）要求 `permissions.commandExecution.ai.enabled: true`；旧版 `permissions.runCommand: true` 只授权插件代码直接调用命令，不授权 AI 生成命令。

> 插件可以通过 [`directoryAccess.request()`](./directory-access.md) 动态申请用户目录。`read` 授权会扩展插件承载 AI 的 `fs.read` / `fs.list` / `fs.search` / `git.status` / `git.diff` 可访问 root；`readwrite` 授权还会扩展 `patch.apply`、`shell.exec`、`shell.script` 的可写 root。目录授权不替代上面的 `commandExecution.ai`。

> `internalTools` 字段已废弃，新代码请使用 `capabilities`。两者的别名兼容映射定义于 `src/main/ai/tools/capabilities.ts`（如 `runcommand` → `shell.exec`、`websearch` → `web.search`）。

### 彻底禁用工具（纯文本翻译/安全限制场景）

当需要确保 AI 仅进行纯文本输出（如：划词翻译功能的背景对话流），并且要求**严格防止 prompt 注入攻击诱导模型执行内部命令**时，必须显式禁用系统内的所有工具注入引擎。简单将 `tools` 置空或设置 `maxToolSteps` 为 0 是**无效的**（默认机制会自动注入并保留插件工具）。

必须传入如下全维度的禁用配方：

```ts
const response = await ai.call({
  messages: [...],
  // 1. 阻止请求任何内部能力（FS读写、Shell执行等）
  capabilities: [],
  // 2. 彻底关闭内部工具与当前插件的外部工具挂载
  toolingPolicy: { enableInternalTools: false },
  // 3. 关闭动态 MCP 插件挂载能力
  mcp: { mode: 'off' },
  // 4. 关闭动态技能触发能力
  skills: { mode: 'off' }
});
```

---

## 模型管理

### allModels(filter?)
[Renderer] [Backend]
返回当前可用模型列表（含设置中定义的模型）。可传入可选过滤条件，按端点类型、能力或 Provider 精确筛选。

```javascript
// 获取全部模型（无过滤）
const models = await ai.allModels();

// 只获取图像生成模型
const imageModels = await ai.allModels({ endpointType: 'image-generation' });

// 只获取 Jina 重排序模型
const rerankModels = await ai.allModels({ endpointType: 'jina-rerank' });

// 只获取有视觉能力的模型（单值或多值均可）
const visionModels = await ai.allModels({ capability: 'vision' });

// 按多个端点类型筛选（数组形式）
const textModels = await ai.allModels({ endpointType: ['openai', 'anthropic', 'gemini'] });

// 按 Provider ID 筛选
const providerModels = await ai.allModels({ providerId: 'my-openai-instance' });
```

**参数**：`filter` (AiModelsFilter, 可选)

```typescript
interface AiModelsFilter {
  /**
   * 按端点类型筛选（单值或多值）。
   * 枚举值：'openai' | 'openai-response' | 'anthropic' | 'gemini' | 'image-generation' | 'jina-rerank'
   */
  endpointType?: AiEndpointType | AiEndpointType[]
  /**
   * 按能力筛选（单值或多值），满足任意一个即包含。
   * 枚举值：'text' | 'vision' | 'embedding' | 'reasoning' |
   * 'function_calling' | 'web_search' | 'rerank'
   */
  capability?: AiModelType | AiModelType[]
  /**
   * 按 Provider 实例 ID 精确筛选。
   */
  providerId?: string
}
```

**返回值**: `Promise<AiModel[]>`

> **提示**：端点类型由用户在 AI 设置 → 模型管理中为每个模型配置，对所有 Provider 类型均可设置。图像生成插件建议使用 `{ endpointType: 'image-generation' }` 筛选，重排序插件使用 `{ endpointType: 'jina-rerank' }`，避免展示不兼容的模型。

### models.fetch(input)
[Renderer]
按 Provider 协议能力拉取模型列表；不支持自动发现时会返回空列表或回退到内置模型，并附带 `message`。

> 仅系统渲染窗口可用，用于设置页 Provider 管理；插件 UI/后端不应调用。

```javascript
const result = await ai.models.fetch({
  providerId: 'openai',
  baseURL: 'https://api.deepseek.com/',
  apiKey: 'sk-xxx'
});
```

**参数**:
- `providerId` (string) - Provider 实例 ID（或 provider 类型）
- `baseURL` (string, optional)
- `apiKey` (string, optional)

**返回值**:
- `{ models: AiModel[]; message?: string }`

> 说明：是否支持 `models.fetch` 取决于 Provider 协议能力。

---

## 连接测试

### testConnection(input?)
[Renderer]
使用 `ping` 消息进行快速连通性测试。

> 仅系统渲染窗口可用，用于设置页/首次引导页验证模型配置；插件 UI/后端不应调用。AI 设置页在“模型管理”的测试弹框中调用该接口，API 密钥管理不承担模型连通性测试。

```javascript
const result = await ai.testConnection({
  providerId: 'gateway',
  providerType: 'openai-response',
  endpointType: 'openai-response',
  model: 'gateway:gpt-5.6-sol',
  baseURL: 'https://gateway.example/v1',
  apiKey: 'sk-xxx'
});
```

**参数**:
- `model` (string, optional) - 待测试模型 ID
- `providerId` (string, optional) - Provider 实例 ID
- `providerType` (string, optional) - 测试时使用的 Provider 协议，可覆盖尚未自动保存的设置草稿
- `endpointType` (`AiEndpointType`, optional) - 测试时使用的模型端点类型；例如 `openai-response` 会路由到 Responses API，`openai` 会路由到 Chat Completions 兼容模式
- `apiKey`、`baseURL`、`anthropicBaseURL`、`apiVersion`、`headers` (optional) - 测试时的 Provider 配置覆盖

**返回值**:
- `{ success: boolean; message?: string }`

### testConnectionStream(input, onChunk)
[Renderer]
流式测试连接（可返回 reasoning 片段）。

> 仅系统渲染窗口可用，用于设置页 Provider 调试；插件 UI/后端不应调用。

```javascript
await ai.testConnectionStream(
  {
    providerId: 'gateway',
    providerType: 'openai-response',
    endpointType: 'openai-response',
    model: 'gateway:gpt-5.6-sol',
    baseURL: 'https://gateway.example/v1',
    apiKey: 'sk-xxx'
  },
  (chunk) => {
    if (chunk.type === 'reasoning') console.log('[thinking]', chunk.text);
    if (chunk.type === 'content') console.log('[content]', chunk.text);
  }
);
```

**返回值**:
- `Promise<{ success: boolean; message?: string; reasoning?: string }>`

> 当前公开 Renderer 契约不提供可靠的取消句柄：`contextBridge` 不保留 Promise 上的自定义 `abort` 属性，且该接口尚未向回调暴露 `requestId`。调用方应等待测试完成；不要依赖 `req.abort()`。

> 说明：`openai-response` 通过 Responses API 的 `/responses` 端点流式测试；OpenAI 兼容协议命中 Chat Completions 路由时使用 `/chat/completions`。设置页的模型测试弹框默认开启流式模式，也允许用户关闭后验证非流式支持。

---

## 设置与配置

### settings.get()
[Renderer]
读取 AI 设置。

> 仅系统渲染窗口可用。AI 设置包含 Provider、API Key、MCP、Skills 等宿主级配置，不向插件开放。

```javascript
const settings = await ai.settings.get();
```

**返回值**: `AiSettings`

### settings.update(next)
[Renderer]
更新 AI 设置（部分更新）。

> 仅系统渲染窗口可用。插件需要发起 AI 调用时应通过 `ai.call` 的参数请求能力，不应修改宿主全局设置。

```javascript
await ai.settings.update({
  providers: [
    { id: 'openai', label: 'DeepSeek', enabled: true, baseURL: 'https://api.deepseek.com/', apiKey: 'sk-xxx' }
  ]
});
```

**返回值**: `AiSettings`

> 设置文件位置：`<userData>/ai/settings.json`

---

## MCP 管理

> 可用端：完整管理接口仅系统渲染进程 `window.mulby.ai.mcp`。
>
> 插件后端 `context.api.ai` 当前不提供 `mcp.*` 管理接口（但 `ai.call` 可使用 `option.mcp` 参与工具选择）。
> 插件 UI 调用绝大多数管理操作（`getServer` / `upsertServer` / `removeServer` / `activateServer` / `deactivateServer` / `restartServer` / `checkServer` / `abort` / `getLogs`）会被 IPC 层拒绝；仅 `listServers`（返回剔除 env/headers/baseUrl/command/args 的脱敏视图）与 `listTools`（只读，按工具策略过滤）对插件窗口开放。

### mcp.listServers()
[Renderer]
获取 MCP 服务器列表。

```javascript
const servers = await ai.mcp.listServers();
```

### mcp.getServer(serverId)
[Renderer]
读取单个 MCP 服务器配置。

```javascript
const server = await ai.mcp.getServer('filesystem');
```

### mcp.upsertServer(server)
[Renderer]
创建或更新 MCP 服务器。

```javascript
await ai.mcp.upsertServer({
  id: 'filesystem',
  name: 'Filesystem',
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/you/workspace'],
  isActive: false
});
```

```javascript
await ai.mcp.upsertServer({
  id: 'weather-http',
  name: 'Weather HTTP',
  type: 'streamableHttp',
  baseUrl: 'http://127.0.0.1:3000/mcp',
  headers: { Authorization: 'Bearer xxx' },
  isActive: false
});
```

### mcp.removeServer(serverId)
[Renderer]
删除服务器配置并断开连接。

```javascript
await ai.mcp.removeServer('filesystem');
```

### mcp.activateServer(serverId)
[Renderer]
启动并连接 MCP 服务器。

```javascript
await ai.mcp.activateServer('filesystem');
```

### mcp.deactivateServer(serverId)
[Renderer]
停止 MCP 服务器连接。

```javascript
await ai.mcp.deactivateServer('filesystem');
```

### mcp.restartServer(serverId)
[Renderer]
重启 MCP 服务器。

```javascript
await ai.mcp.restartServer('filesystem');
```

### mcp.checkServer(serverId)
[Renderer]
执行连通性检查（会尝试连通并拉取工具列表）。

```javascript
const check = await ai.mcp.checkServer('filesystem');
// { ok: boolean, message?: string }
```

### mcp.listTools(serverId)
[Renderer]
获取服务器工具列表（应用工具策略过滤后）。

```javascript
const tools = await ai.mcp.listTools('filesystem');
```

### mcp.abort(callId)
[Renderer]
中止进行中的 MCP 工具调用。

```javascript
await ai.mcp.abort(callId);
```

### mcp.getLogs(serverId)
[Renderer]
读取 MCP 服务器日志。

```javascript
const logs = await ai.mcp.getLogs('filesystem');
```

> `installSource = 'protocol'` 且 `isTrusted !== true` 的服务器属于未信任状态，启动/重启/连通性检查/工具调用会被拦截。

---

## 技能管理 (skills)

> 系统渲染进程：`window.mulby.ai.skills`（完整管理接口）  
> 插件后端：`context.api.ai.skills`（仅 `listEnabled` 与 `previewForCall`）
> 插件 UI：可调用只读发现接口 `list` / `listEnabled` / `get` / `preview` / `resolve`；安装、删除、启停、`refresh` 等写入/刷新操作仍仅限系统渲染进程，IPC 层会拒绝插件调用。

### skills.list()
### skills.refresh()
### skills.listEnabled()
### skills.get(skillId)
[Renderer]

```javascript
const all = await ai.skills.list();
const enabled = await ai.skills.listEnabled();
const one = await ai.skills.get('my-skill-id');
```

### skills.install(input)
### skills.remove(skillId)
### skills.enable(skillId)
### skills.disable(skillId)
[Renderer]

```javascript
await ai.skills.install({
  source: 'npx',
  ref: '@openai/codex-agent-skill-example',
  enabled: true
});
```

### skills.preview(input)
### skills.resolve(option)
[Renderer]
预览/解析本次调用会启用的技能与策略合并结果。

```javascript
const preview = await ai.skills.preview({ prompt: '帮我写一个 React 组件' });
const resolved = await ai.skills.resolve({
  messages: [{ role: 'user', content: '请帮我审查代码' }]
});
```

### skills.listEnabled()
### skills.previewForCall(input)
[Backend]

```javascript
const enabled = await context.api.ai.skills.listEnabled();
const preview = await context.api.ai.skills.previewForCall({
  prompt: '帮我写一个脚本'
});
```

---

## 附件 (多模态 / 文件)

### attachments.upload(input)
[Renderer] [Backend]
上传文件或二进制数据，返回可在消息中引用的 `attachmentId`。

系统渲染窗口可以传入 `filePath`：

```javascript
const image = await ai.attachments.upload({
  filePath: '/path/to/image.png',
  mimeType: 'image/png',
  purpose: 'vision'
});
```

插件 UI/后端需要传入 `buffer`，不要传 `filePath`：

```javascript
// 插件 UI：来自 <input type="file"> / 拖拽文件
const buffer = await file.arrayBuffer();
const image = await window.mulby.ai.attachments.upload({
  buffer,
  mimeType: file.type || 'application/octet-stream',
  purpose: 'vision'
});
```

```javascript
// 插件后端：先通过已授权的 filesystem 能力读取，再上传 buffer
const bytes = context.api.filesystem.readFile('/path/to/authorized-image.png');
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const image = await context.api.ai.attachments.upload({
  buffer,
  mimeType: 'image/png',
  purpose: 'vision'
});
```

**参数**:
- `filePath` (string, optional) - 仅系统渲染窗口可用
- `buffer` (ArrayBuffer, optional) - 插件 UI/后端推荐方式
- `mimeType` (string)
- `purpose` (string, optional)

**返回值**: `AiAttachmentRef`

### attachments.get(attachmentId)
[Renderer] [Backend]
获取附件元信息。

```javascript
const info = await ai.attachments.get(attachmentId);
```

**返回值**: `AiAttachmentRef | null`

### attachments.delete(attachmentId)
[Renderer] [Backend]
删除附件。

```javascript
await ai.attachments.delete(attachmentId);
```

**返回值**: `void`（插件后端返回 `Promise<void>`）

### attachments.uploadToProvider(input)
[Renderer] [Backend]
将已上传的附件进一步上传到指定 Provider 的文件服务，返回 `fileId/uri`。

```javascript
const remote = await ai.attachments.uploadToProvider({
  attachmentId,
  providerId: 'anthropic'
});
```

**参数**:
- `attachmentId` (string)
- `model` (string, optional)
- `providerId` (string, optional)
- `purpose` (string, optional)

**返回值**:
```typescript
{
  providerId: string;
  fileId: string;
  uri?: string;
}
```

> 附件存储目录：`<userData>/ai/attachments`

---

## Token 估算

### tokens.estimate(input)
[Renderer] [Backend]
估算 token 数量（输入使用分词器，输出可基于实际输出文本或上限估算）。

```javascript
const tokens = await ai.tokens.estimate({
  model: 'openai:gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello' }]
});

// 基于实际输出文本估算（推荐用于“完成后计算”）
const tokens2 = await ai.tokens.estimate({
  model: 'openai:gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello' }],
  outputText: 'Hi there!'
});
```

**参数**：
- `model` (string, optional) - 模型 ID，未传时使用全局默认模型
- `messages` (AiMessage[]) - 待估算的对话消息
- `attachments` (AiAttachmentRef[], optional) - 附件引用（影响输入 token）
- `outputText` (string, optional) - 已知的输出文本，用于精确计算 `outputTokens`

**返回值**:
```typescript
{
  inputTokens: number;
  outputTokens: number;
}
```

**说明**:
- `outputText` 传入时，`outputTokens` 会按实际输出文本分词计算。
- `outputText` 未传时，`outputTokens` 会使用 `maxOutputTokens`（若开启）或启发式估算。
- 插件后端类型签名为 `{ model?: string; messages: AiMessage[]; outputText?: string }`，未在类型上声明 `attachments`。如需在后端按附件估算输入 token，可通过类型断言传入；运行时会被透传到底层估算逻辑。

---

## 图片生成 / 编辑

### images.generate(input)
[Renderer] [Backend]
生成图片（返回 base64 数据）。

```javascript
const result = await ai.images.generate({
  model: 'openai:gpt-image-1',
  prompt: 'A cute cat in watercolor style',
  size: '1024x1024',
  count: 1
});
```

**兼容说明**：`generate`、`generateStream`、`edit` 和 `ai.abort(requestId)` 的签名与返回结构保持不变，但内部统一创建持久化图片任务。最终图片完成并写入受控附件目录后才转换为旧接口需要的 Base64；稳定错误额外携带 `code`、`taskId`、`retryable` 和 `billed`。旧接口转换前会先检查制品元数据，单图上限为 16 MiB、一次结果合计上限为 64 MiB；超限不会读取附件内容，并以稳定错误码 `legacy_result_too_large` 拒绝。大图或大批量结果应改用 `images.tasks` 返回的附件引用，避免 Base64 的额外内存开销。

**尺寸控制**：插件仍可传 `size`（如 `'1024x1536'`）和 `aspectRatio`（如 `'2:3'`）。显式 `aspectRatio` 优先；否则精确尺寸 Profile 保留 `size`，宽高比 Profile 将 `size` 约分为比例（例如 `1536x1024` → `3:2`、`1024x1024` → `1:1`）。最终使用精确像素、宽高比、分辨率还是省略尺寸，由已选图片 Profile 的能力决定。

**图片协议**：AI 设置中的 Provider 使用显式 Profile（OpenAI Images、Azure OpenAI Images、Gemini Images、OpenAI 兼容同步、异步任务制、Multipart 或自定义声明式协议），模型可覆盖 Profile/能力。解析优先级为模型覆盖 → Provider 覆盖 → 已验签目录/内置 Profile → 旧配置迁移。旧 `imageSizeFormat`、`imageEditTransport`、`imageUploadsURL` 仍会惰性迁移并双写。

**宿主任务与结果网络边界**：图片生成/编辑请求由宿主图片任务系统管理。供应商控制面请求继续遵守既有的受保护网络策略；供应商返回的远程 HTTP(S) 图片结果则使用专用的系统网络栈下载，不要求结果域名白名单，任何有效且可访问的 HTTP(S) URL 都可作为结果，包括本机、局域网、Fake-IP 和签名 URL。

结果下载固定使用 `GET`、手动处理重定向、`no-store`、省略 credentials 和空 headers。下载时不会转发供应商 `Authorization`、Cookie、Referer/Origin、自定义认证头或环境中的凭据。内联 Base64 结果不经过网络下载器。

结果是否可接受按实际字节识别，而不是信任声明的 MIME；仅接受有效的 PNG、JPEG 或 WebP。响应头 `Content-Length` 和实际流式读取都执行 50 MiB 上限，超限、无效或不支持的图片仍会被拒绝。

**不做计费探测**：Mulby 不会通过真实图片请求猜测协议，也不会在失败后静默尝试另一种生成协议。一次任务只固定一个 Profile、一个适配器和一次提交；请求可能已到达厂商但响应不明确时，任务进入 `unknown`，不会自动重发。设置里的真实连接/图片测试会明确标注“可能计费”。

**提交与恢复的计费边界**：一次宿主任务最多提交一次可能计费的生成请求。`retry_pre_dispatch`、`resume_poll` 和 `resume_download` 复用原 `taskId`；只有 `confirm_regenerate` 在用户确认后创建带 `retryOf` 的新任务，并可能产生新的供应商费用。

**旧接口错误契约**：`images.generate`、`images.generateStream` 和 `images.edit` 失败时都会 reject 一个 `Error`。该错误携带完整的 `AiImageOperationErrorPayload` 信息；`message` 保持标准 `Error.message` 供旧插件继续读取，其余六项为可枚举属性：

| 字段 | 说明 |
|---|---|
| `message` | 可读错误信息，也是 `Error.message` |
| `code` | 稳定的图片任务错误码 |
| `phase` | 失败阶段：`validate`、`prepare`、`submit`、`poll`、`cancel` 或 `download` |
| `taskId` | 对应的宿主图片任务 ID |
| `retryable` | 当前错误是否具备可恢复条件 |
| `billed` | 计费状态：`yes`、`no` 或 `unknown` |
| `recoveryAction` | 当前允许的恢复动作，语义见下文 |

**返回值**: `{ images: string[]; tokens: AiTokenBreakdown }`

### images.profiles.listAvailable()
[Renderer]
列出系统 AI 设置界面可建议的真实图片 Profile ID，包括内置 Profile
和系统已验签目录中当前可用的 Profile。模型级 Profile 输入框仍允许直接填写
其他实际 ID；返回列表只用于补全建议，不会触发目录更新或协议探测。

此方法仅供 Mulby 系统设置界面使用，插件 Renderer 或 Backend 调用会被拒绝。
已验签目录的加载与更新仍由系统拥有，插件不能通过该接口修改目录。

**返回值**: `Promise<string[]>`

### images.generateStream(input, onChunk)
[Renderer] [Backend]
流式生成图片，过程中会推送进度与预览片段。

流建立后，**首个回调是一个合成 chunk `{ __requestId }`**（不含 `type` 字段），与 `ai.call()` 文本流的约定一致。渲染进程中 `req.abort()` 跨 `contextBridge` 不可用，请捕获 `__requestId` 后用 `ai.abort(requestId)` 真中止图像流。

```javascript
let requestId = null;
const req = ai.images.generateStream(
  {
    model: 'openai:gpt-image-1',
    prompt: 'A cute cat in watercolor style',
    size: '1024x1024',
    count: 1
  },
  (chunk) => {
    if (chunk.__requestId) { requestId = chunk.__requestId; return; }  // 首个回调：合成 chunk
    if (chunk.type === 'status') console.log(chunk.stage, chunk.message);
    if (chunk.type === 'preview') console.log('preview base64 length:', chunk.image?.length || 0);
  }
);

// 中止：Renderer 使用 ai.abort(requestId)
if (requestId) await ai.abort(requestId);
```

**返回值**: `Promise<{ images: string[]; tokens: AiTokenBreakdown }>`

**插件后端限制**（隔离 utilityProcess，即 `dist/main.js` 里的 `mulby.ai.images.generateStream`）:
- 参数经 postMessage 序列化，`onChunk` 回调会被剥为 `null`——后端收不到任何进度/预览片段；
- 返回值是回投的普通数据，其上的 `abort` 不可用（`req.abort?.()` 为 no-op）；
- 后端的短调用可继续用 `images.generate` / `images.edit`；需要恢复或中止的长任务应改用 `images.tasks.submit/get/cancel` 轮询闭环。
- Renderer（`window.mulby.ai`）侧不受此限制。

### images.edit(input)
[Renderer] [Backend]
基于图片附件编辑生成。

```javascript
const result = await ai.images.edit({
  model: 'openai:gpt-image-1',
  imageAttachmentId: image.attachmentId,
  prompt: 'Add a red scarf'
});
```

**参数**:

| 字段 | 类型 | 说明 |
|---|---|---|
| `model` | `string` | 图像模型 |
| `imageAttachmentId` | `string` | 主图附件 ID（待编辑 / 主参考图） |
| `prompt` | `string` | 编辑/生成指令 |
| `referenceAttachmentIds` | `string[]?` | 额外参考图附件 ID 列表。按参考图条件生成、多图一致性（如同一角色跨镜、角色+场景），附在主图之后一并传给模型。在**支持多图输入的模型**（如 Google Gemini 图像模型）上效果最佳；不支持多图的模型一般只用主图。 |
| `size` | `string?` | 输出尺寸（如 `'1024x1536'`）。Profile 支持精确尺寸时采用；部分模型仍会跟随主图分辨率，因此是强约束而非绝对保证。 |
| `aspectRatio` | `string?` | 输出宽高比（如 `'2:3'`）。显式传入时优先于由 `size` 推导的比例。 |
| `maskAttachmentId` | `string?` | 局部重绘遮罩附件 ID。约定：PNG 中**完全透明（alpha=0）的区域 = 待重绘区域**（OpenAI images/edits 遮罩约定）。支持遮罩编辑的 Profile 走原生 mask 通道；不支持时在提交前返回能力校验错误。 |
| `requestId` | `string?` | 调用方自带请求 ID。传入后可用 `ai.abort(requestId)` 请求取消对应持久化任务；厂商不支持远端取消时只停止本地等待，任务对象会标明 `remoteMayContinue`。 |

```javascript
// 局部重绘：主图 + 遮罩（涂抹区挖透明洞）
const result = await ai.images.edit({
  model: 'openai:gpt-image-1',
  imageAttachmentId: photo.attachmentId,
  maskAttachmentId: mask.attachmentId,
  prompt: '在透明区域补一只趴在桌上的橘猫，光影与原图一致'
});
```

```javascript
// 多参考图：按参考图条件生成（IP-Adapter 式强一致性）
const result = await ai.images.edit({
  model: 'google:gemini-2.5-flash-image',
  imageAttachmentId: hero.attachmentId,          // 主参考（如角色三视图）
  referenceAttachmentIds: [scene.attachmentId],  // 附加参考（如场景设定图）
  prompt: '夜晚雨中，角色站在霓虹街道上的电影感画面'
});
```

```javascript
// 可中止的 edit：调用方自带 requestId（内容任意、无碰撞要求）
const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const pending = ai.images.edit({
  model: 'google:gemini-2.5-flash-image',
  imageAttachmentId: image.attachmentId,
  prompt: 'Add a red scarf',
  size: '1024x1536',
  requestId
});
// 用户点击停止：
await ai.abort(requestId);   // pending 将以 abort 类错误 reject
```

> 老宿主向后兼容：`size` / `aspectRatio` / `requestId` 均为可选字段，插件无需版本探测即可继续使用同一份旧接口代码。

**返回值**: `{ images: string[]; tokens: AiTokenBreakdown }`

### images.providers.describe(input)
[Renderer] [Backend]

`images.providers.describe({ model?, providerId? })` 返回实际选中的 Profile、适配器、能力矩阵、字段来源和确认警告；这是只读解析，不向图片厂商发请求。

```javascript
const description = await ai.images.providers.describe({
  model: 'openai:gpt-image-1'
});
console.log(description.profile, description.capabilities);
```

**返回值**：`Promise<AiImageProviderDescription>`

```typescript
type AiImageProviderDescription = {
  providerId: string;
  model?: string;
  profile: { id: string; version: string; adapter: string };
  capabilities: AiImageCapabilities;
  capabilitySources: Record<string, string>;
  warnings: AiImageValidationIssue[];
  requiresConfirmation: boolean;
  resolution?: ImageProtocolResolutionDiagnostic;
};
```

### images.validateInput(request)
[Renderer] [Backend]

`images.validateInput(request)` 做语法和能力校验，同样不会提交生成请求。插件不能通过 `providerOptions` 改写端点、HTTP 方法或认证头；只允许 Profile 白名单声明的厂商参数。

**返回值**：`Promise<AiImageValidationResult>`

```typescript
type AiImageValidationResult = {
  valid: boolean;
  normalized?: AiImageRequest;
  errors: AiImageValidationIssue[];
  warnings: AiImageValidationIssue[];
  provider?: AiImageProviderDescription;
};
```

### AiImageRequest

```typescript
type AiImageRequest = {
  operation: 'generate' | 'edit' | 'inpaint' | 'variation';
  model: string;
  prompt: string;
  clientTag?: string;
  inputs?: Array<{
    attachmentId: string;
    role: 'source' | 'reference' | 'mask';
  }>;
  output?: {
    aspectRatio?: string;
    exactSize?: { width: number; height: number };
    resolution?: 'auto' | '512' | '1K' | '2K' | '4K';
    quality?: string;
    format?: 'png' | 'jpeg' | 'webp';
    background?: 'auto' | 'opaque' | 'transparent';
    count?: number;
  };
  providerOptions?: Record<string, unknown>;
};
```

### 图片 Profile 与校验类型

```typescript
type AiImageValidationIssue = {
  code: AiImageTaskErrorCode;
  message: string;
  path?: string;
};

type AiImageCapabilities = {
  operations: Array<'generate' | 'edit' | 'inpaint' | 'variation'>;
  input: {
    maxSourceImages: number;
    maxReferenceImages: number;
    supportsMask: boolean;
    acceptedMimeTypes: string[];
    maxBytesPerImage?: number;
  };
  output: {
    sizeMode: 'exact' | 'ratio' | 'resolution' | 'omit';
    exactSizes?: Array<{ width: number; height: number }>;
    aspectRatios?: string[];
    resolutions?: Array<'auto' | '512' | '1K' | '2K' | '4K'>;
    formats?: Array<'png' | 'jpeg' | 'webp'>;
    qualities?: string[];
    backgrounds?: Array<'auto' | 'opaque' | 'transparent'>;
    maxCount: number;
  };
  lifecycle: {
    mode: 'sync' | 'stream' | 'async';
    nativePreview: boolean;
    cancellable: boolean;
  };
  providerOptions?: Record<string, {
    type: 'string' | 'number' | 'boolean';
    description?: string;
    enum?: Array<string | number | boolean>;
    minimum?: number;
    maximum?: number;
  }>;
};

type ImageProtocolResolutionDiagnostic = {
  providerId: string;
  configuredOrigin: string;
  providerModelId: string;
  canonicalModelId?: string;
  modelsDevProviderId?: string;
  matchedBindingId?: string;
  profileId?: string;
  profileVersion?: string;
  capabilitySources: Record<string, string>;
  candidates: Array<{ bindingId: string; matched: boolean; reason: string }>;
  unresolvedReasons: string[];
};
```

输入图片必须先经 `ai.attachments.upload()` 进入宿主管理的附件目录，再在 `inputs` 中引用 `attachmentId`。生成制品也以附件形式持久化；公共任务对象只返回当前插件有权读取的制品引用。

## images.tasks：可恢复图片任务
[Renderer] [Backend]

```javascript
const request = {
  operation: 'generate',
  model: 'openai:gpt-image-1',
  prompt: '竖版科技漫画封面，蓝紫霓虹，清晰标题留白',
  clientTag: 'tech-manga:chapter-12',
  output: {
    exactSize: { width: 1024, height: 1536 },
    format: 'png',
    count: 1
  }
};

const validation = await ai.images.validateInput(request);
if (!validation.valid) throw new Error(validation.errors[0]?.message);

const task = await ai.images.tasks.submit(request);
console.log(task.taskId, task.state);
```

### images.tasks.submit(request)
[Renderer] [Backend]

创建并唤醒任务，返回 `Promise<AiImageTask>`。任务创建时会固定 Provider、Profile 和适配器版本。

### images.tasks.get(input)
[Renderer] [Backend]

`get({ taskId })` 获取当前插件拥有的任务，返回 `Promise<AiImageTask | null>`；不存在或无权访问时返回 `null`。

### images.tasks.list(input)
[Renderer] [Backend]

`list({ states?, clientTag?, limit?, cursor? })` 分页恢复当前插件拥有的任务列表。

返回 `Promise<{ tasks: AiImageTask[]; nextCursor?: string }>`。

`limit` 默认 `20`、最大 `100`。宿主内部读取 `limit + 1` 行，仅在额外一行证明还有下一页时返回 `nextCursor`；返回的 `tasks` 始终不超过归一化后的 `limit`。

### images.tasks.cancel(input)
[Renderer] [Backend]

`cancel({ taskId })` 请求取消并返回 `Promise<AiImageTask>`。取消可能是 Provider 远端取消，也可能只是本地取消。

### images.tasks.retry(input)
[Renderer] [Backend]

`retry({ taskId, confirmBillableRisk? })` 仅在安全条件下恢复；需要创建新提交且原任务计费状态不明确时，必须显式传入 `confirmBillableRisk: true`。

返回 `Promise<{ task: AiImageTask; createdNewTask: boolean }>`。

### images.tasks.subscribe(input)
[Renderer] [Backend]

`subscribe({ taskId?, clientTag?, sinceRevision? })` 创建 owner 隔离的事件订阅，并返回 `Promise<{ subscriptionId: string; snapshots: AiImageTask[] }>`。Renderer 可配合 `onEvent` 接收后续事件。

### images.tasks.unsubscribe(input)
[Renderer] [Backend]

`unsubscribe({ subscriptionId })` 删除当前插件拥有的订阅。Renderer 销毁时宿主也会自动清理其订阅；插件后端宿主退出时只清理该后端创建的订阅。

### images.tasks.onEvent(listener)
[Renderer] [Backend]

Renderer 和插件后端都可用 `onEvent(listener)` 接收已订阅任务的实时事件，并获得本地监听清理函数。UtilityProcess 后端通过 worker 内的 callback ID 注册表和宿主 `deliverImageTaskEvent` 消息桥接回调；函数本身不会序列化穿过 `postMessage`。事件按既有任务 `revision` 语义交付。调用返回的清理函数只移除对应后端回调；后端退出时宿主清理该后端创建的监听和订阅，不影响 Renderer 或其他 owner 的监听。

Renderer 的恢复用法：

```javascript
const off = ai.images.tasks.onEvent((event) => {
  if (event.taskId !== task.taskId) return;
  if (event.type === 'progress') console.log(event.progress);
  if (event.type === 'artifact_ready') console.log(event.artifact);
  if (event.type === 'terminal') console.log(event.state, event.error);
});

const subscription = await ai.images.tasks.subscribe({
  taskId: task.taskId,
  sinceRevision: task.revision
});

// 页面重新打开或 Mulby 重启后：
const restored = await ai.images.tasks.get({ taskId: task.taskId });

await ai.images.tasks.unsubscribe({
  subscriptionId: subscription.subscriptionId
});
off();
```

> 插件后端运行在隔离 UtilityProcess 时，`onEvent` 由 callback bridge 支持。进程断开期间的恢复仍应使用持久化的 `get/list` 快照与 `sinceRevision` 重新订阅，不能把进程内回调当作持久状态。

### 状态、事件、错误与恢复语义

`AiImageTask.state` 可能为：

```typescript
type AiImageTaskState =
  | 'queued' | 'preparing' | 'submitting' | 'submitted' | 'running'
  | 'cancelling' | 'downloading' | 'completed' | 'failed' | 'cancelled'
  | 'blocked' | 'unknown' | 'reconciling' | 'safe_to_retry';
```

核心任务、制品、错误和事件结构如下：

```typescript
type AiImageArtifact = {
  artifactId: string;
  attachmentId: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  sha256: string;
  createdAt: string;
};

type AiImageTaskErrorCode =
  | 'invalid_request' | 'unsupported_operation' | 'unsupported_parameter'
  | 'auth_failed' | 'permission_denied' | 'rate_limited' | 'quota_exceeded'
  | 'content_policy' | 'input_upload_failed' | 'provider_rejected'
  | 'provider_unavailable' | 'network_policy' | 'submit_ambiguous'
  | 'provider_task_not_found' | 'poll_failed' | 'download_failed'
  | 'protocol_response_mismatch' | 'reconcile_failed'
  | 'legacy_result_too_large' | 'cancelled' | 'timeout' | 'internal_error';

type AiImageTaskError = {
  code: AiImageTaskErrorCode;
  phase: 'validate' | 'prepare' | 'submit' | 'poll' | 'cancel' | 'download';
  message: string;
  retryable: boolean;
  billed: 'yes' | 'no' | 'unknown';
  providerCode?: string;
  httpStatus?: number;
  details?: Record<string, unknown>;
};

type AiImageRecoveryAction =
  | 'retry_pre_dispatch'
  | 'resume_poll'
  | 'resume_download'
  | 'confirm_regenerate'
  | 'none';

type AiImageTask = {
  taskId: string;
  clientTag?: string;
  request: {
    operation: 'generate' | 'edit' | 'inpaint' | 'variation';
    model: string;
    clientTag?: string;
    inputCount: number;
    output?: AiImageRequest['output'];
  };
  state: AiImageTaskState;
  revision: number;
  progress?: number;
  artifacts: AiImageArtifact[];
  error?: AiImageTaskError;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    generatedImages?: number;
    source: 'provider' | 'estimated';
  };
  billed: 'yes' | 'no' | 'unknown';
  downloadAttempt: number;
  recoveryAction: AiImageRecoveryAction;
  retryOf?: string;
  cancellation?: {
    scope: 'provider' | 'local';
    remoteMayContinue: boolean;
    requestedAt: string;
  };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

type AiImageTaskEvent = {
  eventId: string;
  taskId: string;
  revision: number;
  type: 'state_changed' | 'progress' | 'preview' | 'artifact_ready' |
    'warning' | 'output_refreshed' | 'terminal';
  state: AiImageTaskState;
  progress?: number;
  preview?: { image: string; index?: number; mimeType?: string };
  artifact?: AiImageArtifact;
  error?: AiImageTaskError;
  timestamp: number;
};
```

事件包含 `state_changed`、`progress`、`preview`、`artifact_ready`、`output_refreshed`、`warning`、`terminal`，每个任务的 `revision` 单调递增。状态变化和终态不会被合并；高频进度可能合并。只有厂商原生提供预览时才发 `preview`，Mulby 不会用额外生成请求模拟预览。

任务、恢复句柄、事件和制品元数据保存在 SQLite；prompt、厂商任务句柄和签名 URL 等恢复敏感字段由 Electron `safeStorage` 加密。重启后：

- 尚未开始提交的任务可以继续；
- 已保存厂商任务 ID 的异步任务继续轮询同一个远端任务；
- 已提交但是否到达厂商不明确的任务进入 `unknown`，绝不自动重发；
- 下载失败只重试下载，不重新生成；
- 提交已开始但尚无远端终态证明时，本地取消会标记 `billed=unknown`，并保留可协调的提交状态，使迟到的同步结果或异步句柄仍可落库；
- 取消和完成竞态按远端最终状态收敛。

一个宿主任务最多发起一次可能计费的供应商提交。`AiImageTask.recoveryAction` 和操作错误中的同名字段取值如下：

| `recoveryAction` | 恢复语义 |
|---|---|
| `retry_pre_dispatch` | 继续原任务；该任务从未开始向供应商提交 |
| `resume_poll` | 使用原任务保存的供应商任务 ID/句柄继续查询 |
| `resume_download` | 在原任务上下载已保留或已刷新的输出 |
| `confirm_regenerate` | 必须由用户明确确认，之后创建一次新的请求和新任务 |
| `none` | 当前没有可用的恢复动作 |

`retry()` 对前三种安全恢复动作复用原 `taskId`，不会创建新的生成提交。`confirm_regenerate` 必须传入 `confirmBillableRisk: true`；确认后才创建带 `retryOf` 的新任务，并可能产生新的供应商费用。提交结果不明确时不会自动重新生成。

远程结果下载最多自动执行三轮 URL 下载；下载 401/403/404 且原异步任务句柄仍存在时，宿主只会尝试一次过期 URL 刷新，并记录一个 `output_refreshed` 时间线事件，随后仍在原任务上继续。取消任务会中止正在进行的本地下载。任务中心和历史记录会展示任务、事件、恢复动作与制品状态，但具体供应商是否支持轮询、刷新或远端取消仍取决于其公开能力，宿主不承诺供应商特有行为。

### images.systemTasks（Mulby 系统界面专用）

`images.systemTasks` 为“AI 图片任务”系统页提供跨插件摘要、详情、事件、缩略图和 ZIP 导出。主进程只接受已登记的 Mulby app renderer；插件窗口、插件 utility process 和未知窗口调用都会被拒绝。插件应继续使用 owner-scoped 的 `images.tasks.*`，不能依赖 `systemTasks`。

系统导出由主进程打开原生保存对话框，调用方不能传目标路径。Prompt、Base64、来源 URL 与图片二进制默认关闭，只有用户显式选择并确认后才写入 ZIP。

```typescript
type AiImageSystemTaskSummary = AiImageTask & {
  ownerPluginId: string;
  providerId: string;
  profileId: string;
  profileVersion: string;
  bindingId?: string;
  adapter: { id: string; version: string };
  resolution?: ImageProtocolResolutionDiagnostic;
};

type AiImageSystemTaskDetail = AiImageSystemTaskSummary & {
  fullRequest?: AiImageRequest;
  fullRequestUnavailableReason?: 'decrypt_failed';
  cancelExpectation: {
    scope: 'provider' | 'local';
    remoteMayContinue: boolean;
  };
  lifecycle?: AiImageCapabilities['lifecycle'];
  lifecycleUnavailableReason?:
    | 'decrypt_failed'
    | 'historical_profile_not_retained';
  sourceExport: {
    available: boolean;
    urlCount: number;
    unavailableReason?:
      | 'historical_source_not_retained'
      | 'provider_returned_no_urls'
      | 'task_not_completed'
      | 'decrypt_failed';
  };
};

type AiImageSystemTaskEventPage = {
  events: Array<{
    eventId: string;
    taskId: string;
    revision: number;
    type: AiImageTaskEvent['type'];
    state: AiImageTaskState;
    progress?: number;
    preview?: { available: boolean; index?: number; mimeType?: string };
    artifact?: AiImageArtifact;
    error?: AiImageTaskError;
    usage?: AiImageTask['usage'];
    timestamp: number;
  }>;
  nextCursor?: string;
};

type AiImageTaskExportSelection = {
  scope:
    | { kind: 'current'; taskId: string }
    | { kind: 'selected'; taskIds: string[] }
    | { kind: 'filtered'; group?: 'all' | 'active' | 'completed' | 'failed_or_blocked' | 'billing_risk'; query?: string }
    | { kind: 'all' };
  contents: {
    prompt: boolean;
    base64: boolean;
    sourceUrls: boolean;
    imageBinary: boolean;
  };
};
```

### images.systemTasks.list(input)
[Renderer]

按 `group`（`all`、`active`、`completed`、`failed_or_blocked` 或 `billing_risk`）、`query`、`limit` 和不透明 `cursor` 分页查询跨 owner 的任务摘要。返回 `tasks` 与可选 `nextCursor`；列表读取不解密完整请求。

**返回值**：`Promise<{ tasks: AiImageSystemTaskSummary[]; nextCursor?: string }>`

### images.systemTasks.getDetail(input)
[Renderer]

`getDetail({ taskId })` 返回一个跨 owner 任务的详情或 `null`。详情按需解密完整请求和 Profile 生命周期快照；若历史记录无法解密或没有保留快照，会保留安全摘要并返回对应的不可用原因。

**返回值**：`Promise<AiImageSystemTaskDetail | null>`

### images.systemTasks.listEvents(input)
[Renderer]

`listEvents({ taskId, cursor?, limit? })` 按 revision 分页返回已脱敏的任务事件和可选 `nextCursor`。历史预览不包含原始图片内容。

**返回值**：`Promise<AiImageSystemTaskEventPage>`

### images.systemTasks.getArtifactPreview(input)
[Renderer]

`getArtifactPreview({ taskId, artifactId })` 为系统页返回受尺寸限制的 WebP 缩略图；制品不可用时调用失败。

**返回值**：`Promise<{ artifactId: string; mimeType: 'image/webp'; width?: number; height?: number; dataUrl: string }>`

### images.systemTasks.previewExport(selection)
[Renderer]

预览导出范围与内容选择，返回任务、制品、来源数量、不可用历史来源的数量和所选敏感内容种类。范围可为 `current`、`selected`、`filtered` 或 `all`；`filtered` 作用于完整筛选结果，不限于当前页。

**返回值**：`Promise<{ taskCount: number; artifactCount: number; sourceUrlCount: number; unavailableSourceTaskCount: number; missingTaskIds: string[]; sensitiveKinds: Array<'prompt' | 'base64' | 'sourceUrls' | 'imageBinary'> }>`

### images.systemTasks.exportArchive(request)
[Renderer]

请求导出 ZIP。`request` 包含范围、四个内容开关（Prompt、Base64、来源 URL、图片二进制）及 `confirmSensitive`；任一敏感开关开启时必须显式确认。主进程负责显示原生保存对话框并返回取消状态或仅含文件名、计数和写入字节数的结果，调用方不接收也不能指定保存路径。

**返回值**：`Promise<{ cancelled: true } | { cancelled: false; fileName: string; taskCount: number; artifactCount: number; bytesWritten: number }>`

### tech-manga 旧接口兼容示例

本次重构不要求 manga-core 改用任务 API；现有调用可以原样工作：

```javascript
const result = references.length === 0
  ? await ai.images.generate({
      model,
      prompt,
      size: '1024x1536',
      aspectRatio: '2:3',
      count: 1
    })
  : await ai.images.edit({
      model,
      imageAttachmentId: references[0].attachmentId,
      referenceAttachmentIds: references.slice(1).map((item) => item.attachmentId),
      prompt,
      size: '1024x1536',
      aspectRatio: '2:3',
      requestId
    });

const imageBase64 = result.images[0];
```

---

## 数据结构

### AiMessage
```typescript
type AiMessage = {
  role: 'system' | 'user' | 'assistant';
  content?: string | AiMessageContent[];
  reasoning_content?: string;
  /** 仅 Renderer 文本流首个合成 chunk；最终消息不包含该字段。 */
  __requestId?: string;
  /**
   * 流式事件类型（仅 onChunk 过程中出现），用于统一
   * meta / text / reasoning / tool-call / tool-progress / tool-result / error / usage / end 协议。
   * usage：多步工具循环中每轮 LLM 往返结束时推送的真实用量快照（usage=跨轮累计，usage_round=本轮）。
   */
  chunkType?:
    | 'meta'
    | 'text'
    | 'reasoning'
    | 'tool-call'
    | 'tool-progress'
    | 'tool-result'
    | 'error'
    | 'usage'
    | 'end';
  capability_debug?: {
    requested: string[];
    allowed: string[];
    denied: string[];
    reasons: string[];
    selectedSkills?: { id: string; source: string; trustLevel: string }[];
  };
  policy_debug?: {
    skills: {
      requested?: AiSkillSelection;
      selectedSkillIds: string[];
      selectedSkillNames: string[];
      reasons: string[];
    };
    mcp: { requested?: AiMcpSelection; resolved?: AiMcpSelection };
    toolContext: { requested?: AiToolContext; resolved?: AiToolContext };
    capabilities: { requested: string[]; resolved: string[] };
    internalTools: { requested: string[]; resolved: string[] };
  };
  tool_call?: { id: string; name: string; args?: unknown };
  tool_progress?: {
    id?: string;
    name: string;
    progress: number;
    total?: number;
    message?: string;
  };
  tool_result?: { id: string; name: string; result?: unknown };
  error?: {
    message: string;
    code?: string;
    category?: string;
    retryable?: boolean;
    statusCode?: number;
  };
  usage?: AiTokenBreakdown;
  /** usage chunk 专用：本轮（单次 LLM 往返）的真实用量；provider 可能只返回单侧 */
  usage_round?: { inputTokens?: number; outputTokens?: number };
  /** usage chunk 专用：工具循环轮次（1-based） */
  tool_round?: number;
};
```

### AiMessageContent
```typescript
type AiMessageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; attachmentId: string; mimeType?: string }
  | { type: 'file'; attachmentId: string; mimeType?: string; filename?: string };
```

### AiTool
```typescript
type AiTool = {
  type: 'function';
  function?: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
    required?: string[]; // 旧字段，建议改用 parameters.required
  };
};
```

### AiOption
```typescript
type AiOption = {
  model?: string;
  messages: AiMessage[];
  tools?: AiTool[];
  capabilities?: string[];
  internalTools?: string[]; // 已废弃，建议改用 capabilities
  toolingPolicy?: {
    enableInternalTools?: boolean;
    capabilityAllowList?: string[];
    capabilityDenyList?: string[];
  };
  mcp?: AiMcpSelection;
  skills?: AiSkillSelection;
  params?: AiModelParameters;
  toolContext?: AiToolContext;
  maxToolSteps?: number; // 工具调用最大步数，默认 20，最大 300
};
```

### AiModelParameters
```typescript
type AiModelParameters = {
  contextWindow?: number;
  temperatureEnabled?: boolean;
  topPEnabled?: boolean;
  maxOutputTokensEnabled?: boolean;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stopSequences?: string[];
  seed?: number;
  // 推理强度（reasoning 模型）。映射到 OpenAI 兼容 `reasoning_effort`
  // 与 AI SDK `providerOptions.openai.reasoningEffort`。低 = 更快/更省。
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'max';
  // 显式开关模型「思考」（在 provider 支持时）。映射：
  //   OpenAI 兼容 body `thinking: { type: 'enabled' | 'disabled' }`（如 deepseek-v4）
  //   Anthropic body `thinking`（disabled / enabled+budget）
  //   AI SDK providerOptions（anthropic.thinking / google.thinkingConfig）
  // 省略则用 provider/模型默认值。
  thinking?: 'enabled' | 'disabled';
  // 结构化输出格式（见「结构化输出」一节）。'json_object' 约束为合法 JSON；
  // 'json_schema' 进一步按 jsonSchema 约束结构。省略则为普通文本输出。
  responseFormat?: 'json_object' | 'json_schema';
  // JSON Schema（建议 draft 2020-12 子集），responseFormat: 'json_schema' 时生效。
  jsonSchema?: Record<string, unknown>;
  // 结构化输出的 schema 名称（OpenAI 需要），省略默认 'output'。
  jsonSchemaName?: string;
  // 严格模式（OpenAI strict / 增强 schema 遵守），默认 true。
  strict?: boolean;
};
```

**推理控制（reasoningEffort / thinking）**：
- 对延迟敏感的场景（如行内补全），可对 reasoning 模型传 `params.thinking = 'disabled'`（支持开关的模型，如 deepseek-v4）或较低的 `params.reasoningEffort`，让模型少思考、更快返回。
- 字段按 provider 自动落位：OpenAI 兼容协议写入 `/chat/completions` 请求体（`reasoning_effort`、`thinking`）；Anthropic 写入 `thinking`；走 AI SDK 的原生 provider 通过 `providerOptions`（openai / anthropic / google）下发。
- 不支持的 provider 会忽略这些字段；个别严格 provider 可能因未知字段报错，建议仅在确认模型支持时设置。

> 模型是否为 reasoning，可由 `ai.allModels()` 返回的 `capabilities`（含 `{ type: 'reasoning' }`）判断——该能力现以 [models.dev](https://models.dev/) 数据为准。

### 图片 Provider / Model 配置

```typescript
type AiImageCapabilityOverrides = {
  operations?: Array<'generate' | 'edit' | 'inpaint' | 'variation'>;
  input?: Partial<AiImageCapabilities['input']>;
  output?: Partial<AiImageCapabilities['output']>;
  lifecycle?: Partial<AiImageCapabilities['lifecycle']>;
  providerOptions?: AiImageCapabilities['providerOptions'];
};

type AiImageProviderConfig = {
  profileId: string;
  profileVersion?: string;
  allowInsecureLocalhost?: boolean;
  endpointOverrides?: {
    generate?: string;
    edit?: string;
    upload?: string;
    poll?: string;
    cancel?: string;
  };
  capabilityOverrides?: AiImageCapabilityOverrides;
};

type AiImageModelConfig = {
  profileId?: string;
  capabilityOverrides?: AiImageCapabilityOverrides;
};
```

### AiProviderConfig
```typescript
type AiProviderConfig = {
  id: string; // Provider 实例 ID
  type?: string; // Provider 协议类型，不填时向后兼容为 id
  label?: string;
  enabled: boolean;
  apiKey?: string; // 支持单 key 或逗号分隔多 key（支持转义逗号）
  baseURL?: string;
  apiVersion?: string;
  anthropicBaseURL?: string;
  headers?: Record<string, string>;
  defaultModel?: string;
  defaultParams?: AiModelParameters;
  imageSizeFormat?: 'pixels' | 'ratio' | 'omit';
  imageEditTransport?: 'multipart' | 'uploads';
  imageUploadsURL?: string;
  images?: AiImageProviderConfig;
};
```

### AiModel
```typescript
type AiEndpointType =
  | 'openai'
  | 'openai-response'
  | 'anthropic'
  | 'gemini'
  | 'image-generation'
  | 'jina-rerank';

type AiModelType =
  | 'text'
  | 'vision'
  | 'embedding'
  | 'reasoning'
  | 'function_calling'
  | 'web_search'
  | 'rerank';

type AiModel = {
  id: string; // 形如 "openai:gpt-4o-mini"
  label: string;
  description: string;
  icon?: string;
  providerRef?: string;
  providerLabel?: string;
  endpointType?: AiEndpointType;
  imageSizeFormat?: 'pixels' | 'ratio' | 'omit';
  imageEditTransport?: 'multipart' | 'uploads';
  images?: AiImageModelConfig;
  catalogIdentity?: {
    source: 'models.dev';
    providerId?: string;
    providerModelId: string;
    canonicalModelId?: string;
    family?: string;
    match: 'exact-provider-model' | 'unique-alias' | 'ambiguous';
  };
  modalities?: {
    input: Array<'text' | 'image' | 'audio' | 'video' | 'pdf'>;
    output: Array<'text' | 'image' | 'audio' | 'video' | 'pdf'>;
  };
  supportedEndpointTypes?: AiEndpointType[];
  params?: AiModelParameters;
  capabilities?: Array<{
    type: AiModelType;
    isUserSelected?: boolean;
  }>;
  /**
   * 模型的「上下文窗口（token 数）」。与 `params.contextWindow`（历史消息条数窗口）不是一回事。
   * 优先级：用户显式覆盖 > models.dev 快照/缓存；两者都未知则缺省，消费方保守处理（不按模型 id 家族猜）。
   */
  contextTokens?: number;
};
```

### AiSettings
```typescript
type AiSettings = {
  providers: AiProviderConfig[];
  models?: AiModel[];
  defaultModel?: string;
  defaultParams?: AiModelParameters;
  mcp?: AiMcpSettings;
  skills?: {
    enabled: boolean;
    activeSkillIds: string[];
    records: AiSkillRecord[];
  };
};
```

### AiMcpSelection / AiToolContext
```typescript
type AiMcpSelection = {
  mode?: 'off' | 'manual' | 'auto';
  serverIds?: string[];
  allowedToolIds?: string[];
};

type AiToolContext = {
  pluginName?: string;
  internalTag?: string;
  requestId?: string;
  mcpScope?: {
    allowedServerIds?: string[];
    allowedToolIds?: string[];
  };
};
```

### AiMcpServer / AiMcpSettings / AiMcpTool
```typescript
type AiMcpServer = {
  id: string;
  name: string;
  type: 'stdio' | 'sse' | 'streamableHttp';
  isActive: boolean;
  description?: string;
  baseUrl?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  timeoutSec?: number;
  longRunning?: boolean;
  disabledTools?: string[];
  disabledAutoApproveTools?: string[];
  installSource?: 'manual' | 'protocol' | 'builtin';
  isTrusted?: boolean;
  trustedAt?: number;
  installedAt?: number;
};

type AiMcpSettings = {
  servers: AiMcpServer[];
  defaults?: {
    timeoutMs?: number;
    longRunningMaxMs?: number;
    approvalMode?: 'always' | 'auto-approved-only' | 'never';
  };
};

type AiMcpTool = {
  id: string;
  name: string;
  description?: string;
  serverId: string;
  serverName: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
};

type AiMcpServerLogEntry = {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  source?: string;
  data?: unknown;
};
```

### AiSkillSelection / AiSkillRecord / AiSkillPreview
```typescript
type AiSkillSelection = {
  mode?: 'off' | 'manual' | 'progressive';
  skillIds?: string[];
  variables?: Record<string, string>;
};

type AiSkillSource =
  | 'manual'
  | 'local-dir'
  | 'zip'
  | 'npx'
  | 'json'
  | 'builtin'
  | 'system';

type AiSkillTrustLevel = 'untrusted' | 'reviewed' | 'trusted';

type AiSkillMcpPolicy = {
  serverIds?: string[];
  allowedToolIds?: string[];
  blockedToolIds?: string[];
};

type AiSkillMulbyExtensions = {
  mode?: 'manual' | 'auto' | 'both';
  triggerPhrases?: string[];
  capabilities?: string[];
  /** @deprecated Prefer capabilities. */
  internalTools?: string[];
  mcpPolicy?: AiSkillMcpPolicy;
};

type AiSkillDescriptor = {
  id: string;
  name: string;
  /** SKILL.md frontmatter `description`，必填。 */
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  /**
   * SKILL.md frontmatter `allowed-tools`（空格分隔字符串）的标准化结果。
   */
  allowedTools?: string[];
  /** SKILL.md 正文（懒加载）。 */
  promptTemplate?: string;
  /** 解析自 `metadata.mulby.*` 的 Mulby 私有扩展。 */
  mulbyExtensions?: AiSkillMulbyExtensions;

  /** @deprecated 使用 mulbyExtensions.mode */
  mode?: 'manual' | 'auto' | 'both';
  /** @deprecated 使用 mulbyExtensions.triggerPhrases */
  triggerPhrases?: string[];
  /** @deprecated 使用 mulbyExtensions.capabilities */
  capabilities?: string[];
  /** @deprecated 使用 mulbyExtensions.internalTools */
  internalTools?: string[];
  /** @deprecated 使用 mulbyExtensions.mcpPolicy */
  mcpPolicy?: AiSkillMcpPolicy;
};

type AiSkillRecord = {
  id: string;
  source: AiSkillSource;
  origin?: 'system' | 'app';
  readonly?: boolean;
  sourceRef?: string;
  installPath?: string;
  skillMdPath?: string;
  contentHash: string;
  enabled: boolean;
  trustLevel: AiSkillTrustLevel;
  installedAt: number;
  updatedAt: number;
  descriptor: AiSkillDescriptor;
};

type AiSkillPreview = {
  selected: AiSkillRecord[];
  systemPrompt: string;
  mcpImpact: {
    serverIds?: string[];
    allowedToolIds?: string[];
    blockedToolIds?: string[];
  };
  reasons: string[];
};

type AiSkillResolveResult = {
  selectedSkillIds: string[];
  selectedSkillNames: string[];
  selectedSkills?: Array<{ id: string; source: string; trustLevel: string }>;
  availableSkillsPrompt?: string;
  systemPrompts: string[];
  mergedMcp?: AiMcpSelection;
  toolContextPatch?: AiToolContext['mcpScope'];
  capabilities?: string[];
  internalTools?: string[]; // 已废弃
  reasons?: string[];
};
```

### AiTokenBreakdown
```typescript
type AiTokenBreakdown = {
  inputTokens: number;
  outputTokens: number;
};

type AiPromiseLike<T> = Promise<T> & {
  abort: () => void;
};
```

### AiImageGenerateProgressChunk
```typescript
type AiImageGenerateProgressChunk = {
  // 业务 chunk 恒有 type；合成 chunk（仅含 __requestId）不携带 type
  type?: 'status' | 'preview';
  stage?: 'start' | 'partial' | 'finalizing' | 'completed' | 'fallback';
  message?: string;
  image?: string;
  index?: number;
  received?: number;
  total?: number;
  // 流建立后首个回调携带；用于 ai.abort(requestId)
  __requestId?: string;
};
```

### AiAttachmentRef
```typescript
type AiAttachmentRef = {
  attachmentId: string;
  mimeType: string;
  size: number;
  filename?: string;
  expiresAt?: string;
  purpose?: string;
};
```

---

## 网络搜索工具设置 (tooling.webSearch)

> 可用端：
> - 系统渲染进程：`window.mulby.ai.tooling.webSearch`（完整读写）
> - 插件 UI：仅 `getSettings` / `setActiveProvider`
>
> `get` / `update` 会读写宿主 WebSearch Provider、API Key、自定义搜索源等全局配置（含密钥），仅设置页可用。`getSettings`（读取激活 provider 与可用列表）与 `setActiveProvider`（切换激活 provider）不含密钥，已对插件 UI 开放。插件调用联网搜索本身应在 `ai.call` 中请求 `web.search` / `web.fetch` 能力。

### tooling.webSearch.get()
[Renderer]
获取当前网络搜索原始配置。返回值与 `AiToolWebSearchSettings` 结构一致：

```typescript
type AiToolWebSearchSettings = {
  /** 当前激活的 Provider ID（如 local-bing / local-google / tavily / jina / custom-xxx） */
  activeProvider: string;
  /** 搜索最大结果数 */
  maxResults: number;
  /** web_fetch 返回内容最大字符数 */
  maxContentLength: number;
  /** 搜索/抓取超时（毫秒） */
  timeoutMs: number;
  /** 内置 API Provider 的独立 Key 存储 */
  providerKeys: { tavily?: string; jina?: string };
  /** Tavily 自定义 Host（默认 https://api.tavily.com） */
  tavilyApiHost?: string;
  /** 本地搜索引擎列表（内置 + 用户自定义） */
  localEngines: LocalSearchEngineConfig[];
  /** 用户自定义 API Provider 列表 */
  customApis: CustomSearchApiConfig[];
  /** 本地搜索是否自动获取各结果链接正文（默认 true） */
  fetchContent?: boolean;
  /** 每条结果正文最大字符数（默认 2000） */
  maxContentPerResult?: number;
  /** 搜索结果域名黑名单 */
  resultDenyHosts?: string[];

  /** @deprecated 使用 activeProvider 替代 */
  provider?: string;
  /** @deprecated 使用 providerKeys.jina 替代 */
  jinaApiKey?: string;
  /** @deprecated 使用 providerKeys.tavily 替代 */
  tavilyApiKey?: string;
};
```

```javascript
const config = await ai.tooling.webSearch.get();
```

**返回值**: `Promise<AiToolWebSearchSettings>`（接口签名为 `Record<string, unknown>`，运行时形状如上）

### tooling.webSearch.update(partial)
[Renderer]
更新网络搜索配置（部分更新）。`providerKeys` 会做浅合并。

```javascript
await ai.tooling.webSearch.update({
  activeProvider: 'local-bing',
  maxResults: 10,
  providerKeys: { tavily: 'tvly-xxx' }
});
```

**参数**:
- `partial` (Partial<AiToolWebSearchSettings>) - 需要更新的字段

**返回值**: `Promise<AiToolWebSearchSettings>` - 更新后的完整配置

### tooling.webSearch.getSettings()
[Renderer]
获取结构化的网络搜索配置，包含当前激活的 provider 和所有可用 provider 列表。

```javascript
const { activeProvider, providers } = await ai.tooling.webSearch.getSettings();
// activeProvider: 'local-ddg'
// providers: [
//   { id: 'local-ddg', name: 'DuckDuckGo', type: 'local' },
//   { id: 'local-bing', name: 'Bing', type: 'local' },
//   { id: 'local-google', name: 'Google', type: 'local' },
//   { id: 'tavily', name: 'Tavily', type: 'api' },
//   { id: 'jina', name: 'Jina', type: 'api' }
// ]
```

**返回值**:
```typescript
{
  activeProvider: string;
  providers: Array<{
    id: string;
    name: string;
    type: 'local' | 'api' | 'custom';
  }>;
}
```

### tooling.webSearch.setActiveProvider(providerId)
[Renderer]
切换当前激活的搜索 provider。会校验 `providerId` 合法性，非法值不会写入。

```javascript
const result = await ai.tooling.webSearch.setActiveProvider('local-bing');
// { success: true, activeProvider: 'local-bing' }
```

**参数**:
- `providerId` (string) - 目标 provider ID（如 `local-ddg`、`tavily`、`custom-xxx`）

**返回值**:
```typescript
{
  success: boolean;
  activeProvider: string;  // 操作后的实际 activeProvider
}
```

> **注意**：`web.search` / `web.fetch` 能力受宿主默认的安全策略限制（默认拦截）。要在插件侧主动开启此能力，不仅要在调用时声明需求，还必须通过 `toolingPolicy.capabilityAllowList` 进行**会话级越权放行**，否则会被拦截（Blocked by default policy）。
>
> 完整传参示例：
> ```javascript
> await ai.call({
>   model: 'openai:gpt-4o',
>   messages: [{ role: 'user', content: '今天的天气？' }],
>   capabilities: ['web.search', 'web.fetch'], // 1. 声明本对话需要这些能力
>   toolingPolicy: {
>     capabilityAllowList: ['web.search', 'web.fetch'] // 2. 绕过宿主默认策略，强行对本会话放行
>   }
> });
> ```

---

## 插件工具管理 (tooling.pluginTools)

> 可用端：
> - 系统渲染进程：`window.mulby.ai.tooling.pluginTools`（读写）
> - 插件 UI：仅 `getDisabled`（只读）
>
> `getDisabled`（读取禁用列表）已对插件 UI 开放；`setDisabled`（全量写入禁用列表）读写全局配置，仅设置页可用，IPC 层会拒绝插件调用。

### tooling.pluginTools.getDisabled()
[Renderer]
获取当前被禁用的插件工具列表。

```javascript
const disabled = await ai.tooling.pluginTools.getDisabled();
// ['my-plugin:toolA', 'my-plugin:toolB']
```

**返回值**: `Promise<string[]>` - 禁用的插件工具 key 列表，格式为 `"pluginId:toolName"`

### tooling.pluginTools.setDisabled(disabledList)
[Renderer]
设置被禁用的插件工具列表（全量替换）。

```javascript
const saved = await ai.tooling.pluginTools.setDisabled([
  'my-plugin:toolA',
  'another-plugin:someAction'
]);
```

**参数**:
- `disabledList` (string[]) - 要禁用的插件工具 key 列表，格式为 `"pluginId:toolName"`

**返回值**: `Promise<string[]>` - 持久化后的禁用列表（归一化后）

---

## 完整示例（多模态 + 流式）

```javascript
module.exports = {
  async run(context) {
    const { ai, filesystem, notification } = context.api;

    // 后端插件不要向 AI 附件上传传 filePath。先在授权范围内读取文件，再传 buffer。
    const bytes = filesystem.readFile('/path/to/authorized-image.png');
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const attachment = await ai.attachments.upload({
      buffer,
      mimeType: 'image/png',
      purpose: 'vision'
    });

    const req = ai.call(
      {
        model: 'openai:gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this image' },
              { type: 'image', attachmentId: attachment.attachmentId, mimeType: 'image/png' }
            ]
          }
        ]
      },
      (chunk) => {
        // 流式输出
        process.stdout.write(chunk.content || '');
      }
    );

    const final = await req;
    await filesystem.writeFile('/tmp/ai-result.txt', final.content || '');
    await notification.show('AI 完成');
  }
};
```

---

## MCP Server 管理（`ai.mcpServer`）

Mulby 可作为 MCP Server 运行，将插件注册的 AI 工具暴露给 Claude Desktop、Cursor 等外部 AI 工具。

> **注意**：MCP Server 管理 API 是**宿主级**能力，仅在设置页面等系统上下文中使用，**不向插件开放**。

### `ai.mcpServer.getState()`

获取 MCP Server 运行状态。

**返回值**：

```typescript
{
  status: 'stopped' | 'starting' | 'running' | 'error'
  port: number
  address?: string      // 运行时的完整 URL
  toolCount: number     // 已注册工具数
  error?: string        // 错误信息（status 为 error 时）
  startedAt?: number    // 启动时间戳
}
```

### `ai.mcpServer.start()`

启动 MCP Server（需先在设置中启用）。

### `ai.mcpServer.stop()`

停止 MCP Server。

### `ai.mcpServer.restart()`

重启 MCP Server（配置变更后使用）。

### `ai.mcpServer.regenerateToken()`

重新生成认证 Token。

**返回值**：`{ token: string }`

> ⚠️ 重新生成 Token 后，所有已配置的客户端需要更新 Token 才能重新连接。

### `ai.mcpServer.getTools()`

获取当前已注册到 MCP Server 的工具列表。

**返回值**：

```typescript
Array<{
  mcpToolName: string   // MCP 协议中的工具名（如 mulby__qrcode__generate）
  pluginId: string      // 原始插件 ID
  toolName: string      // 插件内的工具名
  pluginName: string    // 插件显示名
}>
```

### `ai.mcpServer.getClientConfig()`

获取客户端配置示例（供用户复制粘贴到客户端配置文件）。

**返回值**：

```typescript
{
  claudeDesktop: object  // Claude Desktop 配置 JSON
  cursor: object         // Cursor 配置 JSON
  cherryStudio: object   // Cherry Studio 配置 JSON（含 isActive 字段）
  generic: object        // 通用配置（含 name / type / url / token）
}
```

> 端口在运行时使用实际绑定的端口；停止时使用配置端口。

### `ai.mcpServer.refreshTools()`

手动刷新 MCP Server 的工具列表（通常在插件变更时自动触发）。

### `ai.mcpServer.getConfig()`

获取 MCP Server 配置信息（含 token/port/enabled + stdioBridgePath）。

**返回值**: `Promise<{ enabled: boolean, port: number, token: string, stdioBridgePath: string }>`

### `ai.mcpServer.updatePort(port)`

更新 MCP Server 监听端口（需要重启生效）。

| 参数 | 类型 | 说明 |
|------|------|------|
| `port` | `number` | 端口号（1024-65535） |
