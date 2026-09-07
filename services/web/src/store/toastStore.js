// =====================================================
// store/toastStore.js —— 全局消息通知存储（Zustand）
// 职责：任何组件都能调用 toast() 弹出提示，Toast 组件负责渲染
//
// 设计思路：
//   - toast(msg) 绿色提示
//   - toast(msg, true) 红色错误提示
//   - 3秒后自动消失
// =====================================================

import { create } from 'zustand'

let _id = 0  // 自增 ID，用于区分多条并存的 toast，也是 React 列表渲染需要的 key

const useToastStore = create((set) => ({
  // ---- 状态 ----
  toasts: [],  // 当前显示的所有 toast：[{ id, msg, isError }, ...]

  // ---- 操作方法 ----
  // 弹出一条消息
  toast: (msg, isError = false) => {
    const id = ++_id
    // 把新 toast 追加到列表
    set(s => ({ toasts: [...s.toasts, { id, msg, isError }] }))
    // 3秒后从列表里删掉这条（通过 id 精确匹配，不影响其他 toast）
    setTimeout(() => {
      set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
    }, 3000)
  },
}))

export default useToastStore
