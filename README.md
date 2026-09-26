# Tracelo（工作时间线）

Obsidian 单设备任务进展插件。左侧持续展示当前待办，右侧显示每日时间线或单任务完整历史。

仓库：https://github.com/skybcyang/Tracelo

## 功能

- 分组与四象限视图，共享同一批任务并支持跨区域拖动
- 卡片内追加进展、按任务持久化草稿、最近进展自动置顶
- 可选的单层待办清单与截止日期；截止安排显示在每日时间线，变更保留历史
- 完成、异常关闭、重开、改名及属性变更的完整追加式历史
- 统一已结束区，以及任务名称和进展内容全文搜索
- 固定 ID Markdown 任务档案，便于阅读、检索和 AI 只读分析
- 自动生成 `agent.md`，禁止 agent 直接修改任务存档
- 每日 7 天轮换备份、升级专项快照和异常文件自动恢复

正式任务和历史默认保存在 `工作记录/任务/`。草稿、排序和界面偏好保存在插件数据中；旧 JSON 任务不会迁移，首次切换前会先备份。

## 文档

- [需求与验收基线](docs/requirements.md)：业务规则、存储方案与 17 条首版加 7 条扩展验收场景
- [设计基线](docs/design/precision-chrome.html)：界面设计基线（参考图 `precision-chrome-refined.png`，由 `tests/design-baseline.test.ts` 守护）
- [可选待办与截止日期](docs/design/optional-task-details.md)：交互规则与[独立原型](docs/design/optional-task-details.html)；原型不读取或保存 Obsidian 任务
- [Agent 只读规则模板](docs/templates/agent.md)：插件初始化时写入任务目录的 `agent.md` 模板

## 开发

要求 Node.js ≥ 22.12。

```sh
npm install
npm test          # vitest 单元/契约测试
npm run build     # 类型检查 + esbuild 产出 main.js
npm run test:layout  # 本机 Chrome 中的卡片布局与滚动检查（需要 playwright 浏览器）
npm run check     # 依次执行以上全部
```

卡片使用原生 CSS Grid：基础高度 148px，按内容占用最少整数格；列数随可用宽度自动变化，长进展与待办不会裁切。

## 本地安装

在目标仓库的 `.obsidian/plugins/` 下创建 `work-timeline` 文件夹，将以下文件放入其中：

```text
main.js
manifest.json
styles.css
```

重新加载 Obsidian 后，在“第三方插件”中启用“Tracelo”。点击左侧历史图标，或从命令面板运行“打开工作时间线”。

从旧版本升级到 `0.3.0` 时，插件在首次加载旧任务后生成升级快照；任务 Markdown 继续使用兼容的 v1 协议。无需给既有任务补写待办或截止日期。
