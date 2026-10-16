# 卡片阅读与记录入口优化

2026-10-15，用户反馈卡片「太死板，使用下来没有推进的欲望」，要求参考此间对话采用的前端资源优化当前卡片。

## 方向

保持插件尺度、素白默认主题和现有卡片布局，把最新进展作为阅读重心，让记录入口更容易辨认。这个方向改善可读性和操作反馈，不把视觉修改等同于已经改善长期使用意愿。

此间 `docs/archive/design/cards-01/README.md` 记录的资源包括 [Component Gallery](https://component.gallery/components/card/)、[React Bits / Bounce Cards](https://reactbits.dev/components/bounce-cards)、[Motion Primitives / Morphing Dialog](https://motion-primitives.com/docs/morphing-dialog) 和 [Inclusive Components / Cards](https://inclusive-components.design/cards/)。本轮借鉴卡片层级与动作连续性的思路，使用现有 CSS、Lucide 和既有展开动效；没有引入这些库的依赖、源码或此间的专属插画。Motion Primitives 页面本轮访问失败，参考范围限于此间既有记录。

## 实现

- 标题由 13px 调为 14px，最新进展由 11px 调为 12px，说明由 9px 调为 10px；保留收起单行标题、两行进展及等高卡片。
- 以主题变量生成低对比的进展阅读底色，替换旧的竖线引用式呈现；卡片边界和阴影更柔和。展开仍用明确的主题色边框，正文自然增高。
- 「记录进展」使用小尺寸底色按钮和方向箭头，按压、悬停只反馈按钮本身，卡片不漂移。收起及已结束卡片使用对应方向图标。
- 保存成功提示移至卡片底部，不遮挡进展；只跟随现有真实写入回执出现。短淡入响应减少动态效果，不新增计时成功状态。
- 桌面快捷进展的「上次进展」采用同样的阅读底色。原位编辑、单卡编辑、草稿、时间线、任务排序和数据协议保持既有规则。

## 验收

局部组件优化，由主 Agent 查看当前实现、深浅色、短窗口、2倍渲染和连续帧；未进行独立设计评审，不打分。移除了卡片操作前的文本加号和进展左侧竖线，没有新增解释性或激励口号。实际检查与安装证据见[验收记录](../validation/2026-10-15-card-refresh.md)。
