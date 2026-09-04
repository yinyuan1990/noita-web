/**
 * Spine 3.5 / 3.6 JSON → 3.8 runtime 可读（最小改动）
 * 主差异：skins 从对象改为数组 [{ name, attachments }]
 */
export function convertSpineJsonTo38(data) {
  if (!data || typeof data !== 'object') return data
  const out = { ...data }
  const sk = out.skins
  if (sk && !Array.isArray(sk) && typeof sk === 'object') {
    out.skins = Object.keys(sk).map((name) => ({
      name,
      attachments: sk[name],
    }))
  }
  if (out.skeleton && typeof out.skeleton === 'object') {
    out.skeleton = { ...out.skeleton, spine: '3.8.99' }
  }
  return out
}

export function needsSpine38Convert(data) {
  if (!data || !data.skins) return false
  return !Array.isArray(data.skins)
}
