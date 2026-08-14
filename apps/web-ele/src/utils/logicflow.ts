/**
 * Vite ESM 导入 @logicflow/core 时，package.json 的 module 字段指向 UMD，
 * default 可能套一层或不是构造函数。统一在此解包。
 */
import LogicFlowMod from '@logicflow/core'

import '@logicflow/core/dist/style/index.css'

function unwrapLogicFlow(mod: unknown): new (...args: any[]) => any {
  let cur: any = mod
  for (let i = 0; i < 4; i++) {
    if (typeof cur === 'function') return cur
    if (cur && typeof cur.LogicFlow === 'function') return cur.LogicFlow
    if (cur?.default != null) {
      cur = cur.default
      continue
    }
    break
  }
  throw new TypeError(
    '[logicflow] LogicFlow is not a constructor — check Vite CJS/UMD interop',
  )
}

export const LogicFlow = unwrapLogicFlow(LogicFlowMod)
export default LogicFlow
