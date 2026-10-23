import {defineExperience,Stack,Heading,Paragraph,Toggle,FlowGraph,Button,SourceLink} from '@cardspace/experience';
export default defineExperience({version: "experience.v1",
title: "订单流程推演",
mode: "explainer",
assumptions: [{"id":"example","text":"本演示为本地教学模拟，不连接实际账户或支付系统。","origin":"illustration","source_refs":["s1"]}],
state: {"stage":{"kind":"string","initial":"created","max_length":30},"valid":{"kind":"boolean","initial":false}},
datasets: {"nodes":{"origin":"illustration","source_refs":[],"rows":[{"id":"created","label":"创建订单"},{"id":"checked","label":"校验通过"},{"id":"paid","label":"支付模拟"},{"id":"done","label":"完成"}]},"edges":{"origin":"illustration","source_refs":[],"rows":[{"from":"created","to":"checked"},{"from":"checked","to":"paid"},{"from":"paid","to":"done"}]}},
derivations: [],
actions: {"next":{"kind":"transition","state_key":"stage","edges":[{"from":"created","to":"checked","guard":{"state":"valid"}},{"from":"checked","to":"paid"},{"from":"paid","to":"done"}]}},
view:(<Stack id={"root"}><Heading id={"title"} text={"订单流程推演"} />
<Paragraph id={"intro"} text={"先满足校验条件，再逐步推进。支付只改变本地状态。"} origin={"illustration"} source_refs={["s1"]} />
<Toggle id={"valid"} label={"资料已校验"} state_key={"valid"} />
<FlowGraph id={"flow"} nodes_key={"nodes"} edges_key={"edges"} active_state_key={"stage"} />
<Button id={"next"} label={"下一步"} action_id={"next"} />
<SourceLink id={"source"} ref_id={"s1"} /></Stack>)});
