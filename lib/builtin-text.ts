// The built-ins in Chinese: the names, descriptions and tags of the graphs,
// effects and grades the app ships, and the labels of a character's default
// groups.
//
// DISPLAY ONLY. What is stored is always the English name — scenes refer to a
// built-in by it, and a scene made in one language opens in the other — so this
// table translates on the way to the screen and never into a document. The
// English text is the item's own (content/*.json); a user's or a published item
// shows as its author wrote it, in whatever language, and is never looked up.

import type { Locale } from "@/lib/i18n"

type Zh = { name: string; description: string }

const GRAPHS: Record<string, Zh> = {
  // Character looks: pack · part.
  "AG Body": { name: "深空之眼·身体", description: "深空之眼风格的皮肤，明暗交界柔和平滑。效果来自小绿毛猫。" },
  "AG Eye": { name: "深空之眼·眼睛", description: "明亮饱和的眼睛，可透过头发显示。效果来自小绿毛猫。" },
  "AG Face": { name: "深空之眼·脸部", description: "脸部着色，避免鼻子和眉毛的硬阴影落在脸颊上。效果来自小绿毛猫。" },
  "AG Hair": { name: "深空之眼·头发", description: "头发：柔和的卡通色阶、高光条和暖色边缘光。效果来自小绿毛猫。" },
  "AG Metal": { name: "深空之眼·金属", description: "深色底上的锐利高光，适合首饰和金属配件。效果来自小绿毛猫。" },
  "AG Rough Cloth": { name: "深空之眼·粗糙布料", description: "几乎无光泽的哑光布料，如棉、毛料。效果来自小绿毛猫。" },
  "AG Smooth Cloth": { name: "深空之眼·光滑布料", description: "带有干净光泽的布料，如缎面、皮革。效果来自小绿毛猫。" },
  "AG Stockings": { name: "深空之眼·丝袜", description: "半透明丝袜，在掠射角度下也保持稳定。效果来自小绿毛猫。" },
  "WuWa Body": { name: "鸣潮·身体", description: "鸣潮风格的皮肤：宽而柔和的明暗交界，阴影偏暖。效果来自三一七片的谎言。" },
  "WuWa Cloth": { name: "鸣潮·布料", description: "服装布料：明暗交界比皮肤更硬，阴影更冷、更饱和。效果来自三一七片的谎言。" },
  "WuWa Hair": { name: "鸣潮·头发", description: "头发：本套中最硬的明暗交界，配合明显的高光条。效果来自三一七片的谎言。" },
  "WuWa Face": { name: "鸣潮·脸部", description: "本套中最柔和的着色，鼻子和眉毛不留硬阴影。效果来自三一七片的谎言。" },
  "WuWa Metal": { name: "鸣潮·金属", description: "首饰和金属配件：接近硬阶的明暗、强高光和边缘光。效果来自三一七片的谎言。" },
  "WuWa Eye": { name: "鸣潮·眼睛", description: "明亮的眼睛，可透过遮挡的头发显示。效果来自三一七片的谎言。" },
  "ZZZ Body": { name: "绝区零·身体", description: "绝区零风格的皮肤：硬朗的明暗交界，亮部偏暖，阴影去饱和。效果来自世界的歌。" },
  "ZZZ Face": { name: "绝区零·脸部", description: "脸部：亮部更红润，阴影保留比身体更多的颜色。效果来自世界的歌。" },
  "ZZZ Hair": { name: "绝区零·头发", description: "头发：亮部保持贴图原色，阴影为七成亮度，不加色调。效果来自世界的歌。" },
  "ZZZ Eye": { name: "绝区零·眼睛", description: "眼睛：与服装一致的三阶硬色调。效果来自世界的歌。" },
  "ZZZ Metal": { name: "绝区零·金属", description: "金属配件和饰品：三阶硬色调，本套中色阶最硬。效果来自世界的歌。" },
  "ZZZ Cloth": { name: "绝区零·布料", description: "服装布料：三阶硬色调，阴影中仍可见纹理。效果来自世界的歌。" },
  "HSR Body": { name: "星穹铁道·身体", description: "星穹铁道风格的皮肤：近白的暖色阴影，对比度来自色调曲线。" },
  "HSR Face": { name: "星穹铁道·脸部", description: "本套中最柔和的明暗交界，脸颊上不出现硬线。" },
  "HSR Hair": { name: "星穹铁道·头发", description: "头发：粉色阴影和锐利高光。" },
  "HSR Cloth": { name: "星穹铁道·布料", description: "布料：淡紫色阴影，本套中对比最强。" },
  "HSR Metal": { name: "星穹铁道·金属", description: "冷色金属：硬边、强高光和明亮的边缘光。" },
  "HSR Eye": { name: "星穹铁道·眼睛", description: "几乎不受阴影影响的眼睛，在脸部阴影中依然明亮。" },
  // Stage looks.
  Lit: { name: "基础光照", description: "游戏的基础场景材质。图像 0：法线贴图；图像 1：属性贴图（金属度、粗糙度、遮蔽、发光）。" },
  Wood: { name: "木材", description: "木材：家具、地板和门。" },
  Tile: { name: "瓷砖", description: "瓷砖、砖块和装饰线条。" },
  Stone: { name: "石材", description: "石材、混凝土、岩石和土壤。" },
  Plaster: { name: "灰泥", description: "墙面、柱子和屋顶。" },
  Metal: { name: "金属", description: "全金属表面，质感来自反射。" },
  Lacquer: { name: "漆面", description: "有光泽的清漆、漆面和塑料。" },
  Fabric: { name: "织物", description: "布料、沙发和地毯，也适用于皮革、橡胶和纸。" },
  Neon: { name: "霓虹", description: "发光的招牌、灯泡和灯罩。若有属性贴图，其 alpha 为发光遮罩。" },
  "Stage Surface": { name: "舞台表面", description: "转换后场景的原有表面，每个材质沿用转换时的设置。" },
  Glass: { name: "玻璃", description: "窗玻璃：透明但保留反射。" },
  "Glass Shell": { name: "玻璃外壳", description: "反射场景的透明玻璃外壳，边缘更不透明。" },
  "Bottle Glass": { name: "瓶身玻璃", description: "瓶子和酒瓶：深色玻璃，越靠边缘越亮。" },
  Water: { name: "水面", description: "开阔水面：流动的波纹、反射和高光闪烁。图像 0：波纹贴图。" },
  Foliage: { name: "植被", description: "树叶、草和灌木，背光透亮，边缘清晰。" },
  Terrain: { name: "地形", description: "由两层贴图混合的地面。材质贴图为混合遮罩；图像 0、1 为两层颜色，图像 2、3 为两层法线。" },
}

const EFFECTS: Record<string, Zh> = {
  Rain: { name: "雨", description: "穿过场景的雨，会出现在角色前后。" },
  "REZE DESIGN": { name: "REZE DESIGN", description: "闪烁的 REZE DESIGN 霓虹招牌。" },
  Signature: { name: "签名", description: "REZE DESIGN 霓虹招牌，下方为黯灭小羊。" },
  "Shining Stars": { name: "闪耀星光", description: "随镜头移动的闪烁星空背景。" },
  "Floating Stars": { name: "漂浮星光", description: "围绕角色漂浮的发光光点。" },
  Fireworks: { name: "烟花", description: "循环绽放的烟花。移植自 Gatomoi。" },
  "Hand Ribbon": { name: "手部丝带", description: "跟随双手轨迹的霓虹丝带，伴有火花。" },
  "Divine Ribbon": { name: "神圣丝带", description: "跟随双手轨迹的金色光点。" },
  "Divine Teleportation": { name: "神圣传送", description: "角色化为金色光芒并缓缓升起消失。" },
  Footprints: { name: "足迹", description: "脚落地处留下发光足迹，伴有升起的余烬。" },
  "Stage Lights": { name: "舞台灯光", description: "三盏追随舞者的移动聚光灯。" },
  Snow: { name: "雪", description: "飘落的雪花。" },
  Waveform: { name: "音频波形", description: "随音乐跳动的音频频谱。参考 mafik 的 Shadertoy。" },
  "Vyke's Dragonbolt": { name: "维克的龙雷", description: "缠绕身体的红色火焰雷电。参考《艾尔登法环》。" },
  "Summoning Circle": { name: "召唤法阵", description: "地面上发光的紫色法阵，带一道光柱。参考 nayk 的作品。" },
  Teleportation: { name: "传送", description: "角色化为霓虹光点消失，片刻后重新出现。" },
  "Dry Ice": { name: "干冰", description: "铺满地面的雾气，会被脚步拨开。参考 xjorma 的 Shadertoy。" },
  "Note Fall": { name: "音符飘落", description: "歌曲的 MIDI 音符落在发光的琴键上。需要歌曲的 MIDI 文件。" },
  Lyrics: { name: "歌词", description: "读取 .lrc 文件的卡拉 OK 歌词，逐行显示。" },
  Subtitles: { name: "字幕", description: "读取双语 .lrc 文件的双行电影字幕。" },
  "Now Playing": { name: "正在播放", description: "角色身后滚动的歌词墙和正在播放卡片。" },
  "Sticker Outline": { name: "贴纸描边", description: "角色周围的白色贴纸描边。" },
  "Holy Light": { name: "圣光", description: "从角色轮廓向外散发的暖色光芒。" },
  "Bloody Ash": { name: "血色灰烬", description: "圣光的红色版本，从轮廓散发血红色光芒。" },
  "Ember Drift": { name: "余烬飘散", description: "在场景中升起并逐渐冷却的余烬。精灵图作者 Jan Mroz（CC BY 3.0）。" },
  "Sakura Drift": { name: "樱花飘落", description: "飘落在整个场景中的樱花花瓣，取自深空之眼 X343 神社。" },
  "Fuse Sparks": { name: "引线火花", description: "从骨骼喷出的细小火花，像点燃的引线。" },
  "Hand Sparks": { name: "手部火花", description: "双手腕迸出火花，手动得越快越亮。" },
  Water: { name: "水面", description: "圆形水池，角色接触处泛起涟漪。请放在效果列表第一位。" },
  "CRT Glitch": { name: "CRT 故障", description: "整个画面变成老式 CRT 电视，带扫描线、雪花和故障。" },
  "8-Bit": { name: "8 位像素", description: "整个画面变成 8 位像素画。" },
  "Holo Card": { name: "全息卡", description: "画面显示在旋转的全息卡牌上。" },
  "Stained Glass": { name: "彩色玻璃", description: "角色化作教堂彩色玻璃窗上的人物，在三扇窗之间跳跃。" },
  "Laser Eyes": { name: "激光眼", description: "从眼睛射出的激光，会击中并灼烧场景。" },
  "Laser Stare": { name: "激光凝视", description: "发出红光的眼睛，不发射激光。" },
  Mirror: { name: "镜子", description: "可放置在场景中的真实镜子。" },
  "Line Art": { name: "线稿", description: "整个画面重绘为墨线线稿。参考 Dirnot 和小林呓的作品。" },
  Manga: { name: "漫画", description: "整个画面变成印刷漫画页，带墨线和网点。" },
  Gojo: { name: "五条悟", description: "蓝色和红色光球环绕角色，合成紫色光球后爆发。" },
  "World Slash": { name: "世界斩", description: "一道斩击在角色腰部将画面一分为二。" },
  "Hand Threads": { name: "手部丝线", description: "从双手腕拖出的光丝。" },
  "Field of Flowers": { name: "花田", description: "变出花田的魔法。" },
  "Hand Blossoms": { name: "手中花", description: "从双手飘出的花朵。" },
  "Finger Shapes": { name: "手势", description: "在比心、取景框等手势周围出现霓虹轮廓。" },
  "Candle Flames (wick bones)": { name: "烛火（烛芯骨骼）", description: "在烛芯骨骼（名称以 flame 开头）上显示跳动的火焰。需要带烛芯骨骼的场景。" },
  "Galaxy Sky": { name: "银河天空", description: "带银河与闪烁星星的夜空。" },
  "Ember Motes": { name: "火星微粒", description: "悬浮在角色周围的暖色光点。取自深空之眼 X340。" },
  "Stop Motion": { name: "定格动画", description: "角色像定格动画一样按姿势跳帧，其余画面保持流畅。" },
  "Water Splash (splash bones)": { name: "水花（水花骨骼）", description: "在水花骨骼（名称以 splash 开头）上显示发光的水花。需要带水花骨骼的场景。" },
  "Water Spray (spray bones)": { name: "喷水（喷水骨骼）", description: "在喷水骨骼（名称以 spray 开头）上显示细小的水雾。需要带喷水骨骼的场景。" },
}

const GRADES: Record<string, Zh> = {
  Neutral: { name: "中性", description: "不做调色。" },
  Bloody: { name: "血色", description: "深黑与浓烈红色，适合恐怖氛围。" },
  Cyberpunk: { name: "赛博朋克", description: "青色阴影配洋红中间调，高饱和。" },
  Divine: { name: "神圣", description: "暖琥珀色阴影过渡到金色和白色高光。" },
  Moonlit: { name: "月光", description: "冷蓝色夜景色调，高光依然清晰。" },
  Sakura: { name: "樱色", description: "柔和的粉色调，高光保持干净。" },
}

// The built-ins' tags. Abbreviations (AG, NPR, PBR, MIDI…) stay as they are;
// a tag already in Chinese is its own label.
const TAGS: Record<string, string> = {
  "aether-gazer": "深空之眼", "wuthering-waves": "鸣潮", "zenless-zone-zero": "绝区零", "honkai-star-rail": "星穹铁道",
  ag: "AG", wuwa: "WuWa", zzz: "ZZZ", hsr: "HSR", npr: "NPR", pbr: "PBR", midi: "MIDI",
  anime: "二次元", soft: "柔和",
  body: "身体", face: "脸部", hair: "头发", eye: "眼睛", eyes: "眼睛", metal: "金属",
  cloth_smooth: "光滑布料", cloth_rough: "粗糙布料", stockings: "丝袜",
  stage: "场景", maps: "贴图", wood: "木材", tile: "瓷砖", brick: "砖", stone: "石材", concrete: "混凝土",
  plaster: "灰泥", wall: "墙面", lacquer: "漆面", plastic: "塑料", fabric: "织物", emission: "发光",
  glass: "玻璃", church: "教堂", bottle: "瓶子", water: "水", plant: "植物", terrain: "地形",
  nature: "自然", rain: "雨", mood: "氛围", overlay: "叠加", abstract: "抽象", neon: "霓虹", text: "文字",
  sky: "天空", night: "夜晚", calm: "宁静", particles: "粒子", glow: "发光", scene: "场景", magic: "魔法",
  fireworks: "烟花", festival: "节日", character: "角色", motion: "动作", reactive: "互动", gold: "金色",
  holy: "神圣", teleport: "传送", ground: "地面", light: "光", weather: "天气", winter: "冬季", audio: "音频",
  music: "音乐", background: "背景", fire: "火", lightning: "闪电", atmosphere: "大气", fog: "雾", sim: "模拟",
  outline: "描边", style: "风格", dark: "暗黑", blood: "血", embers: "余烬", sakura: "樱花", petals: "花瓣",
  spring: "春天", sparks: "火花", subtle: "细微", pool: "水池", retro: "复古", noise: "噪点", screen: "全屏",
  pixel: "像素", "8bit": "8 位", sprite: "精灵图", laser: "激光", superhero: "超级英雄", mirror: "镜子",
  reflection: "反射", lineart: "线稿", toon: "卡通", manga: "漫画", glitch: "故障", transition: "转场",
  trail: "拖尾", grass: "草", hand: "手", flowers: "花", gesture: "手势", dance: "舞蹈", stars: "星星",
  "stop-motion": "定格动画", neutral: "中性", clean: "干净", red: "红色", crimson: "深红", horror: "恐怖",
  saturated: "高饱和", warm: "暖色", divine: "神圣", cool: "冷色", blue: "蓝色", cyan: "青色", pink: "粉色",
  romantic: "浪漫",
}

// A character's default groups (scene-host CHARACTER_GROUPS and the engine's
// auto-groups), by their stored English label.
const GROUP_LABELS: Record<string, string> = {
  Body: "身体", Face: "脸部", Hair: "头发", Eye: "眼睛",
  "Smooth Cloth": "光滑布料", "Rough Cloth": "粗糙布料", Stockings: "丝袜", Metal: "金属",
}

export type BuiltinKind = "graph" | "effect" | "grade"
const TABLES: Record<BuiltinKind, Record<string, Zh>> = { graph: GRAPHS, effect: EFFECTS, grade: GRADES }

/** A shipped item, as `{ name, owner }` — anything not built-in is the author's
 *  own words and is never translated. */
type Item = { name: string; owner?: string }
const builtin = (item: Item) => item.owner === undefined || item.owner === "builtin"

/** The name to show for an item: a built-in's in Chinese, else the stored name. */
export function builtinName(kind: BuiltinKind, item: Item, locale: Locale): string {
  return (locale === "zh" && builtin(item) && TABLES[kind][item.name]?.name) || item.name
}

/** The description to show: a built-in's in Chinese, else the stored one. */
export function builtinDescription(kind: BuiltinKind, item: Item & { description?: string }, locale: Locale): string {
  return (locale === "zh" && builtin(item) && TABLES[kind][item.name]?.description) || item.description || ""
}

/** A tag's label: a built-in tag in Chinese; any other tag as written. */
export function tagLabel(tag: string, locale: Locale): string {
  return (locale === "zh" && TAGS[tag]) || tag
}

/** A group's label: a default group's in Chinese until the user renames it. */
export function localGroupLabel(label: string, locale: Locale): string {
  return (locale === "zh" && GROUP_LABELS[label]) || label
}

/** Every Chinese name and tag of a built-in, for search: either language finds it. */
export function builtinSearchText(kind: BuiltinKind, item: Item & { tags?: string[] }): string {
  if (!builtin(item)) return ""
  const zh = TABLES[kind][item.name]
  return [zh?.name, zh?.description, ...(item.tags ?? []).map((t) => TAGS[t])].filter(Boolean).join(" ")
}
