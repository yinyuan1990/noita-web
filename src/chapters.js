/** 章节注册表 */
export const CHAPTERS = {
  1: {
    id: 1,
    title: '第一章 · 通道集合',
    short: '第一章',
    url: '/src/scripts/chapter1.json',
    next: 2,
  },
  2: {
    id: 2,
    title: '第二章 · 被背叛',
    short: '第二章',
    url: '/src/scripts/chapter2.json',
    next: 3,
  },
  3: {
    id: 3,
    title: '第三章 · 法术抗力',
    short: '第三章',
    url: '/src/scripts/chapter3.json',
    next: null,
  },
}

export function chapterList() {
  return Object.values(CHAPTERS).sort((a, b) => a.id - b.id)
}
