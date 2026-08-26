import type { AssetCategory, Item } from './types'

export const ITEM_POOL: Item[] = [
  { id: 'trash', name: '垃圾', value: 3, emoji: '🗑️', tone: '#8b8f91', category: 'leisure' },
  { id: 'noodles', name: '泡面', value: 4, emoji: '🍜', tone: '#d36b4c', category: 'leisure' },
  { id: 'cola', name: '可乐', value: 4, emoji: '🥤', tone: '#ad4d49', category: 'leisure' },
  { id: 'weed', name: '水草', value: 4, emoji: '🌿', tone: '#5e8b70', category: 'property' },
  { id: 'basketball', name: '篮球', value: 5, emoji: '🏀', tone: '#d47a44', category: 'leisure' },
  { id: 'headphones', name: '耳机', value: 5, emoji: '🎧', tone: '#646e89', category: 'luxury' },
  { id: 'milk-tea', name: '奶茶', value: 5, emoji: '🧋', tone: '#ae8066', category: 'leisure' },
  { id: 'toy-car', name: '玩具车', value: 5, emoji: '🚗', tone: '#5d83a6', category: 'transport' },
  { id: 'doll', name: '芭比娃娃', value: 5, emoji: '🎀', tone: '#bd6f83', category: 'leisure' },
  { id: 'phone', name: '手机', value: 6, emoji: '📱', tone: '#596878', category: 'luxury' },
  { id: 'ticket', name: '机票', value: 6, emoji: '🎫', tone: '#4e8497', category: 'transport' },
  { id: 'camera', name: '相机', value: 6, emoji: '📷', tone: '#6c6460', category: 'luxury' },
  { id: 'console', name: '游戏机', value: 6, emoji: '🎮', tone: '#716a9a', category: 'luxury' },
  { id: 'laptop', name: '笔记本电脑', value: 7, emoji: '💻', tone: '#5f7884', category: 'luxury' },
  { id: 'diamond', name: '钻石', value: 7, emoji: '💎', tone: '#5f91a2', category: 'luxury' },
  { id: 'gold', name: '黄金', value: 7, emoji: '🪙', tone: '#b38a39', category: 'luxury' },
  { id: 'bag', name: '名牌包', value: 7, emoji: '👜', tone: '#9b6d58', category: 'luxury' },
  { id: 'tractor', name: '拖拉机', value: 8, emoji: '🚜', tone: '#6e8952', category: 'transport' },
  { id: 'sheep', name: '绵羊', value: 8, emoji: '🐑', tone: '#908775', category: 'property' },
  { id: 'shop', name: '奶茶店', value: 8, emoji: '🏪', tone: '#a67263', category: 'property' },
  { id: 'apartment', name: '公寓房', value: 9, emoji: '🏢', tone: '#627c8c', category: 'property' },
  { id: 'sports-car', name: '跑车', value: 9, emoji: '🏎️', tone: '#a8504b', category: 'transport' },
  { id: 'yacht', name: '游艇', value: 9, emoji: '🛥️', tone: '#4b8297', category: 'transport' },
  { id: 'mansion', name: '豪宅', value: 10, emoji: '🏛️', tone: '#86745e', category: 'property' },
  { id: 'jet', name: '私人飞机', value: 10, emoji: '🛩️', tone: '#587f92', category: 'transport' },
  { id: 'giant-diamond', name: '超大钻石', value: 10, emoji: '💠', tone: '#4b91a3', category: 'luxury' },
  { id: 'space-trip', name: '太空旅行', value: 12, emoji: '🚀', tone: '#655f88', category: 'transport' },
  { id: 'submarine', name: '私人潜艇', value: 12, emoji: '⚓', tone: '#3f7588', category: 'transport' },
  { id: 'island', name: '私人小岛', value: 15, emoji: '🏝️', tone: '#458875', category: 'property' },

  // 生活娱乐：补足至 25 件。低价日常品为主，少量长期权益作为压轴。
  { id: 'chips', name: '薯片', value: 4, emoji: '🥔', tone: '#c98c3d', category: 'leisure' },
  { id: 'coffee', name: '咖啡', value: 4, emoji: '☕', tone: '#8a5a44', category: 'leisure' },
  { id: 'movie-ticket', name: '电影票', value: 4, emoji: '🎟️', tone: '#925f76', category: 'leisure' },
  { id: 'pizza', name: '披萨', value: 5, emoji: '🍕', tone: '#d66e42', category: 'leisure' },
  { id: 'comics', name: '漫画书', value: 5, emoji: '📚', tone: '#8572a0', category: 'leisure' },
  { id: 'lego', name: '乐高玩具', value: 6, emoji: '🧱', tone: '#c85850', category: 'leisure' },
  { id: 'sneakers', name: '运动鞋', value: 6, emoji: '👟', tone: '#6685a7', category: 'leisure' },
  { id: 'guitar', name: '吉他', value: 7, emoji: '🎸', tone: '#a86d47', category: 'leisure' },
  { id: 'skateboard', name: '滑板', value: 7, emoji: '🛹', tone: '#5b8a81', category: 'leisure' },
  { id: 'roller-skates', name: '轮滑鞋', value: 6, emoji: '🛼', tone: '#aa6a92', category: 'leisure' },
  { id: 'dog', name: '宠物狗', value: 8, emoji: '🐕', tone: '#9a785b', category: 'leisure' },
  { id: 'cat', name: '宠物猫', value: 8, emoji: '🐈', tone: '#c28d55', category: 'leisure' },
  { id: 'suit', name: '西服', value: 7, emoji: '👔', tone: '#4f637d', category: 'leisure' },
  { id: 'camping-set', name: '露营套装', value: 8, emoji: '⛺', tone: '#66834e', category: 'leisure' },
  { id: 'signed-jersey', name: '球星签名衣', value: 10, emoji: '👕', tone: '#ad8351', category: 'leisure' },
  { id: 'esports-naming', name: '电竞冠名权', value: 11, emoji: '🏆', tone: '#8769aa', category: 'leisure' },
  { id: 'festival-black-card', name: '音乐节黑卡', value: 12, emoji: '🎵', tone: '#724a86', category: 'leisure' },
  { id: 'theme-park-card', name: '环球乐园卡', value: 12, emoji: '🎡', tone: '#d86a58', category: 'leisure' },
  { id: 'star-private-show', name: '巨星私演', value: 13, emoji: '🎤', tone: '#a34e67', category: 'leisure' },

  // 交通旅行：补足至 25 件，从通勤权益递进至大型载具。
  { id: 'transit-card', name: '城市通勤卡', value: 4, emoji: '🪪', tone: '#5b8497', category: 'transport' },
  { id: 'bicycle', name: '自行车', value: 4, emoji: '🚲', tone: '#5d91a7', category: 'transport' },
  { id: 'high-speed-rail', name: '高铁票', value: 5, emoji: '🚄', tone: '#627ca1', category: 'transport' },
  { id: 'hot-air-balloon', name: '热气球', value: 7, emoji: '🎈', tone: '#bf6d69', category: 'transport' },
  { id: 'motorcycle', name: '摩托车', value: 7, emoji: '🏍️', tone: '#9c5b55', category: 'transport' },
  { id: 'go-kart', name: '卡丁车', value: 7, emoji: '🏎️', tone: '#c27646', category: 'transport' },
  { id: 'business-flight', name: '商务舱机票', value: 8, emoji: '✈️', tone: '#5c849f', category: 'transport' },
  { id: 'offroad', name: '越野车', value: 9, emoji: '🚙', tone: '#77834e', category: 'transport' },
  { id: 'camper-van', name: '露营房车', value: 10, emoji: '🚐', tone: '#6f927f', category: 'transport' },
  { id: 'bugatti', name: '布加迪威龙', value: 13, emoji: '🏁', tone: '#3e6fa5', category: 'transport' },
  { id: 'cruise-ship', name: '游轮', value: 12, emoji: '🛳️', tone: '#3b8295', category: 'transport' },
  { id: 'helicopter', name: '直升机', value: 12, emoji: '🚁', tone: '#6a778b', category: 'transport' },
  { id: 'antique-car', name: '古董车', value: 11, emoji: '🚘', tone: '#9d7748', category: 'transport' },
  { id: 'luxury-cruise', name: '豪华游轮', value: 13, emoji: '🛥️', tone: '#477f96', category: 'transport' },
  { id: 'airship', name: '飞艇', value: 14, emoji: '🎈', tone: '#7283a5', category: 'transport' },
  { id: 'maglev', name: '磁悬浮列车', value: 15, emoji: '🚝', tone: '#5d92a9', category: 'transport' },
  { id: 'rocket', name: '火箭', value: 16, emoji: '🚀', tone: '#785c9e', category: 'transport' },

  // 奢侈科技：补足至 25 件，保留少量顶级收藏。
  { id: 'keyboard', name: '键盘', value: 4, emoji: '⌨️', tone: '#5e6477', category: 'luxury' },
  { id: 'smart-watch', name: '智能手表', value: 6, emoji: '⌚', tone: '#606f81', category: 'luxury' },
  { id: 'game-console-plus', name: '游戏机', value: 7, emoji: '🕹️', tone: '#7463a3', category: 'luxury' },
  { id: 'tablet', name: '平板电脑', value: 7, emoji: '📲', tone: '#597589', category: 'luxury' },
  { id: 'drone', name: '无人机', value: 8, emoji: '🛸', tone: '#6d7790', category: 'luxury' },
  { id: 'vr-glasses', name: 'VR眼镜', value: 8, emoji: '🥽', tone: '#7a6393', category: 'luxury' },
  { id: 'gold-necklace', name: '黄金项链', value: 8, emoji: '📿', tone: '#b88b37', category: 'luxury' },
  { id: 'hi-fi', name: '高端音响', value: 9, emoji: '🔊', tone: '#5a6678', category: 'luxury' },
  { id: 'pearl-necklace', name: '珍珠项链', value: 9, emoji: '🦪', tone: '#c2b4a1', category: 'luxury' },
  { id: 'antique-camera', name: '古董相机', value: 10, emoji: '📸', tone: '#7d6754', category: 'luxury' },
  { id: 'sapphire', name: '蓝宝石', value: 10, emoji: '🔷', tone: '#416ea8', category: 'luxury' },
  { id: 'ruby', name: '红宝石', value: 10, emoji: '🔴', tone: '#aa4d59', category: 'luxury' },
  { id: 'qi-baishi-shrimp', name: '齐白石的虾', value: 12, emoji: '🖼️', tone: '#7c7285', category: 'luxury' },
  { id: 'lunar-sample', name: '月球样本', value: 13, emoji: '🌕', tone: '#7d7682', category: 'luxury' },
  { id: 'moutai', name: '茅台酒', value: 10, emoji: '🍶', tone: '#9c754f', category: 'luxury' },
  { id: 'balenciaga', name: '巴黎世家', value: 10, emoji: '🛍️', tone: '#59626f', category: 'luxury' },

  // 地产产业：补足至 25 件，作为高价值产业资产的主要来源。
  { id: 'potted-plant', name: '小盆栽', value: 4, emoji: '🪴', tone: '#609160', category: 'property' },
  { id: 'parking-spot', name: '私人车位', value: 7, emoji: '🅿️', tone: '#607da3', category: 'property' },
  { id: 'vegetable-garden', name: '菜园', value: 6, emoji: '🥬', tone: '#698c4e', category: 'property' },
  { id: 'greenhouse', name: '玻璃温室', value: 8, emoji: '🏡', tone: '#759f89', category: 'property' },
  { id: 'street-stall', name: '街角小摊', value: 6, emoji: '🛒', tone: '#b77651', category: 'property' },
  { id: 'country-inn', name: '乡村民宿', value: 9, emoji: '🏠', tone: '#a3735f', category: 'property' },
  { id: 'community-shop', name: '社区商铺', value: 9, emoji: '🏬', tone: '#8c6e54', category: 'property' },
  { id: 'family-farm', name: '家庭农场', value: 9, emoji: '🚜', tone: '#709158', category: 'property' },
  { id: 'museum', name: '博物馆', value: 14, emoji: '🏛️', tone: '#82745e', category: 'property' },
  { id: 'seaside-villa', name: '海景别墅', value: 12, emoji: '🏖️', tone: '#5d8e9d', category: 'property' },
  { id: 'vineyard', name: '葡萄园', value: 12, emoji: '🍇', tone: '#7d696c', category: 'property' },
  { id: 'racecourse', name: '赛马场', value: 13, emoji: '🏇', tone: '#867253', category: 'property' },
  { id: 'resort', name: '度假村', value: 14, emoji: '🏝️', tone: '#579181', category: 'property' },
  { id: 'office-building', name: '写字楼', value: 13, emoji: '🏙️', tone: '#637d94', category: 'property' },
  { id: 'boutique-hotel', name: '精品酒店', value: 14, emoji: '🏨', tone: '#9b6d5e', category: 'property' },
  { id: 'french-estate', name: '法国庄园', value: 15, emoji: '🏰', tone: '#987d58', category: 'property' },
  { id: 'european-castle', name: '欧洲古堡', value: 16, emoji: '🏯', tone: '#75677e', category: 'property' },
  { id: 'moon', name: '月球', value: 19, emoji: '🌙', tone: '#73788b', category: 'property' },
  { id: 'mars', name: '火星', value: 20, emoji: '🔴', tone: '#ad594f', category: 'property' },
]

const categoryById = new Map(ITEM_POOL.map((item) => [item.id, item.category]))

export function categoryForItemId(id: string): AssetCategory {
  return categoryById.get(id) ?? 'leisure'
}

export function normalizeItem(item: Omit<Item, 'category'> & Partial<Pick<Item, 'category'>>): Item {
  return { ...item, category: item.category ?? categoryForItemId(item.id) }
}

function randomIndex(maxExclusive: number): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const values = new Uint32Array(1)
    crypto.getRandomValues(values)
    return values[0] % maxExclusive
  }
  return Math.floor(Math.random() * maxExclusive)
}

export function shuffle<T>(values: readonly T[]): T[] {
  const copy = [...values]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1)
    ;[copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]]
  }
  return copy
}

export function createItemDeck(rounds: number): Item[] {
  return shuffle(ITEM_POOL).slice(0, rounds)
}
