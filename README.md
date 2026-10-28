# 节拍坠落 / Beatfall

手机横屏四轨音游。导入自己的音乐，在浏览器内分析声音起点并自动编谱；在底部判定线点击、长按，或按箭头左滑、右滑、上滑。

[在线试玩](https://broken-star1999.github.io/musicgame/) · [GitHub 仓库](https://github.com/broken-star1999/musicgame)

参考用户提供的游戏视频，采用上窄下宽的透视轨道、向判定线靠近的音符、长按光带及击打粒子。保留四轨混合音符，舞台为原创程序绘制的霓虹背景。

## 本地启动

需要 Node.js 20.19+ 或 22.12+，建议使用 Node.js 22 LTS。

```bash
npm ci
npm run dev
```

打开终端显示的地址，通常为 http://127.0.0.1:5173/。首次进入会自动生成一首约 47 秒的原创演示曲和谱面，无需自行寻找音频。

```bash
npm test          # 核心节奏、谱面与判定测试
npm run build    # TypeScript 检查和生产构建
npm run preview  # 预览 dist 中的生产版本
```

## 使用方法

1. 导入 MP3、WAV、M4A、OGG 或 FLAC 文件。最大 50 MB，时长 2 秒至 5 分钟；具体格式支持由浏览器决定。也可以直接使用内置演示曲。
2. 选择简单、普通或困难；它们的密度、滑动比例和同时操作上限分别递增，最多需要两指、三指、四指。
3. 选择下落方式和速度。默认「透视推进」随轨道变宽平滑加速，使每秒位移与当前轨道宽度的比例保持一致；「屏幕匀速」保持恒定的屏幕纵向像素速度。两种方式都在同一时间到达判定线，速度设置只影响视觉提前量，不改变音乐节奏。
4. 网页默认使用横向布局，选歌、设置、游戏和结算保持同一方向。手机锁定竖屏时整页会自动侧转 90°，无需关闭系统旋转锁；自然横屏时正常铺满。触控区是判定线附近及其下方的四块区域。
5. 单点音符轻触对应轨道；长按保持至尾部到达判定线；滑动从对应轨道起手，沿箭头方向短划至少 24 CSS 像素，主方向要明确，无需跨轨。
6. 歌曲结束后查看成绩，重试或返回选歌。自动演示可观察谱面，不记录最佳分数。

「音量与校准」提供音量、−300～+300 ms 判定偏移以及 BPM 修正。正偏移代表判定时刻更晚，负偏移更早。BPM 修正仅影响接近节拍的起点对齐及节奏编排，不会把歌曲强行改成固定速度。

Perfect 为 ±45 ms，Great 为 ±90 ms，Good 为 ±140 ms，超时为 Miss。权重分别为 1、0.75、0.4、0；长按首尾各为一个等权判定单位。分数归一化为 100 万，准确率为已判定单位的加权平均，Miss 中断连击。

手动暂停、切后台、系统取消触点或游玩中改变屏幕方向会暂停音乐和谱面。竖屏进入游戏时可直接游玩。恢复前倒计时 3 秒；如暂停时存在长按，需在倒计时内重新按住原轨道，未重新按住的长按尾部会判为 Miss。自动演示不需要重新按住。全屏是可选功能，浏览器不支持时仍可正常游玩。

右上角固定提供全屏按钮，选歌、游戏和结算时均可使用；进入全屏后点击同一位置退出。不支持全屏的浏览器会显示提示并继续保持横向页面布局。

## GitHub Pages

网站地址为 **https://broken-star1999.github.io/musicgame/**。

`.github/workflows/pages.yml` 会在推送到 `main` 时自动安装依赖、运行测试、构建，并发布 `dist` 到 GitHub Pages。仓库的 Settings → Pages → Source 使用 **GitHub Actions**。也可以在 Actions 中手动运行该工作流。

Vite 使用相对资源路径 `base: './'`，使脚本、字体、图标和分析 Worker 同时适配 GitHub Pages 的 `/musicgame/` 子目录与 EdgeOne 的根目录。页面内部切换菜单与游戏，不需要服务端路由。

## 部署到 EdgeOne Makers

项目是纯静态应用，不需要 API Key、服务端或数据库。先把源码上传到自己的 GitHub 仓库，**不要上传 `node_modules`、`dist`、`.qa` 或个人音频/视频文件**。这些目录已加入 `.gitignore`。

在 EdgeOne Makers 中选择「导入 Git 仓库」，连接 GitHub 并选择项目：

| 设置 | 值 |
| --- | --- |
| 根目录 | 仓库根目录 |
| 安装命令 | `npm ci` |
| 构建命令 | `npm run build` |
| 输出目录 | `dist` |
| Node.js | 22 |
| 环境变量 | 无 |

这些构建参数也写入了根目录 `edgeone.json`。使用 HTTPS 部署，发布后检查首页、Worker 加载、音频导入和完整演奏流程。应用使用单页内部状态切换，没有需要单独配置回源的子路由。

可参考 [EdgeOne Git 部署说明](https://edgeone.ai/document/70404) 和 [edgeone.json 配置说明](https://pages.edgeone.ai/document/edgeone-json)。GitHub Pages 与 EdgeOne 可共用此仓库；EdgeOne 部署由仓库所有者在腾讯控制台连接后进行。

手机测试本地服务时，可以运行 `npm run dev -- --host 0.0.0.0`，在同一局域网用电脑的局域网地址访问。正式部署的 HTTPS 地址更适合验证手机兼容性。

## 实现结构

- `src/core/analysis.ts`：使用 fft.js 计算 1024 点实数 FFT，结合低/中/高频正向频谱变化、自适应阈值和局部峰值检测。用实际声音起点的间隔估计 BPM，并返回节拍置信度、能量包络和音频指纹。`analysis.worker.ts` 将计算放在 Web Worker 中。
- `src/core/chart.ts`：从实际起点生成稳定的谱面；有限对齐节拍，基于持续能量编排长按，基于重音编排滑动；限制同轨间隔、长按重叠和同时操作数量。相同浏览器解码结果及难度产生相同谱面。
- `src/core/judgment.ts`：独立、可测试的判定状态机，处理长按首尾、手势方向、暂停后长按重抓和分数。
- `src/core/audio.ts`：音频解码、本地原创演示曲、单声道降采样和以 `AudioContext.currentTime` 为基准的播放时钟。
- `src/components/Game.tsx` 与 `renderer.ts`：Pointer Events 多触点追踪、暂停恢复和 Canvas 2D 透视舞台。音符位置由时间直接计算，丢帧不会累积位移误差。舞台光效参考已分析的能量包络。

内部谱面结构为版本 1：音频指纹、难度、时长、BPM 和音符列表。音符包含编号、0～3 轨道、秒单位时间及 `tap | hold | left | right | up` 类型；长按额外包含结束时间。无公共后端 API。

音频、分析数据和谱面只在当前页面内存中保留。只有设置与最佳分数进入 `localStorage`；刷新后需重新导入歌曲。字体、图标和程序资源随构建打包，不依赖运行时字体 CDN。演示曲为程序原创合成，个人歌曲与参考视频未放入源码或构建产物。

自动谱面属于信号分析和游戏编排，不是精确的乐器转录或人工谱。复杂变拍、弱鼓点、混响较强的曲目可能有偏差；不同浏览器的解码/重采样细节也可能导致少量音符差异。

### 开源组件

| 组件 | 用途 | 许可证 |
| --- | --- | --- |
| [React](https://github.com/facebook/react) | 界面与状态 | MIT |
| [Motion](https://github.com/motiondivision/motion) | 菜单、帮助与结算动效；遵循系统减少动态效果设置 | MIT |
| [fft.js](https://github.com/indutny/fft.js) | 实数频谱变换 | MIT |
| [Lucide](https://github.com/lucide-icons/lucide) | 界面图标 | ISC |
| [Fontsource](https://fontsource.org/) 的 Barlow Condensed / DM Sans | 本地打包字体 | SIL OFL 1.1 |

依赖锁定于 `package-lock.json`，原许可证保留在各依赖包中，并汇总于 `THIRD_PARTY_NOTICES.md`。依赖更新后可运行 `node scripts/third-party-notices.mjs` 重新生成。

## 验证

`npm test` 覆盖已知 BPM 的合成鼓点、前置静音、变速片段、静音/极低音量拒绝、50 ms 起点误差目标、谱面可重复性、同轨冲突、难度上限、判定边界、四轨独立输入、滑动方向、长按松手、暂停后重抓及自动演示。

可使用本地歌曲执行额外分析测试，需要已安装 `ffmpeg`，歌曲路径通过临时环境变量提供，不复制歌曲到仓库：

```powershell
$env:BEATFALL_TEST_AUDIO = 'C:\path\to\your-song.flac'
npm test
```

该测试会输出 BPM、起点数量、三档音符分布，并检查同轨间隔、时长边界、同时操作上限和重复生成。FFmpeg 与浏览器的重采样路径不同，数量可能略有差异。

真实测试使用用户提供的《九万字 - 黄诗扶》FLAC：约 232 秒，估计 130 BPM；初次浏览器普通谱为 549 个音符。该估计不是经人工确认的歌曲官方 BPM。

桌面 Chromium 和手机尺寸模拟可验证页面流程及布局；Android Chrome/Edge、iPhone Safari 的真实多指手感、蓝牙延迟和系统中断恢复仍需真机验证。

详细验证结果见 `QA_REPORT.md`。轨道在判定线处结束，下方为平面底栏；渲染与触控共用几何计算，避免透视边界与矩形按键错位。
