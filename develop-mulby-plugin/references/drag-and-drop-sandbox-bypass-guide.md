# Mulby 插件开发经验总结：拖拽与沙盒权限绕过指南

在开发具有本地文件系统操作能力的 Mulby 插件（例如 `batch-rename`）时，处理系统拖拽事件与沙盒文件权限常常会遇到一些具有迷惑性的报错与问题。本文档总结了在实现文件/文件夹拖拽读取与操作时踩过的坑以及最终的最佳实践方案。

## 1. 全局拖拽事件（Drag & Drop）拦截的深坑

在前端 UI（`App.tsx` 等）中实现拖拽功能时，如果处理不当，经常会遇到 `event.dataTransfer` 为空或“无法提取到有效文件信息”的诡异现象。

**问题原因**：
根据 HTML5 Drag and Drop API 规范以及 Chromium 的安全机制，要让一个区域成为合法的拖拽释放目标（Drop Zone），**必须同时在 `dragenter` 和 `dragover` 事件中调用 `event.preventDefault()`**。
如果漏掉了 `dragenter`，Chromium 可能会在最终触发 `drop` 事件时，强行清空 `dataTransfer` 中的数据流，导致获取不到任何文件信息。

**最佳实践**：
为了防止内部深层嵌套的 DOM 节点打断拖拽事件流，建议直接在 `window` 对象上注册全局事件，并且必须补全所有关键钩子：

```typescript
useEffect(() => {
  const handleGlobalDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleGlobalDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleGlobalDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    
    // ... 执行业务逻辑
  };

  window.addEventListener('dragenter', handleGlobalDragEnter);
  window.addEventListener('dragover', handleGlobalDragOver);
  window.addEventListener('drop', handleGlobalDrop);

  return () => {
    window.removeEventListener('dragenter', handleGlobalDragEnter);
    window.removeEventListener('dragover', handleGlobalDragOver);
    window.removeEventListener('drop', handleGlobalDrop);
  };
}, []);
```

## 2. 拖拽路径提取的三保险策略与事件回收陷阱

由于部分沙盒（如 iframe）环境下直接读取 `File.path` 可能被隐藏为空字符串，因此不能单纯依赖 `event.dataTransfer.files[i].path`。应当采取多通道提取、互相降级的策略：

1. **原生 File 对象属性提取法**：常规 Electron 环境下 `File.path` 是有值的。
2. **底层剪贴板协议解析法（极度可靠）**：使用 `event.dataTransfer.getData('text/uri-list')` 或 `getData('text/plain')`。这在 macOS Finder 和 Windows 资源管理器中是最稳定的路径传递通道。提取后需注意手动 `decodeURIComponent` 还原中文/特殊字符，并剔除 `file://` 前缀。
3. **官方宿主 API 解析法**：使用 `mulby.plugin.resolveDroppedFilePaths(files)` 通过宿主底层 API 获取物理路径。

### ⚠️ 异步读取导致 dataTransfer 被清空的致命深坑

如果你的 `drop` 回调是一个 `async` 函数，并且在调用 `resolveDroppedFilePaths` 时使用了 `await`：

```typescript
// ❌ 错误示范：await 让出执行权后，浏览器强制清空了 e.dataTransfer！
const paths = await plugin.resolveDroppedFilePaths(e.dataTransfer.files);
const fallbackPaths = e.dataTransfer.getData('text/uri-list'); // 此时取到的是空字符串！
```

**原因与解决**：
根据 HTML5 规范，一旦事件处理函数的同步执行阶段结束（遇到 `await` 就是结束了当前 tick），浏览器出于安全和内存回收考虑，会立即清空、作废 `dataTransfer` 对象里的所有数据！

因此，我们必须**在任何 await 发生之前，先把所有可能需要的数据同步读取到内存变量中**，并且如果需要将 `FileList` 传给异步 API，必须使用 `Array.from` 进行静态快照拷贝。

**终极参考实现（集成了防清空与全通道解析）：**

```typescript
// 解析并清理 file:// 前缀的辅助函数
const parseDroppedPathText = (raw: string): string[] => {
  if (!raw) return [];
  return raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean).filter(l => !l.startsWith('#'))
    .map(line => {
      if (line.startsWith('file://')) {
        try {
          let p = decodeURIComponent(line.replace(/^file:\/\//, ''));
          if (p.startsWith('/') && p.match(/^\/[a-zA-Z]:\//)) p = p.substring(1); // 修复 Windows 盘符
          return p;
        } catch {
          return line.replace(/^file:\/\//, '');
        }
      }
      return line;
    });
};

// 必须【同步】执行的收集函数
const collectFilePaths = (event: DragEvent): string[] => {
  const dt = event.dataTransfer;
  if (!dt) return [];
  const candidates = new Set<string>();

  // 通道 1: File.path
  for (let i = 0; i < (dt.files?.length || 0); i++) {
    const file = dt.files[i] as File & { path?: string };
    if (file.path) candidates.add(file.path);
  }
  // 通道 2 & 3: uri-list 和 plain text
  parseDroppedPathText(dt.getData('text/uri-list')).forEach(p => candidates.add(p));
  parseDroppedPathText(dt.getData('text/plain')).forEach(p => candidates.add(p));

  return [...candidates].filter(Boolean);
};

const handleGlobalDrop = async (e: DragEvent) => {
  e.preventDefault();
  
  // 1. 同步收集所有基础途径能拿到的路径（不包含 await！）
  let filePaths = collectFilePaths(e);
  
  // 2. 拷贝 FileList，防止被清理
  const staticFiles = Array.from(e.dataTransfer?.files || []) as File[];

  // 3. 开始执行异步逻辑
  const pluginApi = window.mulby?.plugin;
  if (pluginApi && staticFiles.length > 0) {
    const resolvedPaths = await pluginApi.resolveDroppedFilePaths(staticFiles);
    if (resolvedPaths) filePaths = [...filePaths, ...resolvedPaths];
  }
  
  filePaths = [...new Set(filePaths)];
  // 执行后续业务...
};
```

## 3. UI 渲染沙盒限制与后端 RPC 绕过

**问题表现**：
如果通过解析 `text/uri-list` 拿到了用户拖进来的文件夹路径 `/Users/xxx/Documents/Folder`，并在前端直接调用 `mulby.filesystem.stat(filePath)` 尝试读取该目录，通常会报错 **“请检查宿主授权”**。这是因为该路径仅仅是通过字符串拖入的，未通过原生文件选择对话框触发，前端沙盒认定其为越权访问。

**破局方案**：
将文件系统的遍历（递归读取子文件）以及核心操作（如重命名、移动文件）**全部下放至插件的后端进程（`main.ts`）处理**。

1. **在 `main.ts` 中注册 RPC 接口**：
   后端进程是不受前端沙盒约束的，在 `main.ts` 中可以自由使用 `mulby.filesystem` 或直接 import Node 的 `fs` 进行大尺度文件系统操作。
   ```typescript
   export const rpc = {
     async getFilesFromPath(filePath: string) {
       const fs = mulby.filesystem;
       // ... 在这里递归 fs.stat 和 fs.readdir
       return results;
     },
     async executeRename(moves: {oldPath: string, newPath: string}[]) {
       const fs = mulby.filesystem;
       // ... 在这里执行 fs.move
       return { successCount };
     }
   }
   ```

2. **在 UI 前端通过宿主桥接调用**：
   在 `App.tsx` 中，不再使用受限的 `filesystem`，而是通过 `host.call` 将指令派发给后端。
   ```typescript
   const host = window.mulby?.host;
   const res: any = await host.call('batch-rename', 'getFilesFromPath', filePath);
   ```

## 4. 警惕 RPC 接口返回的数据包装格式

**深坑警告：`TypeError: XXX is not iterable`**

在使用 `host.call` 时，前端接收到的返回值并不是后端直接 return 的数据本体，而是经过宿主桥接层包装的结构对象：`{ data: [...] }`。

如果后端 `rpc` 方法返回了一个数组，在前端千万**不能**直接按数组处理或使用扩展运算符：
```typescript
// ❌ 错误示范：会导致 is not iterable 报错
const results = await host.call('plugin-id', 'methodName', args);
allItems = [...allItems, ...results]; 

// ✅ 正确示范：安全解包 .data 属性
const res: any = await host.call('plugin-id', 'methodName', args);
const results = res?.data || [];
allItems = [...allItems, ...results];
```

## 总结

开发桌面级涉及本地文件的插件应用时，应遵循**“前端负责展现与路径提取，后端负责高权限计算与文件读写”**的分层架构。合理运用 `dragenter`、多通道路径提取以及宿主提供的 RPC 通信机制，就能打造出像原生应用一样顺滑且健壮的用户体验。
