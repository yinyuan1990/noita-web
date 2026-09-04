/**
 * Spine 原生体量测量
 *
 * 目标身高不在这里写死——由 WORLD.humanScreenRatio × 画布高度决定
 * （人物相对战场，见 config.WORLD）
 *
 *   unitScale = targetHumanH / nativeH
 *   renderScale = unitScale × size × buff × depth
 */

/**
 * 测量 Spine 在 scale=1、setup/idle 姿态下的原生高度
 */
export function measureSpineNativeHeight(spine, fallbackH = 360) {
  if (!spine) return fallbackH

  const data = spine.spineData
  if (data && data.height > 16) return data.height

  const sx = spine.scale.x
  const sy = spine.scale.y
  try {
    spine.scale.set(1, 1)
    if (spine.skeleton) {
      spine.skeleton.setToSetupPose?.()
      spine.skeleton.updateWorldTransform?.()
    }
    try {
      const anims = data?.animations || []
      const idle =
        anims.find((a) => /^idle/i.test(a.name)) ||
        anims.find((a) => !/death|die|dead|skill|att/i.test(a.name))
      if (idle && spine.state?.setAnimation) {
        spine.state.setAnimation(0, idle.name, false)
        spine.state.update(0)
        spine.skeleton?.updateWorldTransform?.()
      }
    } catch (e) {
      void e
    }
    if (typeof spine.update === 'function') spine.update(0)

    let h = 0
    if (typeof spine.getLocalBounds === 'function') {
      const b = spine.getLocalBounds()
      const boxH = Math.abs(b.height) || 0
      const toTop = b.y < 0 ? Math.abs(b.y) : 0
      const toBottom = b.y + b.height > 0 ? b.y + b.height : 0
      h = Math.max(boxH, toTop + toBottom)
    } else if (typeof spine.getBounds === 'function') {
      const b = spine.getBounds(false)
      h = Math.abs(b.height) || 0
    }

    if (h > 2000) h = data?.height > 16 ? data.height : 800
    if (h < 16 && data && data.width > 16) h = data.width * 1.6
    return Math.max(h, 16)
  } catch (e) {
    void e
    return data?.height > 16 ? data.height : fallbackH
  } finally {
    spine.scale.x = sx
    spine.scale.y = sy
  }
}

/**
 * @param {number} nativeH 原生体高
 * @param {number} targetH 世界里人类目标身高（像素）
 * @param {number} [overrideNativeH] cast.nativeH
 */
export function unitScaleFromNative(nativeH, targetH, overrideNativeH) {
  const h = overrideNativeH > 16 ? overrideNativeH : nativeH
  return Math.max(8, targetH) / Math.max(16, h)
}
