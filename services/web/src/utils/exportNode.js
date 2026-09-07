// 把一个 DOM 节点导出为 PNG 图片或 PDF。
// html2canvas / jsPDF 动态 import，不进主包。

async function snapshot(node, { minWidth = 0 } = {}) {
  const { default: html2canvas } = await import('html2canvas')
  // 宽表格（如月度汇总表 5 列）在窄屏手机上会被挤压/裁切，导出前临时把节点撑到 minWidth，
  // 让表格按完整宽度排版后再截图，截完即还原，不影响屏幕显示（论坛#54）。
  const prevWidth = node.style.width
  if (minWidth && node.offsetWidth < minWidth) {
    node.style.width = minWidth + 'px'
    void node.offsetWidth   // 强制重排，使 scrollWidth 反映新布局
  }
  try {
    // 显式传完整尺寸，避免手机上节点超出视口时被裁切（"只看到几天"的根因）
    const w = node.scrollWidth || node.offsetWidth
    const h = node.scrollHeight || node.offsetHeight
    return await html2canvas(node, {
      scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false,
      width: w, height: h, windowWidth: w, windowHeight: h,
      scrollX: 0, scrollY: 0,
    })
  } finally {
    node.style.width = prevWidth
  }
}

// 渲染为 PNG dataURL（供预览 / 长按存相册）
export async function renderNodeToPngUrl(node, opts) {
  const canvas = await snapshot(node, opts)
  return canvas.toDataURL('image/png')
}

// 触发浏览器下载（桌面兜底）
export function downloadDataUrl(url, filename) {
  const a = document.createElement('a')
  a.href = url; a.download = filename
  a.click()
}

export async function exportNodeAsImage(node, filename, opts) {
  const url = await renderNodeToPngUrl(node, opts)
  downloadDataUrl(url, `${filename}.png`)
}

// 导出 PDF：用标准 A4 页面，截图按页宽等比缩放后铺满，过高则纵向分页。
// orientation: 'portrait'(默认) | 'landscape'。宽表格（月度汇总表）用横向，列才放得下、不被裁切（论坛#54）。
export async function exportNodeAsPdf(node, filename, opts = {}) {
  const { minWidth = 0, orientation = 'portrait' } = opts
  const canvas = await snapshot(node, { minWidth })
  const { jsPDF } = await import('jspdf')
  const img = canvas.toDataURL('image/png')
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  // 截图等比缩放到页宽——保证横向完整、不会被裁掉右边
  const imgW = pageW
  const imgH = canvas.height * pageW / canvas.width
  if (imgH <= pageH) {
    pdf.addImage(img, 'PNG', 0, 0, imgW, imgH)
  } else {
    // 内容比一页高：每页画整图但纵向上移一页，超出部分被页面裁掉，实现分页
    let heightLeft = imgH, position = 0
    pdf.addImage(img, 'PNG', 0, position, imgW, imgH)
    heightLeft -= pageH
    while (heightLeft > 0) {
      position -= pageH
      pdf.addPage()
      pdf.addImage(img, 'PNG', 0, position, imgW, imgH)
      heightLeft -= pageH
    }
  }
  pdf.save(`${filename}.pdf`)
}
