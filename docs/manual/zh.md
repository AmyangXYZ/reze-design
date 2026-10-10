# Reze Design 使用手册

[English](https://github.com/AmyangXYZ/reze-design/blob/main/docs/manual/en.md) · **简体中文**

Reze Design 在浏览器中完成 MMD 设计、渲染和分享，基于自研的 WebGPU 引擎
[reze-engine](https://github.com/AmyangXYZ/reze-engine)。它读取 MMD 社区自 2008
年以来制作的模型和动作，输出为视频文件，或一个任何人都能打开、旋转视角观看的实时页面。

**第 1 节**按面板介绍编辑器。**第 2 节**是调色、WGSL 场景特效和材质节点图的创作参考。

---

## 目录

- [0. 关于 MMD](#0-关于-mmd)
- [1. 做一个场景](#1-做一个场景)
  - [1.1 开始](#11-开始)
  - [1.2 角色 动作与音乐](#12-角色-动作与音乐)
  - [1.3 舞台](#13-舞台)
  - [1.4 背景与天空](#14-背景与天空)
  - [1.5 灯光](#15-灯光)
  - [1.6 相机](#16-相机)
  - [1.7 风格](#17-风格)
  - [1.8 特效](#18-特效)
  - [1.9 物体](#19-物体)
  - [1.10 物理](#110-物理)
  - [1.11 时间轴](#111-时间轴)
  - [1.12 歌词 口型与 MIDI](#112-歌词-口型与-midi)
  - [1.13 AI 美术指导](#113-ai-美术指导)
  - [1.14 导出](#114-导出)
  - [1.15 发布与素材库](#115-发布与素材库)
  - [1.16 常见问题](#116-常见问题)
- [2. 创作参考](#2-创作参考)
  - [2.1 渲染管线](#21-渲染管线)
  - [2.2 调色](#22-调色)
  - [2.3 用 WGSL 写场景特效](#23-用-wgsl-写场景特效)
  - [2.4 材质节点图](#24-材质节点图)
  - [2.5 草稿 发布与可见性](#25-草稿-发布与可见性)
- [附录 A 控件速查](#附录-a-控件速查)
- [附录 B 去哪里找模型 动作和音乐](#附录-b-去哪里找模型-动作和音乐)
- [附录 C 术语表](#附录-c-术语表)
- [附录 D 着色节点速查](#附录-d-着色节点速查)

---

# 0. 关于 MMD

MikuMikuDance（**MMD**）是樋口优于 2008 年发布的免费 3D 动画软件。它的生态由可互换的部件
组成：一个作者的模型（`.pmx`）、另一个作者的舞蹈（`.vmd`）、第三个作者的镜头，因为大家
遵循同一套骨骼命名而能组合在一起。2011 年的动作至今仍能驱动新做的模型。

原版 MMD 是 32 位 Windows DirectX 9 程序，2010 年代后期停止开发。Reze Design 在浏览器
标签页里运行同样的文件，并提供现代渲染、时间轴和发布为永久链接。它属于一组工具：
reze-engine（渲染与物理）、[Reze Studio](https://github.com/AmyangXYZ/reze-studio)（动画编辑）、
[MiKaPo](https://github.com/AmyangXYZ/MiKaPo)（动作捕捉）和
[reze-rig](https://github.com/AmyangXYZ/reze-rig)（FBX 转 VMD）。
[babylon-mmd](https://github.com/noname0310/babylon-mmd) 是网页上另一个成熟的 MMD 运行时，
基于 Babylon.js。

---

# 1. 做一个场景

## 1.1 开始

需要支持 WebGPU 的浏览器：Chrome 或 Edge 113+，或 Safari 26+。

所有内容都会随时保存在浏览器的 localStorage 和 IndexedDB 中，包括设置、上传的文件和草稿。
关闭标签页再回来，场景仍然在原处。发布之前不会上传任何内容。

左侧面板从上到下是：**角色**、**片段**、**音乐**，然后是场景各行 **相机**、**环境**、
**灯光**、**特效**、**后期**、**物理**、**物体**。时间轴在视图下方。**⌘K**（Ctrl+K）
打开命令面板，可以按名称找到所有操作和设置。

左上角的标签栏包含 Logo、版本号和 GitHub 链接。Logo 菜单中有 **新建场景**、**导出场景**
（一个包含场景和全部素材的 `.zip`）、**导入场景** 和 **恢复默认场景**。

**⌘Z / ⇧⌘Z**（Ctrl+Z / Ctrl+Shift+Z）撤销和重做场景配置的修改：设置、相机、特效、灯、
样式组、隐藏的材质和显隐。拖动一次滑条算一步。打开时间轴、节点图或 WGSL 编辑器时，⌘Z 在该
编辑器内撤销。

所有颜色控件都打开同一个颜色对话框，有两个标签页：**色板**，以及 **取色器**：饱和度与明度
区域、滑条、**从屏幕取色**、明暗色阶、配色和最近使用的颜色。

### 手机和平板

在手机宽度的屏幕上（窄于 640 px），顶栏包含品牌标签栏、**搜索…** 和 **分享**。面板栈、侧边
面板和素材库在顶栏下方全宽打开，一次只显示一个：打开一个会关闭另一个，关闭面板后面板栈
自动回来。导出时，镜头画面显示在导出面板下方的空间里。

在触屏设备（手机或平板）上：

- 每行的操作按钮始终显示，并放大到适合手指点按的尺寸；面板栈默认收起。
- 模型和舞台以文件夹的 `.zip` 上传。
- 外观编辑器（节点图、WGSL、调色）和时间轴只在桌面端提供。在触屏上可以通过快捷列表、
  素材库和特效参数来选择、应用、替换和调整外观。
- 素材库每行显示三张卡片；点开卡片查看详情，**返回** 回到列表。

## 1.2 角色 动作与音乐

| 位置 | 支持 |
| --- | --- |
| 模型（**角色 → 添加模型**） | 包含 `.pmx` 的文件夹（触屏设备上为该文件夹的 `.zip`），其中的 zip 会自动解压。一个场景可以有多个模型 |
| 动作、表情（**片段**，每个模型各一份） | `.vmd`。表情会替换动作自带的表情轨道 |
| 相机（**片段**） | `.vmd` 镜头动作，作用于整个场景 |
| 音乐 | mp3、m4a、aac、wav、ogg、opus、flac |
| MIDI、歌词（**音乐** 菜单） | `.mid`、`.lrc` |

**请保持模型文件夹完整。** PMX 按相对路径查找贴图，单独一个 `.pmx` 会显示为白色或灰色。
`.pmd` 需要先在 PMX Editor 中转换为 PMX。

动作针对标准骨骼，可以驱动任何模型。体型差别较大时脚会滑动，换一个与动作原模型体型接近的
模型即可。头发和裙子是物理模拟的，跳转后需要片刻稳定；导出前会先预热，所以视频里不会出现
这段过程。

每个模型的齿轮中有 **变换**（缩放、位置和旋转，以及 **重置**）和 **阴影**：关闭后该模型
不再投下太阳的阴影。

**脚步声**（**音乐 → +**）在每次脚落地时播放一声脚步，由角色的实际姿势检测，音量随落地的
力度变化。该行的齿轮选择音色：**高跟鞋**、**靴子**，或用 **上传音效…** 使用场景自己的声音
（一个短促的声音，不超过 1 MB 和 2 秒）。脚步声会混入导出的视频，也会在发布的场景中播放。

## 1.3 舞台

**环境 → 舞台** 为场景加载一个舞台，有两种方式：

- **PMX 文件夹**（触屏设备上为 **PMX 压缩包**）：传统 MMD 舞台。`.x` 配件上传时会转换为 PMX，ray-mmd 的 `.fx`/`.emd`
  材质文件会应用到对应材质，PMX 旁边的 `<名称>.lights.json` 会带入灯光、太阳、环境光、
  调色和特效，`<名称>.hdr` 会作为世界光。
- **GLB 文件**：从 Blender 导出的舞台，包含模型、贴图、灯光、太阳和世界环境，并按 Blender
  中的方式照明：平方反比衰减的灯、同样的太阳、能反射灯光高光的光滑地面。游戏场景也走这条
  路线：`tools/stages` 把 Unity 导出读入 Blender，再由 Blender 导出 `.glb`。

舞台材质会按材质名（日文、中文或英文）自动分组为木材、石材、玻璃、水面、植物、金属等
外观。GLB 自带 *Stage PBR* 外观。可以像角色一样在材质面板中重新分组。

加载舞台后内置地面会关闭，由舞台自带地面代替。如果舞台文件夹中有 2:1 的天空全景图，会询问
使用哪一张；名称以 `flame` 开头的烛芯骨骼会自动添加 *Candle Flames* 特效。舞台可以调整缩放
和位置。

## 1.4 背景与天空

**环境** 有三个标签页。

- **地面**：颜色、不透明度、大小、高度、渐隐和网格线。不透明度为 0 时仍然接收阴影，可以
  作为照片背景的阴影捕捉面。
- **背景**：背景颜色，以及 **媒体**（场景后面的图片、GIF 或视频）或 **天空盒**（相机
  可以环视的 360° 全景）二选一。**世界** 接受 `.hdr`，它照亮场景并出现在光滑表面的反射中，
  与背景显示的内容无关。

媒体和天空盒共用一个位置，设置其中一个会清空另一个。

## 1.5 灯光

**灯光** 有三个标签页。

- **环境光**：场景整体所处的环境光，以及只照亮角色的 **角色补光**。
- **太阳**：主光和它投下的阴影，可调颜色、强度、方位角和仰角。太阳低时阴影长、轮廓分离
  明显。
- **灯**：自己放置的点光源，在视图中显示为标记。舞台灯光配置也可以带入聚光灯。

冷色环境光配暖色太阳（或反过来）通常就能得到好的效果。

## 1.6 相机

左键拖动旋转，右键拖动平移，滚轮缩放。**相机 → 镜头** 设置视野、距离、角度和目标点；
**对焦** 添加景深。

**跟随** 让相机绑定一根骨骼（默认是中心骨），移动的舞蹈会保持在画面内，此时目标点变为
偏移量。加载镜头动作后由它控制视角，视场角、距离和 **偏移 X/Y/Z** 在其上叠加调整，角度
保持镜头动作自身的值；播放栏可以在镜头动作和自由旋转之间切换，不会中断播放。
播放栏中的 **眼神看镜头** 让角色的视线朝向镜头。

## 1.7 风格

**渲染风格。** 按 ⌘K 输入风格名称：*Aether Gazer*（深空之眼）、*Wuthering Waves*（鸣潮）、
*Zenless Zone Zero*（绝区零）、*Honkai: Star Rail*（崩坏：星穹铁道）。切换风格会按角色逐一
替换每个分组的外观，并带入该风格所需的视图变换、曝光和环境光（绝区零还会带入太阳和泛光）。
背景、描边、调色和地面保持不变。选择会被记住，之后加载的模型也使用同一风格。

**样式组。** 模型加载时，材质会自动分组，每组使用一个着色节点图。所有模型都由同一个分类器
分组，与从哪个位置上传无关。有头部骨骼的模型算作人物：先按部位分组（眼睛、脸、头发、皮肤、
短袜、丝袜、金属、布料），使用当前渲染风格的节点图，再按材质类型分组（玻璃、木材…）。其他
模型先按材质类型分组，之后只分出布料、金属、短袜和丝袜。没有被认领的材质保持未分组，使用
中性的默认节点图。在 **材质** 面板中可以在组之间移动材质、隐藏材质、新建组或更换节点图。
标记为 **已编辑** 的组保存着自己的节点图副本；重新选择外观才会使用更新后的内置版本。

**快捷列表。** 点击外观的当前值（调色、组的节点图、**添加特效**）会打开快捷列表：顶部是搜索
框，先列出本设备上的草稿，再列出内置和已发布的外观。选择后列表保持打开，可以连续试几个。
每个素材库只有一个入口，即白色按钮：调色下方的 **调色库**、特效下方的 **特效库**、材质面板中的
**着色器图库**。

**后期** 有四个标签页：

- **调色**：*中性*、*血色*、*赛博朋克*、*神圣*、*月光*、*樱色*、*高饱和*，或调色库中的
  任意预设，每个预设的强度会分别记住。
- **色调**：Standard、Filmic 或 AgX，以及曝光。
- **泛光**：强度、阈值和半径。强度为 0 时跳过这一步。
- **描边**：MMD 的轮廓线，可开关，可调 **粗细**（各模型自身描边的倍数，最大 5）和
  **统一颜色**（所有描边使用同一种颜色）。

制作自己的调色或节点图见 [第 2 节](#2-创作参考)。

## 1.8 特效

**特效** 用于添加场景特效：雨、花瓣、烟花、花田、彩色玻璃窗、手部光带、舞台灯、屏幕歌词、
胶片风格等。顶部的 **添加特效** 打开快捷列表，场景中已有的特效都会打勾，点击已打勾的特效即可
移除。每个已添加的特效占一行，多个特效可以同时运行，按列表顺序绘制。**特效库**
按钮在这一栏的最下方。

每一行有：

- **编辑**（笔）：在 WGSL 编辑器中打开，作为你自己的副本。
- **参数**（齿轮）：特效声明的可调参数，拖动时实时生效，可以 **重置**。
- **作用于**（齿轮，有多个模型时出现）：特效跟随哪些角色。只作用于一名舞者的手部光带
  只跟随她。
- **替换**（箭头）：同一个快捷列表，原位换成另一个特效。
- **移除**（×）。

点击特效名称可以调整它的 **影响**，即强度。

特效在什么时间播放，由时间轴的 **特效** 轨道决定（§1.11）。

## 1.9 物体

**物体** 有两个标签页。

- **平面**：以卡片形式放在场景中的图片、GIF 或视频，可调大小、位置和旋转。
- **道具**：麦克风、扇子、剑等角色拿着或穿戴的 PMX（也可以是 `.x` 或 `.glb`）。
  **绑定到** 把它挂到某个角色的骨骼上，相当于 MMD 的外部親；之后它的位置和旋转是相对该
  骨骼的偏移。道具保留自己的物理和描边。

在时间轴的 **物体** 轨道上，道具可以随时间换手：为它挂在哪根骨骼设置关键帧，或用
**抛掷** 把它扔到另一根骨骼或某个位置，方式有传递、抛出和高抛。

## 1.10 物理

**物理** 可以开关模拟，并设置重力、风，以及头发和衣服是否与地面碰撞。
**重置物理**（⌘K）会重新开始模拟。

## 1.11 时间轴

时间轴直接编辑正在播放的内容，所有修改都以 VMD 写回场景：自动保存，随场景发布，也可以
从对应行下载。

- **轨道**：动作、表情、相机、特效、显隐和物体。
- **摆姿势**：双击角色身上的骨骼，拖动操纵器，姿势会在播放头处记录为关键帧。
- **时间与缓动**：沿轨道拖动关键帧；曲线视图显示 VMD 自身的贝塞尔曲线，并提供预设
  （Linear、In、Out、InOut、Slow In、Slow Out、Slow IO、Over）。
- **简化**：用更少的关键帧拟合密集轨道（动捕或重定向得到的动作）。
- **特效轨道**：每个区块是特效播放的一段时间，特效的时钟从区块左边缘开始。区块可以拖动、
  裁剪、复制和粘贴。区块边缘可以平滑过渡（**边缘消散**）或分步过渡（**阶梯消散**）。
  删除最后一个区块会移除该特效。
- **显隐轨道**：让角色在不同时间上场或离场。

⌘Z / ⇧⌘Z 撤销和重做。←/→ 在关键帧间跳转；⌘C、⌘X、⌘V 复制、剪切和粘贴。

## 1.12 歌词 口型与 MIDI

音乐旁的 `.lrc` 有两个用途。

- **由歌词生成口型**（片段菜单）：按音节写出口型表情 VMD，对应 MMD 的五个元音口型，
  支持假名、韩文、汉字、罗马音、拼音和英文。双语 `.lrc` 只唱原文，不唱翻译。
- **Lyrics**、**Subtitles** 和 **Now Playing** 特效把歌词显示在画面上；*Subtitles* 会把双语
  歌词的原文和翻译叠成一条字幕。

`.mid` 为特效提供音符，*Note Fall* 把它画成钢琴卷帘。

## 1.13 AI 美术指导

**AI 美术指导** 和你一起制作场景。描述想要的氛围、光线或镜头，或拖入一张参考图；它会读取
场景、修改场景，并在回答前查看画面。它可以调整灯光、后期、环境和相机，构图取景，配合歌曲
安排特效和灯的时间，让角色上场或离场，为样式组指定并调整外观。它还能制作新的外观：调色、
调整过的节点图、WGSL 特效，每一个都会保存到你的草稿中，场景因此仍然可以发布。发布、分享和
导出始终由你自己点击。

点击右侧边缘的 **AI** 按钮，或在命令面板中选择 **AI 美术指导** 打开。它工作时画布始终可见。

- **对话** 以标签页排列，**+** 新建对话。请求会在自己的标签页中持续运行，你可以同时查看
  其他标签页，或关闭面板；同一时间只运行一个请求。对话保存在本浏览器中，刷新后仍在；关闭
  标签页会删除该对话。
- **参考图**：每次请求最多四张，可以用图片按钮添加、粘贴或拖入。只发送图片不写文字，就是
  让它参照图片的风格。
- 上一次回答下方的 **撤销** / **重做** 会撤回或恢复该次请求做的全部修改。⌘Z 也能撤销它，
  算作一步。
- **Token 数**：对话的总用量显示在输入框上方；悬停可查看输入、缓存和输出。
- **停止** 会结束请求，之前的修改会保留。

**模型与密钥**（面板标题栏的齿轮）用于选择模型。

- **添加服务**：Claude、OpenAI、Gemini、DeepSeek、Qwen、通义千问、Grok、OpenRouter，或
  **Custom**：任何兼容 OpenAI Chat Completions API 的服务器，填写它的地址即可，包括本机上的
  Ollama 或 LM Studio（需要允许本站访问：Ollama 设置 `OLLAMA_ORIGINS`，LM Studio 打开
  **Enable CORS**）。**获取密钥** 打开该服务的密钥页面。
- **添加模型** 列出该服务推荐的模型，输入文字可搜索全部模型。每个模型添加时都会先检验；
  标为 **仅文字** 的模型可以使用，但不能发送参考图。
- 密钥只保存在本浏览器中，使用它的每个请求都从你的浏览器直接发往该服务。
- **Premium**：Premium 方案的账户在菜单顶部会看到这一项，它使用 Reze Design 自己的密钥，
  无需任何设置。

## 1.14 导出

**渲染** 设置输出方式、画面比例（16:9、9:16、2.39:1、1:1、4:3）、画质（最高 4K）和可选的
时间范围。面板打开时，视图显示将要录制的画面范围。

| 输出 | 用途 |
| --- | --- |
| 场景 · MP4 | 成品视频，60 帧 |
| 绿幕 · MP4 | 纯 `#00FF00` 背景，用于抠像 |
| 透明 · PNG 序列 | 带透明通道的逐帧图片（Chrome，需要选择文件夹） |
| 透明 · WebM | 带透明通道的视频 |

**码率** 可选标准码率或其两倍，按所选尺寸以 Mbps 显示（4K 为 50 或 100）。**编码** 对 MP4
可选 H.264 或 HEVC。浏览器能以该尺寸编码 HEVC 时才提供 HEVC，并使用标准码率。

导出以 4× MSAA 离线逐帧渲染：慢的电脑输出同样的文件，只是耗时更长，音乐每次都落在同一帧。
在 Chromium 上，文件边编码边写入磁盘，长时间的 4K 导出不需要占用大量内存。
**AE 合成脚本** 生成一个 After Effects 脚本，在 AE 中还原相机用于合成。

**截取 PNG** 保存当前画面，用于制作封面。

**分享导出统计**（默认关闭）会上报成品视频的组成：分辨率、模型文件名、特效、节点图和调色，
不包含任何个人信息。汇总数据公开在 [reze.design/analysis](https://reze.design/analysis)，
[reze.design/privacy](https://reze.design/privacy) 列出了上报的全部内容。

## 1.15 发布与素材库

**账户。** 可以用 Google、GitHub 或邮箱验证码登录。同一个邮箱无论用哪种方式登录都是同一个
账户。首次登录时选择用户名，它会出现在所有链接中，只能设置一次。

**发布场景** 会上传模型、动作和音乐，以便在其他浏览器中播放。发布前请阅读每个模型的
利用規約（使用条款）：**再配布禁止（禁止二次分发）很常见**；发布场景算作分发，渲染视频不算。
发布时需要填写名称、标签、封面和 **借物表**（素材清单），列出所用的每个模型、动作、特效和
音乐及其作者：

```
Model: Tda式初音ミク・アペンド by Tda
Motion: … by …
Camera: … by …
Music: … by …
```

场景可以 **公开** 或 **私有**。链接格式为 `reze.design/<用户名>/<id>`，永久不变：修改场景名
或用户名不影响链接，重新发布（**更新**）会保留浏览量和点赞。场景用到的调色、特效和节点图
需要先发布，公开场景不能使用私有素材。

公开场景还可以设为 **仅展示**：其他人可以观看、旋转视角和点赞，场景页面上没有 **在编辑器中
打开**。画廊和场景页面会标出它，你自己的 **编辑** 仍然可以打开。更新场景时可以随时切换。

**素材库** 包含调色、节点图、特效和场景（内置、社区和你自己的），可按全部、本地、社区、
内置、我的和喜欢筛选。

**场景画廊** 和场景页面可以旋转视角、播放和点赞。**在编辑器中打开** 会把整个场景复制到你的
编辑器（名称后加 `- fork`），并带上借物表。每位作者都有主页 `reze.design/<用户名>`，列出其
场景、特效、节点图和调色。

## 1.16 常见问题

| 现象 | 原因 |
| --- | --- |
| 编辑器无法启动 | 浏览器不支持 WebGPU |
| 模型显示为白色、灰色或黑色 | 找不到贴图，请加载整个文件夹 |
| 模型无法加载 | 文件是 `.pmd`，请先转换为 PMX |
| 动作在播放但模型不动 | 动作加载到了其他模型上，或骨骼命名不标准 |
| 脚滑动或陷入地面 | 模型体型与动作原模型差别较大 |
| 相机无法旋转 | 镜头动作正在控制视角，请切换到自由旋转 |
| 无法发布 | 场景使用了未发布或私有的调色、特效或节点图，对话框会列出名称 |
| 发布失败 | 错误信息会指出阶段：打包（缺少素材）、上传（超过 2 GB 或网络问题）、发布（未登录） |

导出速度慢是正常的：每一帧都按完整质量渲染。可以先用 1080p 导出一小段检查，最后再用 4K 导出。

---

# 2. 创作参考

场景的外观可以在三个层面编程。**调色**（§2.2）调整整个画面的颜色。**场景特效**（§2.3）是
在角色周围、前方和之间绘制的 WGSL 程序。**材质节点图**（§2.4）定义每个表面如何受光。
每一节都给出完整的规则。

## 2.1 渲染管线

从后到前：

```
背景颜色 → 媒体 / 天空盒 → fn background (§2.3)
        ↓
场景：角色、舞台、道具，每个表面由其节点图着色 (§2.4)，
受太阳、环境光、灯和特效光源照明；粒子和光带在这里绘制
        ↓
泛光 → 视图变换 → 调色 (§2.2)
        ↓
fn foreground (§2.3)，带有场景深度
        ↓
滤镜 (§2.3, rzSceneFrame)，最后绘制，覆盖全部内容
```

调色作用于每个像素。节点图作用于一个样式组。特效在它定义的挂载点绘制。三者都保存在场景
文档中。

## 2.2 调色

调色使用 **ASC CDL** 变换，即每个色调范围的斜率、偏移和幂，是电影后期的标准做法。

在调色库中对预设选择 **编辑**，或在 **后期 → 调色** 中编辑当前调色。场景本身就是预览。

- **分离色调**（−1 到 +1）在冷暖轴上把阴影和高光推向相反方向。负值为青色阴影配橙色高光，
  正值相反。
- **三个色轮**：阴影、中间调、高光。角度是色相，离中心的距离是强度，旁边的滑条是亮度。
- **对比度**（0.5–1.6）以中灰为支点；**饱和度**（0–2）。

建议顺序：先调好灯光，设置分离色调，再用滑条压暗或提亮，逐个范围调整色相，最后降低饱和度。
经常与 *中性* 对比。调色可以在编辑器顶部导出和导入 JSON。

## 2.3 用 WGSL 写场景特效

一个场景特效就是一个 WGSL 文件。**它定义了哪些函数，决定了它是什么、画在哪里**，没有单独的
图层设置。

### 挂载点

| 定义 | 得到 |
| --- | --- |
| `fn background(ray, uv, time)` | 角色后方的一层 |
| `fn foreground(ray, uv, time, depth)` | 画面上方的一层，带有场景深度 |
| `fn particleInit` · `particleStep` · `particleShade` | GPU 粒子池，在场景中绘制 |
| `fn trailWidth` · `trailShade` | 沿骨骼运动轨迹的光带 |
| `fn lightEmit` | 照亮场景的点光源 |
| `fn gridStep` | 跨帧保留状态的模拟网格 |
| `#mirror` | 平面镜，不需要任何函数 |

同时定义 `background` 和 `foreground` 是一个特效（例如暴风雨：暗色天空加前方的雨）。
一个文件要么使用 **场** 挂载点（`background`/`foreground`），要么使用粒子和光带，不能混用；
光源和网格可以与任一种组合。

### 指令

文件顶部以 `#` 开头的行。它们是语法：引擎会解析，遇到不认识的指令会报告行号。`—`、`--`、
`//` 或 ` # ` 之后的内容是注释。

```wgsl
#anchor 頭                 a bone by name        -> rzAnchor(subject, 0)
#anchor 左手首 trail       ...and record its path -> rzTrail(subject, 1, i)
#anchor 右手首 trail along 0.9   the point 0.9 units down the bone (knuckles)
#points flame              every bone starting "flame" -> rzPoint(i)
#particles 4096            pool size (default 1024)
#blend additive            particles add light
#blend cutout              particles write depth, alpha as coverage (grass)
#blend over                ribbons lay over the scene instead of adding light
#bloom                     particles / ribbons reach bloom
#layer additive            the FIELD adds light instead of covering
#halfres                   field mounts at half resolution
#lights 4                  light slots, with fn lightEmit
#grid 768                  grid resolution, with fn gridStep
#param float speed 1.0 0 4 a dial: float name default [min max]
#param color tint #3b82f6  a colour dial, hex default
#param vec3 offset 0 1 0   a vector dial
#duration 3.0              one firing lasts 3 s — the effect is a HIT
#dissolve                  takes subject 0 apart and back
#ground #202020 grain 0.3  replaces the floor while installed
#mirror                    the effect is a mirror
```

- **`#layer additive`** 适合光而不是实体。默认是 alpha 覆盖，两道光交叉时会互相遮挡。
- **`#anchor`** 的槽位按声明顺序编号。骨骼名称不同的模型上 `.valid` 为 false，请检查。`along d`
  把锚点沿骨骼自身的方向移动 `d` 个模型单位，一个数字就能把两只手的锚点都放到指根。
- **`#halfres`** 适合柔和的效果。alpha 有硬边时不要用，例如与 `depth` 比较的前景特效在每条
  轮廓上都有硬边。
- **`#duration`** 让特效成为有起止的一次性效果；不声明则是持续性的（雨、星空、雾）。
- **`#param`** 的值通过 `params.<名称>` 读取。界面据此生成控件，面板和着色器读取的值始终一致。
- **`#dissolve`** 的时间来自 `const DISSOLVE_APART/GONE/BACK/WHOLE`，或同名的 `#param`。
- **`#mirror`** 的镜面由名为 `POS_X/Y/Z`、`ROT_X/Y/Z`、`WIDTH`、`HEIGHT`、`TINT`、`BLUR`、
  `FRAME`、`FRAME_COLOR` 的参数确定。

### 场挂载点的规则

```wgsl
fn background(ray: vec3f, uv: vec2f, time: f32) -> vec4f
fn foreground(ray: vec3f, uv: vec2f, time: f32, depth: f32) -> vec4f
```

| 参数 | 含义 |
| --- | --- |
| `ray` | 世界空间视线方向，随相机转动，由它计算的内容固定在世界中 |
| `uv` | 屏幕位置 0–1，原点在左下角 |
| `time` | 特效时钟的秒数（从片段开始计） |
| `depth` | 仅 `foreground`：到场景在此处所画内容的距离，没有内容时为远平面 |

返回 **sRGB 颜色和直通 alpha**：0 保留后方内容不变，1 完全替换。

**`ray` 还是 `uv`** 决定了相机移动时的表现。用 `uv` 时特效固定在画面上，适合天气、暗角和颗粒。
用 `ray` 时特效属于世界，用 `uv` 做的星空会在相机旋转时滑动。角色身上 *向上* 的效果（火焰、
光柱）应从角色投影世界的向上方向，屏幕的向上会随相机倾斜。

**`depth`** 有三种用法。与它比较（需要羽化，否则轮廓会出现锯齿），雨滴就能从肩膀后面经过。
直接读取：`1 - exp(-depth * density)` 就是雾。用 `rzWorldPos(ray, depth)` 转为世界坐标，图案
就不会随相机移动。对于角色 *身处其中* 的效果，在 `rzCameraPos()` 与该点之间步进采样。

### 读取场景

| 函数 | 返回 |
| --- | --- |
| `rzResolution()` · `rzViewportHeight()` | 画布像素尺寸 |
| `rzTime()` · `rzDt()` | 时钟和帧间隔 |
| `rzCameraPos()` · `rzCameraRight()` · `rzCameraUp()` · `rzCameraForward()` | 相机 |
| `rzSubjectCount()` · `rzSubject(i)` | 特效作用的角色：`{ root, center, bounds, dissolve, gaze, looking, valid }` |
| `rzSubjectHip(i)` · `rzSubjectId(i)` | 髋部位置；每个模型固定的 id |
| `rzAnchor(s, slot)` | 声明的骨骼：`{ pos, vel, fwd, valid }` |
| `rzTrailCount(s, slot)` · `rzTrail(s, slot, i)` | 骨骼最近的轨迹：`xyz` 位置，`w` 距今秒数 |
| `rzTrailAt` · `rzTangentAt` · `rzSpline` · `rzSplineTangent(s)` · `rzKnot` · `rzTurnRadius` | 平滑采样轨迹 |
| `rzPointCount()` · `rzPoint(i)` | `#points` 匹配到的骨骼：`{ pos, tip }` |
| `rzWorldPos(ray, depth)` | 当前像素深度对应的世界坐标 |
| `rzProject(p)` | 世界点在屏幕上的位置：`xy` 为 uv，`z` 为距离，可与 `depth` 比较，在相机后方为负 |
| `rzCastDistance(uv)` | 到角色轮廓的屏幕像素距离：角色上为 0，外部为正 |
| `rzObjectAt(uv)` · `rzMaterialAt(uv)` | 此像素由哪个物体和材质绘制（场挂载点） |
| `rzShadow(p)` · `rzWorldAmbient(n)` · `rzLightsDiffuse(p, n)` | 某点的太阳阴影、环境光和灯光 |
| `rzLightCount()` · `rzLightPos/Color/Radius/Aim/Cone(i)` | 场景中的灯 |
| `rzHash11/21/31/13` · `rzValueNoise(p)` · `rzCurlNoise(p)` · `rzFalloff(d, r)` | 哈希、噪声，以及在 `r` 处恰好为 0 的衰减 |

**特效作用于哪些角色由场景决定**（§1.8，*作用于*）。`rzSubject(0)` 是其中第一个，所以写好
循环，让场景来指定对象。循环次数请用计数函数，不要写死常数。

`rzSubject().bounds` 是一个偏大的剔除球；确定大小请用髋部高度（`center.y - root.y`）。
`rzProject` 让绑定在世界中的绘制很便宜：把点投影一次后在 2D 中测量，遮挡只需与 `depth` 比较一次。

旧的 `bg*` 函数名（`bgWorldPos`、`bgResolution` 等）仍然可用。

### 读取画面：滤镜

| 函数 | 返回 |
| --- | --- |
| `rzScene(uv)` · `rzSceneAlpha(uv)` | 线性 HDR 的场景层，以及它对该像素的覆盖度 |
| `rzSceneDisplay(uv)` | 显示空间的场景，已应用曝光、视图变换和调色 |
| `rzSceneDepth(uv)` · `rzSceneHit(uv)` · `rzSceneFar()` | 任意像素的深度、是否有内容、远平面 |
| `rzBackground()` | 背景颜色 |
| `rzSceneFrame(uv)` | 完成的画面，包括其他特效 |

这些函数可以在任意 uv 读取画面，用于折射、热浪、CRT 弯曲、像素化角色等。**调用
`rzSceneFrame` 会让特效成为滤镜**：它在所有其他特效之后运行，并把它们包含在内（*Holo Card*、
*World Slash*）。

### 音乐 乐谱与歌词

整首歌会预先分析一次，因此导出与编辑器完全一致，特效还能读取未来的数据。

| 函数 | 返回 |
| --- | --- |
| `rzAudioLevel()` · `rzAudioOnset()` | 响度 0–1；低音上升的强度（鼓点） |
| `rzAudioBandCount()` · `rzAudioBand(i)` | 对数分布的频谱，0–1 |
| `rzAudioLevelAt(o)` · `rzAudioOnsetAt(o)` · `rzAudioBandAt(i, o)` | 同上，偏移 `o` 秒，负数为过去，正数为未来 |
| `rzAudioTime()` · `rzAudioPlaying()` · `rzAudioFrames()` | 歌曲位置、是否播放、分析长度 |
| `rzMidiTime()` · `rzMidiDuration()` · `rzMidiPlaying()` | 乐谱时钟 |
| `rzNoteCount()` · `rzNoteStart(i)` · `rzNoteLength(i)` | 音符，按开始时间排序，可二分查找当前范围 |
| `rzNotePitch(i)` · `rzNoteVelocity(i)` · `rzNoteAge(i)` · `rzNoteHeld(i)` | 音高、力度 0–1、已持续时间、是否正在发声 |
| `rzPitchLow()` · `rzPitchHigh()` · `rzPitchX(p)` · `rzKeyEnergy(p)` | 文件使用的音域、音高在音域中的 0–1 位置、衰减的琴键强度 |
| `rzLyricCount()` · `rzLyricIndex(t)` | 行数；时间 `t` 处的当前行（行间为 `-1`） |
| `rzLyricStart(i)` · `rzLyricEnd(i)` · `rzLyricProgress(i, t)` | 一行的时间范围和卡拉 OK 进度 |
| `rzLyricText(i, uv)` · `rzLyricHasText(i)` · `rzLyricChars(i)` | 该行文字框内的字形覆盖度 |
| `rzLyricAspect(i)` · `rzLyricPixels(i)` · `rzLyricRect(i)` · `rzLyricWidest()` | 形状、图集尺寸和位置；最宽一行的宽高比 |

文字由应用栅格化；请跨像素采样覆盖度（配合 `rzLyricPixels`），不要单点采样，否则小字会闪烁。
场景没有音乐、`.mid` 或 `.lrc` 时，这些函数返回 0、`-1` 或 `false`。

### 光源

```wgsl
#lights 4
fn lightEmit(i: u32, time: f32) -> RzLight {
  var l: RzLight;
  l.pos = vec3f(0.0, 12.0, 0.0);  // world space
  l.color = vec3f(1.0, 0.85, 0.6);
  l.intensity = 0.0;               // 0 retires the slot
  l.radius = 8.0;                  // falloff distance
  return l;
}
```

每帧对每个槽位调用一次，请设置所有字段。特效光源是点光源，最多 128 个。这是唯一会改变 *角色*
外观的挂载点；泛光只是在着色之后扩散亮像素，不会照亮任何东西。

### 粒子

```wgsl
#particles 4096
fn particleInit(i: u32, seed: f32) -> Particle
fn particleStep(p: Particle, dt: f32) -> Particle
fn particleShade(p: Particle, uv: vec2f) -> vec4f      // billboard, uv 0–1
fn particleCover(p: Particle, uv: vec2f) -> f32        // optional, with #blend cutout
fn particleCount() -> u32                              // optional, live count
```

`Particle` 包含 `pos`、`vel`、`age`、`life`、`size`、`rot`、`seed`、`stretch`。`life = 0` 会回收
一个粒子，它通过 `particleInit` 重新生成。`stretch` 是沿运动方向的长宽比，雨滴为 10–20。
粒子在场景中绘制，所以会被角色自然遮挡。粒子池最多 2,097,152 个；`particleCount()` 可以在需要
较少时只运行一部分（*Field of Flowers*）。

### 光带

```wgsl
#anchor 右手首 trail
fn trailWidth(u: f32, age: f32) -> f32                                   // 半宽，世界单位
fn trailShade(u: f32, v: f32, age: f32, weight: f32, slot: i32) -> vec4f
```

`u` 沿光带方向，`v` 横跨光带（−1..1），`age` 是这一段在几秒前留下的。轨迹按场景时钟采样，因此
在编辑器和每次导出中都相同，并被平滑为样条曲线。光带在场景中绘制并叠加光；`#blend over` 改为按
alpha 覆盖在后面的画面上，深色的光带会压暗背景（深蓝的烟雾尾巴若叠加就看不见了）。
共用一条轨迹的多股光带可以画成一条，宽度取最宽的一股，每股按自己的 `v` 在其中绘制。

### 模拟网格

```wgsl
#grid 768
fn gridStep(uv: vec2f, prev: vec4f, dt: f32) -> vec4f {
  if (rzGridFrame() == 0) { return vec4f(0.0); }   // seed on frame 0
  let left = rzGridPrev(uv - vec2f(rzGridTexel(), 0.0));
  return prev;                                      // four floats, yours
}
```

| 函数 | 返回 |
| --- | --- |
| `rzGrid(uv)` · `rzGridPrev(uv)` | 本帧和上一帧的格子 |
| `rzGridTexel()` · `rzGridSize()` · `rzGridFrame()` | uv 中一个像素的大小、分辨率、应用以来的帧数 |

默认 256，最大 1024。这是唯一有状态的挂载点：从场景中间开始的导出会从空网格开始。*Dry Ice* 和
*Water* 是基于它的流体效果。

### 性能

特效每帧都在完整的角色渲染之后运行，分辨率最高 4K。

- **先剔除，分层剔除**：先排除远离角色的像素，再按肢体排除，最后才处理单个图案。
- **推导剔除半径**：由实际能到达的范围（偏移加扩散）计算；猜测的半径会把特效切出一条直线。
- **每个光晕都要有边界**：用 `smoothstep(REACH, 0.0, d)` 或 `rzFalloff`，不要用裸的 `1/r`，
  它没有可以剔除的边缘，切断后会在泛光中形成光环。
- **体积要步进采样**，不要只在深度缓冲上着色：在地面深度处取样的密度无法包裹站在其中的人。
- **循环保持固定且短小**；`fwidth` 只在一致的控制流中使用。
- **所有运动由 `time` 驱动**，这样导出才可复现。
- **亮度就是不透明度**：宽度和亮度请分成两个参数。

### 编辑流程

**特效库 → 新建特效** 从带注释的模板开始；对任意特效 **编辑着色器** 会创建副本。
**⌘Enter 编译并应用。** 编译失败时，之前的着色器保持生效，诊断信息会指出行号和列号。

### 内置特效示例

每个内置特效都在注释中说明了它要避免的问题。

| 特效 | 演示 |
| --- | --- |
| *Rain* · *Snow* · *Sakura Drift* | 粒子池，与角色做深度测试 |
| *Floating Stars* · *Ember Drift* · *Ember Motes* | 带泛光和光源的叠加粒子 |
| *Hand Ribbon* · *Hand Threads* | 沿骨骼轨迹的光带 |
| *Hand Sparks* · *Fuse Sparks* · *Hand Blossoms* · *Divine Ribbon* | 从锚点发射的粒子 |
| *Teleportation* · *Divine Teleportation* | `#dissolve` 配合 `#duration`：身体分解再重组 |
| *Candle Flames* | `#points`：每根匹配的骨骼一团火焰 |
| *Field of Flowers* | `#blend cutout`、`particleCover`、`particleCount`、网格、`rzShadow` |
| *Dry Ice* · *Water* | 持久网格：地面上的流体、有波纹的水池 |
| *Footprints* | 在世界空间中读取轨迹 |
| *Vyke's Dragonbolt* | 带真实深度的屏幕空间电弧 |
| *Summoning Circle* | 在声明骨骼下方做射线与平面求交 |
| *Stage Lights* | 在自身圆柱体内步进的体积光束 |
| *Gojo* · *World Slash* | 带 `#duration` 的一次性效果；画面滤镜 |
| *Laser Eyes* · *Laser Stare* | `rzSubject().gaze`，照亮面部的光源 |
| *Sticker Outline* · *Holy Light* · *Bloody Ash* · *Red Rain* | `rzCastDistance`：沿轮廓的描边和边缘光 |
| *Holo Card* | `rzSceneFrame`：包含所有其他特效的滤镜 |
| *Stained Glass* | `rzSceneFrame` 配合 `rzCastDistance`：把角色重绘为铅条彩色玻璃 |
| *Mosaic* | 用 `rzProject` 投影 `#anchor` 锚点；只作用于画面一部分的滤镜 |
| *CRT Glitch* · *Line Art* · *Manga* · *8-Bit* | 重新读取画面；*8-Bit* 使用 `rzObjectAt` |
| *Mirror* | `#mirror` |
| *Waveform* | 音频接口 |
| *Note Fall* | 以几何形式表现 MIDI 接口 |
| *Lyrics* · *Subtitles* · *Now Playing* | 歌词接口 |
| *Shining Stars* · *Galaxy Sky* | 由 `ray` 构建的世界空间天空 |
| *Fireworks* | 世界空间中的抛物运动与光源 |
| *REZE DESIGN* · *Signature* | 有向距离场文字 |
| *Finger Shapes* | 双手的外轮廓，以及手指围出的形状 |

## 2.4 材质节点图

节点图定义一个样式组如何受光：Blender 风格的节点和带类型的接口，编译为 WGSL 并实时生效。
在 **材质** 中点击组的节点图并选择 **编辑图**，或打开 **着色器图库**。

### 内置套组

| 套组 | 节点图 | 核心做法 |
| --- | --- | --- |
| **AG**（深空之眼） | Body、Eye、Face、Hair、Metal、Rough Cloth、Smooth Cloth、Stockings | Lambert 接色带，叠加一层 Lit 光泽 |
| **WuWa**（鸣潮） | Body、Cloth、Hair、Face、Metal、Eye | 半兰伯特经过窄阈值、暖色过渡带、球面贴图、边缘光 |
| **ZZZ**（绝区零） | Body、Cloth、Eye、Face、Hair、Metal | Lambert 量化为遮罩，亮部和暗部分支分别着色 |
| **HSR**（崩坏：星穹铁道） | Body、Face、Hair、Cloth、Metal、Eye | `light` 节点和球面贴图 |
| **舞台** | Lit、Wood、Tile、Stone、Plaster、Metal、Lacquer、Fabric、Neon、Stage Surface、Glass、Glass Shell、Bottle Glass、Water、Foliage、Terrain | Unity 的 Lit；*Water* 使用 `time` 和 `reflection_probe`，*Foliage* 使用哈希透明 |

未分组的材质使用中性的默认节点图，新建节点图也从它开始。内置节点图都不带图片：它们读取材质
自己的贴图和球面贴图，因此适用于任何模型。

### 编辑

- **添加节点**：右键画布，或使用可搜索的添加菜单。
- **连接**：从输出拖到输入；类型不兼容时无法连接。
- **未连接的输入** 使用节点上的数值。
- **设为输出**：每个图只有一个输出，必须是颜色或浮点数。
- **预览输出** 可以把任意接口显示到画面上。图看起来不对时，从输出往回逐个预览，第一个出错的
  接口就是问题所在。
- **生成的 WGSL** 显示图编译后的代码。

节点位置只影响布局。节点图可以在编辑器顶部导入和导出 JSON。

### 节点图文档

```jsonc
{
  "version": 1,
  "name": "My Graph",
  "nodes": [
    { "id": "tex", "type": "texture" },
    { "id": "diff", "type": "material_diffuse" },
    { "id": "base", "type": "mix/multiply", "inputs": { "fac": 1.0 } },
    { "id": "shade", "type": "lambert" },
    { "id": "band", "type": "ramp_constant_aa",
      "inputs": { "edge": 0.35, "color0": [0.62, 0.58, 0.72, 1], "color1": [1, 1, 1, 1] } },
    { "id": "lit", "type": "mix/multiply", "inputs": { "fac": 1.0 } }
  ],
  "links": [
    { "from": { "node": "tex",   "socket": "color" }, "to": { "node": "base", "socket": "a" } },
    { "from": { "node": "diff",  "socket": "color" }, "to": { "node": "base", "socket": "b" } },
    { "from": { "node": "shade", "socket": "value" }, "to": { "node": "band", "socket": "fac" } },
    { "from": { "node": "base",  "socket": "color" }, "to": { "node": "lit",  "socket": "a" } },
    { "from": { "node": "band",  "socket": "color" }, "to": { "node": "lit",  "socket": "b" } }
  ],
  "output": { "node": "lit", "socket": "color" }
}
```

这是一个完整的卡通着色器：贴图乘以材质颜色，再乘以量化为两档的漫反射光照。可选的 `params`
数组把节点输入暴露为实时滑块；`tags` 用于素材库搜索。所有节点类型和接口见
[附录 D](#附录-d-着色节点速查)。

### 两种主干

**Lambert 做法**（AG）：`texture` × `material_diffuse`（`mix/multiply`，`fac 1`；不乘的话无贴图
材质会显示为白色），然后 `lambert` 的 `value` 接 `ramp_constant_aa` 得到色阶，或接
`ramp_linear` 得到柔和过渡，再乘到底色上。边缘光用 `layer_weight/facing` 接 `mix/add_emit`。

**自建光照项**（WuWa、HSR）：`light.direction` · `geometry.normal` 经过 `vector_math/dot`，
再 `math/multiply_add`（0.5, 0.5）得到半兰伯特；用 `map_range` 取一个窄窗口（例如 0.46–0.54）
得到硬分界线；`ramp_linear_3` 从暗部经过暖色带到亮部；乘到贴图上。然后加入场景光照：
`light.color × band × light.shadow + light.ambient`，向白色混合一半，这样材质会响应太阳
颜色、环境光和投影，又不会被环境光的色相带偏。最后用 `sphere_map` 加上模型自带的高光。

### 编译器检查的规则

- `version` 为 1。节点 id 唯一且符合 `/^[a-z0-9_]+$/`；`type` 必须是注册表中的准确 id
  （`math/power`）。
- 每个输入最多一条连线；不能有环；`output` 必须是颜色或浮点数。
- 最多 **64 个节点**、**16 个参数**。
- 数值必须符合接口类型：标量可以扩展到颜色和向量，向量用在浮点接口上会报错。色带的颜色停靠点
  是 `vec4` 数值，不能连线。
- 承载被处理值的接口（`invert.color`、`separate_xyz.vector`、`lit.base_color`、色带的
  `fac`）必须连线或显式填写数值。
- 参数只能指向未连接的输入，每个接口一个，类型为 `float` 或 `color`。要暴露色带停靠点，
  请经过一个 `mix/*` 节点并暴露它的颜色输入。
- 类型会自动转换：颜色转浮点取 BT.601 亮度，浮点转颜色会扩展，向量转浮点会被拒绝（请用
  `separate_xyz`）。
- **坐标系为左手、Y 轴向上。** Blender 的 `(x, y, z)` 在这里是 `(x, z, y)`；法线的垂直分量是
  `separate_xyz.y`。

**导入节点图 JSON** 会在进入画布前校验文件。在编辑器之外，reze-engine 提供
`validateGraph(graph)` 和 `compileGraph(graph)` → `{ ok, wgsl, diagnostics }`；环和缺失的连线
由编译检查。

### 从 Unity Shader Graph 迁移

光照遵循 **Unity 的 URP**：光源使用 Unity 的单位（强度为 1 的白色太阳正对表面时按 1:1 照亮
反照率），粗糙度的含义与 Unity 相同；一个表面要么是 **Lit**，要么像卡通 Shader Graph 那样用主光源
自己搭建。数学（39 种）、向量数学（24 种）和混合（20 种）运算与 Blender 相同，包括其保护措施，
行为与 Shader Graph 中对应的节点一致。节点的模式是类型的一部分：设为 Power 的 Math 是
`math/power`，色带的插值方式决定使用哪个 `ramp_*` 类型。

| Shader Graph | reze |
| --- | --- |
| Lit 主栈（Base Color、Metallic、Smoothness、Normal、Emission、Occlusion、Alpha） | `lit` |
| Main Light（方向、颜色、阴影衰减）、Ambient | `light` |
| 自定义光照：`LightingLambert` + 环境光 | `lambert` |
| Reflection Probe | `reflection_probe` |
| Sample Texture 2D | `texture`（材质自己的贴图）· `tex_image/0…3`（样式组的贴图） |
| Position、Normal、View Direction、UV | `geometry`、`uv_map` |
| Sample Gradient | `ramp_constant`、`ramp_linear`、`ramp_cardinal`；三个停靠点用 `ramp_linear_3` |
| Math、Vector、Lerp、Blend | `math/…`、`vector_math/…`、`mix/…` |
| Fresnel Effect | `fresnel`、`layer_weight/…` |

会影响数值的差异：

- **光照**：没有屏幕空间 GI。`lit` 已经包含反射探针（或天空），不要再叠加 `reflection_probe`。
- **视图变换**：在 **后期 → 色调** 中与源文件保持一致。
- **Lit**：Unity 的金属度工作流，电介质高光为 0.04，没有清漆和绒面。Alpha 小于 1 时保留反射
  （Unity 的 Preserve Specular Lighting），请配合混合方式为 **预乘** 的样式组。
- **着色就是颜色**：每个节点都返回颜色，卡通外观先求出光照（`lambert`、`light`），再用 `mix/…`
  组合颜色。
- **节点太多**：折叠常量子树，删除转接点和框，展开节点组。Normal Map、Displacement 和 AOV
  Output 没有对应项。
- **角色专用的图片**（高光贴图、ID 遮罩、面部 SDF）无法迁移。用 ID 遮罩区分区域的地方，请改用
  样式组。

请说明哪些内容没有迁移过来：悄悄降级的材质会被后来的人当成渲染器的问题。

### MMD 的惯用做法

- **卡通色阶**：在光照项上用 constant 或抗锯齿 constant 色带，两到三档，不要用渐变。
- **边缘光**：fresnel 或 facing 接自发光，保持较弱。
- **眼睛** 需要单独的节点图：更平、更饱和、受光更少。
- **头发** 需要沿静止姿态位置的条状光泽；均匀的高光看起来像塑料。
- **丝袜** 需要哈希透明才能正确穿过层次排序，样式组的角色会处理这一点；可以从 *AG Stockings*
  开始。

节点图每帧对其组内的每个像素运行，因此铺满画面的服装比眼睛开销大得多。请同时检查特写和远景。

## 2.5 草稿 发布与可见性

调色、特效和节点图遵循同一套流程。

- **你的草稿会随时保存** 在本地，在素材库的 **本地** 筛选中。
- **其他编辑都是临时的**：内置预设、别人的作品、直接在样式组上做的外观。关闭时可以选择保存为
  草稿或丢弃（丢弃后场景恢复原样）。
- **发布** 会把草稿变成你名下的素材，可以 **公开** 或 **私有**。私有素材只有你能看到；公开后
  不能再改回私有。要公开一个私有素材，在素材库中右键它的卡片，选择 **设为公开…** 并确认。同一作者同一类型下名称唯一。
- **覆盖发布自己的素材会替换它**，通过 id 引用它的场景也会跟着更新：调整你的调色或特效，使用
  它们的场景也会随之变化。
- **节点图例外。** 样式组保存自己的节点图副本，场景保持发布时的外观。重新选择外观才会使用
  新版本。
- **内置预设** 以引用的形式保存，由应用本身解析，因此只使用内置预设的场景无需网络或数据库也能
  渲染。

---

# 附录 A 控件速查

**场景**

| 位置 | 控件 | 范围 |
| --- | --- | --- |
| 灯光 → 环境光 | 颜色、强度；角色补光颜色、强度 | 0–2；0–4 |
| 灯光 → 太阳 | 阴影、颜色、强度、方位角、仰角 | 0–6、0–360°、0–90° |
| 灯光 → 灯 | 开关、颜色、强度、半径、X/Y/Z | — |
| 后期 → 调色 | 预设、强度 | 0–1，按预设分别记住 |
| 后期 → 色调 | Standard / Filmic / AgX、曝光 | — |
| 后期 → 泛光 | 强度、阈值、半径 | 0 为关闭 |
| 后期 → 描边 | 开关、粗细、统一颜色 | 粗细 0–5 |
| 角色 → 齿轮 | 缩放、位置、旋转、阴影 | 0.05–10×、±50、±180° |
| 环境 → 地面 | 显示、颜色、不透明度、大小、高度、渐隐、网格线 | 不透明度 0–1 |
| 环境 → 舞台 | PMX 文件夹 / GLB 文件、缩放、位置 | 0.05–10×、±50 |
| 相机 → 镜头 | 跟随 + 骨骼、视野、距离、方位角、仰角、目标点 | — |
| 相机 → 对焦 | 景深、强度 | — |
| 物理 | 模拟、重力、地面碰撞、风、频率、方向 | — |

**渲染**

| 控件 | 选项 |
| --- | --- |
| 输出 | 场景 · MP4、绿幕 · MP4、透明 · PNG 序列、透明 · WebM |
| 画面比例 | 16:9、9:16、2.39:1、1:1、4:3 |
| 画质 | 1080p、1440p、4K |
| 码率 | 标准、两倍 |
| 编码 | H.264、HEVC（MP4） |
| 范围 | `m:ss` – `m:ss`，留空为整段 |
| 音频 | 音乐、无 |
| 水印 | 开 / 关 |
| 其他 | 截取 PNG、AE 合成脚本、分享导出统计 |

**限制**

| 项目 | 上限 |
| --- | --- |
| 场景名称 | 60 字符 |
| 简介 | 500 字符 |
| 标签 | 5 个，每个 16 字符 |
| 借物表 | 4,000 字符 |
| 发布包 | 2 GB |
| 封面 | 20 MB，建议 1080p 截取 |

---

# 附录 B 去哪里找模型 动作和音乐

- **BOOTH**（`booth.pm`）：pixiv 的商店，大部分持续维护的模型都在这里。搜索 `MMD モデル`。
- **Niconi Solid**（`3d.nicovideo.jp`）：Niconico 的模型站，包括 Crypton 官方模型。
- **BowlRoll**（`bowlroll.net`）：大部分动作的下载站，通常由 Niconico 视频或推文提供链接，
  有时需要其中给出的密码。
- **模之屋 Aplaybox**（`aplaybox.com`）：大型中文模型站，B 站 MMD 和虚拟主播社区常用。
- **DeviantArt**：长期的欧美社区；请优先使用原作者页面。

舞蹈动作和镜头通常按歌曲一起发布：搜索歌名加 `モーション配布`。音乐方面，VOCALOID 作者通常
允许非商业二次创作，DOVA-SYNDROME（`dova-s.jp`）等素材库对此有明确说明。发布会上传音频，
因此音乐是场景中版权最敏感的部分。

---

# 附录 C 术语表

**ASC CDL**：调色背后的斜率/偏移/幂颜色变换。

**借物表**：列出所用每个模型、动作、特效和音乐及其作者的清单。发布时必须填写。

**骨骼**：模型骨架中的关节；动作文件按名称控制骨骼。

**卡通着色 / 三渲二**：把光照量化为平坦的色阶。

**等距柱状投影**：2:1 的全景图，用于天空盒和 HDR 世界光。

**外部親**：MMD 中把一个物体挂到另一个物体骨骼上的方式；道具使用这种方式。

**GLB**：二进制 glTF，从 Blender 导入舞台使用的格式。

**调色**：作用于整个完成画面的颜色变换。

**MME（MikuMikuEffect）**：桌面版 MMD 的 DirectX 9 特效插件。这里对应的是场景特效和节点图。

**表情（Morph）**：命名的形变，通常是面部表情。

**PMX / PMD**：MMD 的模型格式；PMX 是当前格式。

**节点图**：定义表面如何受光的节点网络。

**样式组**：共用一个节点图的一组材质。

**利用規約**：模型的使用条款。发布前请阅读。

**VMD**：Vocaloid Motion Data，可以是身体动作、表情或镜头动作。

**WGSL**：WebGPU 着色语言；特效用它编写，节点图编译为它。

---

# 附录 D 着色节点速查

编译器接受的所有节点类型及其准确的接口名，来自 reze-engine 的注册表（151 种）。一个节点图最多
64 个节点、16 个参数。

## 节点族

每种运算一个类型 id，写作 `family/operation`。

| Type | In | Out | Operations |
| --- | --- | --- | --- |
| `math/…` | `a` `b` `c` | `value` | `absolute` `sqrt` `inversesqrt` `exponent` `sign` `round` `floor` `ceil` `truncate` `fraction` `sine` `cosine` `tangent` `arcsine` `arccosine` `arctangent` `radians` `degrees` `subtract` `divide` `logarithm` `minimum` `maximum` `less_than` `modulo` `floored_modulo` `snap` `pingpong` `arctan2` `multiply_add` `compare` `smooth_min` `smooth_max` `wrap` `add` `multiply` `power` `greater_than` `clamp01` |
| `vector_math/…` | `a` `b` `c` `scale` | `vector` | `normalize` `absolute` `floor` `ceil` `fraction` `add` `subtract` `multiply` `divide` `cross` `project` `reflect` `minimum` `maximum` `modulo` `snap` `scale` `multiply_add` `faceforward` `wrap` |
| `vector_math/…` | `a` `b` `c` `scale` | `value` | `dot` `distance` `length` |
| `vector_math/…` | `a` `b` `c` `ior` `scale` | `vector` | `refract` |
| `mix/…` | `a` `b` `fac` | `color` | `add` `subtract` `darken` `difference` `exclusion` `screen` `soft_light` `dodge` `burn` `divide` `hue` `saturation` `value` `color` `blend` `overlay` `multiply` `lighten` `linear_light` |
| `mix/…` | `a` `b` | `color` | `add_emit` |
| `vector_transform/…` | `vector` | `vector` | `world_to_camera` `camera_to_world` `point_world_to_camera` |
| `tex_image/…` | `uv` | `color` `alpha` | `0` `1` `2` `3` |
| `separate_color/…` | `color` | `h` `s` `v` | `hsv` |
| `separate_color/…` | `color` | `h` `s` `l` | `hsl` |
| `combine_color/…` | `h` `s` `v` | `color` | `hsv` |
| `combine_color/…` | `h` `l` `s` | `color` | `hsl` |
| `map_range/…` | `from_max` `from_min` `to_max` `to_min` `value` | `value` | `linear` `smoothstep` |
| `vector_rotate/…` | `angle` `axis` `center` `rotation` `vector` | `vector` | `axis_angle` `euler_xyz` |
| `layer_weight/…` | `blend` `normal` | `value` | `fresnel` `facing` |
| `bump/…` | `height` `normal` `strength` | `vector` | `world` |
| `tex_voronoi/…` | `scale` `vector` | `value` | `f1` |
| `tex_voronoi/…` | `scale` `vector` | `color` | `color` |

## 节点

| Type | In | Out |
| --- | --- | --- |
| `texture` | — | `color` `alpha` |
| `time` | — | `value` |
| `geometry` | — | `normal` `view` `world_pos` `rest_pos` `uv` `reflection` `footprint` |
| `light` | — | `direction` `color` `ambient` `shadow` |
| `head_basis` | — | `forward` `right` `up` |
| `material_alpha` | — | `value` |
| `material_specular` | — | `color` |
| `material_shininess` | — | `value` |
| `material_diffuse` | — | `color` |
| `sphere_map` | `base` `strength` | `color` |
| `rgb_curve` | `color` `fac` `y0` `y1` `y2` `y3` `y4` | `color` |
| `uv_map` | — | `uv` |
| `normal_map` | `color` `strength` | `normal` |
| `attribute` | — | `color` `fac` |
| `object_info` | — | `location` `color` `random` |
| `light_path` | — | `is_camera_ray` `is_shadow_ray` `ray_depth` |
| `separate_color` | `color` | `r` `g` `b` |
| `combine_color` | `r` `g` `b` | `color` |
| `combine_xyz` | `x` `y` `z` | `vector` |
| `gamma` | `color` `gamma` | `color` |
| `map_range` | `value` `from_min` `from_max` `to_min` `to_max` | `value` |
| `value` | `value` | `value` |
| `rgb` | `color` | `color` |
| `hue_sat` | `hue` `saturation` `value` `fac` `color` | `color` |
| `bright_contrast` | `color` `bright` `contrast` | `color` |
| `invert` | `fac` `color` | `color` |
| `ramp_constant` | `fac` `pos0` `color0` `pos1` `color1` | `color` `alpha` `fac_out` |
| `ramp_linear` | `fac` `pos0` `color0` `pos1` `color1` | `color` `alpha` `fac_out` |
| `ramp_cardinal` | `fac` `pos0` `color0` `pos1` `color1` | `color` `alpha` `fac_out` |
| `ramp_constant_aa` | `fac` `edge` `color0` `color1` | `color` `alpha` `fac_out` |
| `ramp_linear_3` | `fac` `pos0` `color0` `pos1` `color1` `pos2` `color2` | `color` `alpha` `fac_out` |
| `ramp_tri` | `fac` | `value` |
| `fresnel` | `ior` | `value` |
| `lambert` | `normal` | `color` `value` |
| `separate_xyz` | `vector` | `x` `y` `z` |
| `vect_cross` | `a` `b` | `vector` |
| `mapping` | `vector` `loc` `rot` `scl` | `vector` |
| `bump` | `strength` `height` `normal` | `vector` |
| `tex_noise` | `vector` `scale` `detail` `roughness` `distortion` | `value` |
| `tex_gradient` | `vector` | `value` |
| `lit` | `base_color` `metallic` `smoothness` `occlusion` `emission` `alpha` `normal` | `color` `alpha` |
| `reflection_probe` | `vector` `smoothness` | `color` |
