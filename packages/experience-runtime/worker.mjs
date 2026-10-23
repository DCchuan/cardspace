import { initial, reduce, project, start, restore } from "./engine.mjs";
let spec, state;
self.onmessage = ({ data: m }) => {
  try {
    if (JSON.stringify(m).length > 600000) throw Error("MESSAGE_SIZE");
    if (m.type === "INIT") {
      spec = m.spec;
      start(spec, m.refs);
      state = m.snapshot ? restore(spec, m.snapshot) : initial(spec);
    } else {
      if (!spec) throw Error("NOT_READY");
      state = reduce(spec, state, m.event);
    }
    self.postMessage({ type: "STATE", id: m.id, ...project(spec, state) });
  } catch (e) {
    self.postMessage({
      type: "ERROR",
      id: m.id,
      code: String(e.message).slice(0, 240),
    });
  }
};
