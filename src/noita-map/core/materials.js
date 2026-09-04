// ── 材质表(public/res/noita/materials.json,由 scripts/noita-prepare-assets.mjs 从 materials.xml 生成)──
// 提供 wang 色 → 材质 id、名 → id、渲染色/贴图/种类。材质 id = xml 顺序(air 恒 0)。

export class MaterialTable {
  /** @param {Array<{id:number,name:string,kind:string,wang:string|null,color:string|null,texture:string|null,density:number}>} list */
  constructor(list) {
    this.list = list
    this.byName = new Map()
    this.byWang = new Map()
    this.color = new Uint32Array(list.length)   // 0xRRGGBB
    this.alpha = new Uint8Array(list.length)
    this.kind = new Array(list.length)
    for (const m of list) {
      this.byName.set(m.name, m.id)
      // 同一 wang 色多个材质(子材质继承)→ 先出现者优先,和游戏查表一致
      if (m.wang) {
        const c = parseInt(m.wang.slice(-6), 16)
        if (!this.byWang.has(c)) this.byWang.set(c, m.id)
      }
      const col = m.color || m.wang || 'ff808080'
      this.color[m.id] = parseInt(col.slice(-6), 16)
      this.alpha[m.id] = col.length === 8 ? parseInt(col.slice(0, 2), 16) : 255
      this.kind[m.id] = m.kind
    }
    this.AIR = 0
    this.id = (name) => {
      const v = this.byName.get(name)
      if (v === undefined) throw new Error('未知材质 ' + name)
      return v
    }
  }

  /** wang 色 → 材质 id,查不到返回 -1 */
  fromWang(rgb) {
    const v = this.byWang.get(rgb & 0xffffff)
    return v === undefined ? -1 : v
  }

  name(id) { return this.list[id]?.name }
  isSolid(id) { const k = this.kind[id]; return k === 'static' || k === 'solid' || k === 'sand' }
  isLiquid(id) { return this.kind[id] === 'liquid' }
}

export async function loadMaterialTable(url = '/res/noita/materials.json') {
  const r = await fetch(url)
  return new MaterialTable(await r.json())
}
