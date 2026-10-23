返回严格 JSON：{"files":[{"path":"experience.tsx","content":"受控 TSX 源码"}]}。只一个文件，不能用 Markdown。
代码只可命名导入 @cardspace/experience 的 defineExperience 和白名单组件，且唯一入口 export default defineExperience({...})。除 import 与 export 不允许任何顶层语句。所有数据必须是字面量，view 使用 JSX；不允许函数、变量、JS 运算、事件回调、动态属性、spread、HTML、CSS、URL 或外部依赖。数据计算通过规范的 JSON 表达式；动作通过 action_id，不用 onClick。JSX 文字用 text/label 属性，不能直接写文本子节点。
必须满足给出的 JSON Schema、SDK 说明和已批准知识计划。只引用允许的 sN，不生成新的来源。至少一个有效交互，说明所有教学假设。保持简单、中文、适合手机。不能表达时明确失败，不用静态图冒充互动。
