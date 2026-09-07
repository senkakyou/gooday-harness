// =====================================================
// store/confirmStore.js —— 全局确认弹窗（Zustand）
// 职责：用统一的应用内弹窗替代浏览器原生 confirm()
//
// 用法（任意组件/异步函数中）：
//   import { confirmDialog } from '../store/confirmStore'
//   if (!await confirmDialog('确定删除？')) return
//   // 可带选项：confirmDialog('确定删除？', { danger: true, confirmText: '删除' })
// =====================================================

import { create } from 'zustand'

const useConfirmStore = create((set, get) => ({
  // 当前弹窗状态：null 表示关闭；否则为 { message, title, confirmText, cancelText, danger, resolve }
  state: null,

  // 打开弹窗，返回 Promise<boolean>（确定 true / 取消 false）
  open: (opts) => new Promise((resolve) => {
    set({ state: { confirmText: '确定', cancelText: '取消', danger: false, title: '', ...opts, resolve } })
  }),

  // 关闭弹窗并兑现 Promise
  close: (result) => {
    const s = get().state
    s?.resolve(result)
    set({ state: null })
  },
}))

// 独立调用入口（无需 hook，可在普通函数里用）
export const confirmDialog = (message, opts = {}) =>
  useConfirmStore.getState().open({ message, ...opts })

export default useConfirmStore
