# 玻璃工作台原型检查

日期：2026-10-15。范围仅为 [原型](index.html)。时间与文件校验记录见 [checks.json](checks.json)。

## 2026-10-16 银灰原型续作：当前最终证据

从原对话中断点继续，范围仅为合成数据 Mockup。以下10月15日记录作为历史保留；当前浅色、深色、编辑、长内容、四象限、侧栏收起、无结果、日历八种状态见 [silver-final/report.json](shots/silver-final/report.json)，实际时间和文件哈希见 [checks-silver.json](checks-silver.json)。

- 银灰基底取代蓝紫贯穿光带，改为右后方柔光、底部漫反射与边缘光斑；正文24px模糊、封面18px模糊，饱和度均为1.2。封面左上30px图标、两行18px标题、底部12px属性；选中卡略大、带“当前任务”标记，仅边缘卡轻透视。上方为左大进展、右待办与详情上下组合。
- 八种1728×1080状态截图均无控制台错误、横向溢出和失败图片。主 Agent 实际看了浅／深色、编辑、长内容、四象限，以及[2倍封面局部](shots/silver-zoom/cover-detail.png)。2倍是图像采样，不冒充全部浏览器缩放／系统辅助设置验收。
- 在真实浏览器复验：工作＋重要不紧急＝2项，全屏四象限保留2项；切卡及全屏返回后进展草稿、对话输入和引用均保留。Enter只换行；导航从03到04、滚轮到12时，上方仍为原任务。编辑态导航顶649.77、底684.77px，均在1080px视口内。
- 暂停复验先发现第三个反光层仍为running：材质层animation简写覆盖了旧暂停规则。将暂停声明放到材质层末尾后，三个光层全部paused，两次读取变换矩阵完全相同；恢复后全部running且矩阵继续变化。深色暂停也逐层核对通过。
- 当前[动效采样](shots/silver-motion/report.json)留108帧及[开始](shots/silver-motion/motion-start.jpg)／[中间](shots/silver-motion/motion-mid.jpg)／[结束](shots/silver-motion/motion-end.jpg)，已实际查看。环境没有ffmpeg，未生成视频或测帧率。
- `node --check docs/design/glass-workbench/workbench.js`、范围内`git diff --check`通过；预览地址HTTP 200。
- `npx tsc --noEmit`实际失败：Obsidian声明中的Menu、Modal、PopoverSuggest缺少HistoryHandler要求的onHistoryBack（obsidian.d.ts第4245／4477／5201行，TS2420）。未改动生产依赖或配置，不写成类型检查通过。

### 本轮独立静态视觉评审与处理

隔离评审者只看当前五张截图（浅／深色、编辑、长内容、四象限），按已有界面润色标准评审，不打分；未评审真实动效和交互。

1. 编辑态导航在屏外：已移至牌组标题行，主 Agent 看图及测量复验可见，保留内容自然增高。
2. 卡片日期／象限和快捷提示偏小：属性提升到12px，助手快捷提示11px，使用既有次级文字色；焦点环改用蓝灰强调色。主 Agent看2倍局部复查。
3. 四象限第二排需向下滚动：保持2×2和自然内容高度，不采纳区块内固定高度滚动，避免以裁切／卡内滚动换取首屏对齐。大画幅仍可滚动查看全部。

减法：删除底部“滚动浏览 · 点击进入”与冗余键盘提示；助手空态说明压为“一起想清楚下一步”。任务名称、属性和实际动作保留。最终修正由主 Agent看图复查，没有第二轮独立评分。

未运行生产构建／全量回归、真实Obsidian及原生宿主、100卡性能、完整缩放矩阵和系统辅助设置；未安装插件／快捷程序、提交推送或发布，未触碰正式任务。交互数据刷新即还原。右侧栏与生产接入仍待用户确认。

## 10月15日大画幅材质修订：历史证据

用户要求先做大画幅，手机形态停止推进。最终八种桌面状态以 `shots/glass-final/` 为准；以下旧稿验证只保留历史，不冒充新版截图。

- 1728×1080 截图覆盖浅色、深色、四象限、侧栏收起、编辑、长内容、无结果、日历；报告无控制台错误、横向溢出、图片失败。实际看图检查了浅／深色、四象限、输入展开及动效前后帧。
- 通过浏览器计算样式核实：正文玻璃 `blur(24px) saturate(1.55)`；封面 `blur(16px) saturate(1.75)`；封面祖先 `mask-image: none`。默认导航底边1047.42px，位于1080px视口内。
- 在真实浏览器页面复查工作＋重要不紧急＝2项；全屏四象限保留2项；返回、切卡后进展草稿、对话输入和显式引用保留。
- 暂停前光带处于 running；暂停后的两次变换矩阵完全一致，恢复后矩阵继续变化。滚轮从03/12浏览至08/12，当前任务不变。时间及读回值见 [checks.json](checks.json)。
- 录制6秒流光及暂停动作，保留 [中间帧](shots/glass-motion/motion-mid.jpg)、[结束帧](shots/glass-motion/motion-end.jpg) 和 [报告](shots/glass-motion/report.json)。起始帧包含侧栏进入的中间状态，不作为最终布局证据。环境无ffmpeg，未生成视频、未测帧率；原始368帧在本机 `.local/glass-workbench-20261015/glass-motion-frames/`。
- 增加减少透明度、更多对比度与不支持背景模糊的CSS回退。系统辅助设置切换未实际测试；手动暂停按钮已验证。

最终 [浅色](shots/glass-final/idle.png)、[深色](shots/glass-final/dark.png)、[完整报告](shots/glass-final/report.json)。

## 初版实际执行

- `node --check docs/design/glass-workbench/workbench.js`：通过。
- `git diff --check -- docs/design/task-stage.md docs/design/glass-workbench PROJECT_STATE.md`：通过。
- 使用 oil-ui `shoot.mjs` 启动独立 Chromium，截图并检查控制台、横向溢出和图片加载；最终桌面、窄窗口、放大与动效采样报告均无上述问题。主 Agent 实际查看了桌面浅／深色、编辑、长内容、四象限、收起侧栏、截止日历、390px 与1024px页面以及放大和动效关键帧。
- 在 Codex 浏览器通过真实页面按钮、文本输入与滚轮走查：工作＋重要不紧急得到2张卡；全屏四象限保留筛选；退出保留当前任务与进展草稿；切卡后恢复中文草稿，对话草稿和显式引用保持不变。
- 滚轮把浏览位置从03/12移动到08/12，展示台仍为原任务，未提交草稿仍在。
- 待办勾选从1/3变为2/3；普通 Enter 留在输入中换行；按钮提交后最新进展和任务历史均出现该内存记录。
- 日历选择10月18日后完整列表显示相应任务；仅输入名称创建后，数量由12变为13，默认未分组／不重要不紧急，空进展、空待办、空详情正确呈现。
- 原型对话为本地固定规则演示，不能将发送动作或演示文字作为真实模型验证。

## 证据

| 范围 | 证据 |
| --- | --- |
| 初版桌面 1440×900，多状态 | [报告](shots/final-desktop/report.json)、[浅色](shots/final-desktop/idle.png)、[深色](shots/final-desktop/dark.png)、[四象限](shots/final-desktop/quadrants.png) |
| 390×844、1024×768完整页面 | [报告](shots/final-responsive/report.json)、[窄窗口](shots/final-responsive/idle-1024x768.png) |
| 初版窄窗口浮动入口修正 | [报告](shots/final-mobile/report.json)、[窄屏](shots/final-mobile/idle.png)、[历史侧栏](shots/final-mobile/history.png) |
| 2倍截图检查 | [报告](shots/zoom/report.json)、[图](shots/zoom/page-@2x.png)；这是工具的2倍采样，不冒充全部浏览器缩放矩阵 |
| 封面导航、收起侧栏、打开记录器 | [报告](shots/motion/report.json)、[开始](shots/motion/motion-start.jpg)、[中间](shots/motion/motion-mid.jpg)、[结束](shots/motion/motion-end.jpg) |

动效采样由 `--record --steps 'click #flow-next; wait 300; click #side-toggle; wait 300; click #edit-progress' --hold 1500` 生成。环境无 ffmpeg，只有帧图，没有生成视频；未测量帧率，首次出场和按压的全过程不作为已独立验证。

## 初版独立视觉评审与修正（材质修订之前）

独立评审者查看修正前的桌面浅／深色、四象限、侧栏收起与窄屏截图，主观评分8.1/10。主要问题：展示台过高挤掉封面导航；当前卡勾号易误解为已完成；筛选及辅助字偏小偏淡。评审仅覆盖静态视觉，不包含实际交互和动效。

已处理：降低普通桌面默认展示台高度；当前任务改为文字标记；提高筛选字号与深色次级对比；简化详情样本的句子；移除“留下每一步”、页眉“我的工作台”和页脚口号／重复品牌，删除重复键盘提示的显示，窄屏改用滑动提示。四象限加入轻背景分区。最终由主 Agent 看图复查，未第二次独立评分。

后续发现窄屏悬浮入口可能遮住全屏按钮，改为固定页眉入口；侧栏展开时隐藏重复侧边轨，并定向重截窄屏与历史状态。

## 未执行与边界

- 未运行生产完整检查或生产构建，本轮没有修改生产源文件。
- 未验证真实 Obsidian、macOS 快捷程序 WebKit、Windows WebView2、真实中文输入法候选、存档写盘／失败、100卡性能及完整60%～120%缩放矩阵。
- CSS 包含减少动态效果和模糊不支持时的回退；系统设置切换下的真实运行未测，不能写成通过。
- 所有数据与对话都是原型内容，刷新后还原。没有本地插件安装、快捷程序更新、Git提交推送或发布。
