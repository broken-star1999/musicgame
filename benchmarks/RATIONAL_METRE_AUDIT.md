# RME1-Q：联合有理节拍与物理起音编谱原型，已拒绝

**固定 original41 缓存筛查为 FAIL；候选没有进入运行源码。** 五段已观察音乐的单指 head70 F1 宏平均提高0.199405，但 disco 退步超过单风格代理阈值，且分钟／handoff 主控制退步，违反已冻结门槛。退出0只表示一次筛查机械完成。没有扩大到210段、增加新音乐、修改门槛、移植运行源码、提升版本或部署。

对照 B 是 main 的纯算法 V12，提交`aeaf78284cb66601fd02bf9e40eaf99642285689`；C 是本归档的 RME1-Q。两者真实 Chart.version 均为12，未做版本归一化。全部数据来自唯一已完成缓存运行及其终端汇总；导出没有调用算法或重新测量。

## 候选做了什么

RME1-Q 从原同一次分析留下的 mixed／low／mid／high 起音流按精确物理时间分组，保留成员身份，不移动或合成起音。它消费原 tempo investigation 的全部有效周期／相位候选（至多88个基础状态），将主拍、二／三／四分细分与全局事件游标联合选择；beam 上限104，因此不宣称全局精确最优。稀疏匹配使用有限兼容性和角色代价，每个物理事件及 target 最多匹配一次。候选条件下的既有12维 chroma 聚合提供附加内容证据，没有新 FFT、模型、下载或来源分类器。

应用桥接用实际匹配的 primary target 首末闭边界形成几何，保留内部虚拟 target，但音符头只来自实际物理事件。自动 RME 保留原始事件时间；mixed unknown 未分配事件不受新全局 confidence/grid snap 影响，所有区域使用新的有限 selection utility。全 unknown 返回同一 baseline 对象。手动 BPM 使用原角色重绑定及旧选择路径。旧角色、周期旋转对称、提前重音和双速歧义仍不能凭这些工程先验自动解决。

## 验证范围与调用

固定清单41例＝36个合成控制＋5段已观察 GTZAN 音乐。B 成功缓存36例＝31个控制＋5段音乐；另5例继承 B 的正常拒绝。主控制组16例＝15个成功缓存＋1个继承静音拒绝。五段音乐只是五个风格代理，不能代表完整十风格总体，也不是新留出或官方基准。

实际发生36次应用调用，全部返回，得到36个已完成 graph；对每个返回值四模式各预定运行两次 C Chart，共288次调用并全部返回。B Analysis 与 Chart 来自原实际 V12 golden，B Chart 未重跑；36个 Analysis 和144个 Chart 的身份直接核对。所有144个 C 模式结果均通过确定性、可玩性及路线检查；这些只验证机械性质。

本轮 **B/C Analyzer、PCM 读取、FFT、fresh、sealed、ledger 调用全部为0**。只使用已缓存 Analysis、caller、investigation、chroma 和原标注测量结果。这是缓存应用／Chart 筛查，不能称为本轮端到端音频识别测试，不能据此声称手机速度或加载体验改善。5个继承拒绝没有 C 分析器或应用调用，不是新增 C 拒绝能力、弃权正确性或端到端状态一致性验证。

graph 固定数学验证通过851条断言，bridge 30例通过113条断言；数学正确性没有使质量 FAIL 变成 PASS。数学报告身份在 JSON 中保留。

## 五段音乐全部18项宏平均

指标为 head／clock／pulse ×50／70ms ×F1／precision／recall。head 是单指谱面的去重音符头；clock 是 Analysis.rhythm.beats 拍点序列（B 低支持时可能与实际编谱参考网格不同）；pulse 是物理候选池，三者不能互换。沿用原 distinct-nearest 一对一测量，无 offset 搜索、预测裁切、参考重采样或失败免除。所有宏始终以原5段 B 成功音乐为分母。下表仅为阅读保留六位小数，JSON/CSV 保存原完整数值；门槛使用原数值严格比较。

| 指标 | B | C | Δ |
| --- | ---: | ---: | ---: |
| head50F1 | 0.437459 | 0.641487 | 0.204028 |
| head50Precision | 0.450416 | 0.666532 | 0.216116 |
| head50Recall | 0.442842 | 0.639699 | 0.196857 |
| head70F1 | 0.512817 | 0.712222 | 0.199405 |
| head70Precision | 0.526498 | 0.740074 | 0.213575 |
| head70Recall | 0.520363 | 0.710769 | 0.190406 |
| clock50F1 | 0.394694 | 0.597412 | 0.202718 |
| clock50Precision | 0.345854 | 0.553178 | 0.207324 |
| clock50Recall | 0.489526 | 0.694670 | 0.205143 |
| clock70F1 | 0.480293 | 0.668277 | 0.187983 |
| clock70Precision | 0.415081 | 0.614048 | 0.198968 |
| clock70Recall | 0.606213 | 0.784453 | 0.178240 |
| pulse50F1 | 0.429476 | 0.392067 | -0.037409 |
| pulse50Precision | 0.345280 | 0.305143 | -0.040137 |
| pulse50Recall | 0.694119 | 0.716658 | 0.022539 |
| pulse70F1 | 0.481367 | 0.440452 | -0.040915 |
| pulse70Precision | 0.390183 | 0.345599 | -0.044583 |
| pulse70Recall | 0.765926 | 0.790953 | 0.025028 |

## 逐段结果与失败门槛

| 音乐 | B head70 | C head70 | Δ head70 | Δ head50 | Δ clock70 | Δ pulse70 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| country.00022 | 0.500000 | 0.623377 | 0.123377 | 0.124402 | 0.178313 | -0.065329 |
| hiphop.00013 | 0.039216 | 1.000000 | 0.960784 | 0.960784 | 0.659026 | -0.036185 |
| jazz.00035 | 0.760563 | 0.735294 | -0.025269 | -0.033969 | 0.180839 | -0.030303 |
| classical.00011 | 0.280702 | 0.280702 | 0.000000 | 0.000000 | 0.000000 | 0.000000 |
| disco.00031 | 0.983607 | 0.921739 | -0.061867 | -0.031076 | -0.078261 | -0.072761 |

六项原 PULSE 规则不变：宏 head70 gain≥0.02、宏 head50 gain≥0、宏 clock70 gain≥0.02；每个观察风格代理的 head70 Δ≥−0.03；每段 head70 Δ≥−0.15；每个 B 成功案例的四指实测头数量比≥0.95。另要求分钟和 handoff 控制单指 head50/head70 不退步，并保留全部机械检查。

失败项恰为 `everyObservedGenreProxy` 与 `primaryMinuteHandoffOne50And70NonDecrease`。Disco head70 Δ=-0.061867426942266546，低于−0.03；分钟控制 head50/head70 均退步-0.004149377593360981，handoff 均退步-0.3866666666666667。没有增加 epsilon、负项例外或舍入补救。

## 全部16个主控制

| 控制 | head50 B→C | head70 B→C | 本轮范围 |
| --- | ---: | ---: | --- |
| 00-primary-minute-layered | 1.000000 → 0.995851 | 1.000000 → 0.995851 | 实际应用返回 |
| 01-primary-vibrato-drums | 1.000000 → 1.000000 | 1.000000 → 1.000000 | 实际应用返回 |
| 02-primary-first-frame-0 | 1.000000 → 0.974359 | 1.000000 → 0.974359 | 实际应用返回 |
| 03-primary-first-frame-0.1 | 1.000000 → 1.000000 | 1.000000 → 1.000000 | 实际应用返回 |
| 04-primary-first-frame-1.2 | 1.000000 → 1.000000 | 1.000000 → 1.000000 | 实际应用返回 |
| 05-primary-first-irregular | 1.000000 → 0.800000 | 1.000000 → 0.800000 | 实际应用返回 |
| 06-primary-boundary-close-regular | 0.975610 → 0.975610 | 0.975610 → 0.975610 | 实际应用返回 |
| 07-primary-boundary-before-later | 1.000000 → 0.944444 | 1.000000 → 0.944444 | 实际应用返回 |
| 08-primary-dynamics-quiet-opening | 1.000000 → 1.000000 | 1.000000 → 1.000000 | 实际应用返回 |
| 09-primary-dynamics-tail01 | 1.000000 → 1.000000 | 1.000000 → 1.000000 | 实际应用返回 |
| 10-primary-dynamics-tail002 | 1.000000 → 1.000000 | 1.000000 → 1.000000 | 实际应用返回 |
| 11-primary-dynamics-loud-mid-accent | 1.000000 → 1.000000 | 1.000000 → 1.000000 | 实际应用返回 |
| 12-primary-dynamics-noise-tail | 1.000000 → 1.000000 | 1.000000 → 1.000000 | 实际应用返回 |
| 13-primary-dynamics-vibrato-tail | 1.000000 → 1.000000 | 1.000000 → 1.000000 | 实际应用返回 |
| 14-primary-dynamics-subthreshold | — | — | 继承 B SILENCE，未调用 C |
| 15-primary-fullpcm-handoff | 1.000000 → 0.613333 | 1.000000 → 0.613333 | 实际应用返回 |

全部5个继承拒绝为：`14-primary-dynamics-subthreshold` (SILENCE)；`24-old10-stationary-noise-amp0.008-seed101` (INSUFFICIENT_ONSETS)；`25-old10-silence` (SILENCE)；`26-abstention-stationary-noise-seed101-amp008` (INSUFFICIENT_ONSETS)；`32-abstention-persistent-vibrato-amp006` (INSUFFICIENT_ONSETS)。它们在 JSON 中保持显式继承状态与0调用，不补造 C 结果。

## 完整负项、四指与长按

公开表保留36个成功案例全部648个 primary 指标单元（36×18），其中 **198个严格负项**，以及四模式／两容差／三统计中的 **104个严格负项**。这些不是198首或104首歌曲，也不限于单指。所有144个模式的完整测量保留于 JSON，不只留下失败或改善的选择性片段。

四指36例数量比全部≥1，通过原0.95门槛；但20ms身份保留最低0.9024390243902439（disco），不是全部物理头完全保留。数量、身份、F1 和可玩性分别报告。144行长按／密度表保留前后 hold、tail、note、unique-head、finger-peak、4s最大头密度与持续秒数；不把增加密度或合法路线当作音乐识别改善。

唯一子进程退出0，用时5079.3745ms；子进程报告用时4959.5621ms。点采样最大 RSS=210247680B；系统资源记录 maxRSS=205332KiB。360秒／512MiB V8 old-space 限制不是连续 RSS 硬上限，常规 GC 时机不受控制，也不是手机整机测量。

## 归档文件与未启用补丁

- [完整诊断 JSON](rational-metre-diagnostic.json)：全部18项宏及逐案例、198负项、104模式负项、144模式统计、继承拒绝、调用、门槛与来源身份。
- [primary18 全表](rational-metre-primary18.csv)：648个单元，含严格负项标志。
- [全部模式负项](rational-metre-all-mode-regressions.csv)：104行。
- [四指保留](rational-metre-four-finger.csv)：36行，数量比和20ms身份分别保留。
- [长按与密度](rational-metre-hold-density.csv)：144行。
- [已拒绝、未启用的完整候选补丁](prototypes/clock-rational-metre-rejected-v12.patch)。

补丁从当前 main 的实际24源文件复制图到本次冻结 C 图生成，6个既有路径变化、5个新模块，共29个源文件。新模块为 conditional-content、metrical-matching、rational-metre、rational-application 和 rational-selection。原 Chart.version12 保持不变。隔离索引没有创建 scratch commit；另一份 ignored 基线树已用普通 `git apply --check` 并实际应用，应用后29文件逐字节等于冻结 C 图，相对导入闭合。补丁87774B，SHA256=`9acc3be07e710c121bbe4a1e77b3da88654368eeebe292bab5e6548dc9da858b`。**它供研究审查，未应用到运行源码。**

公开材料不包含音乐、PCM、完整真值时间数组或个人绝对路径。导出没有再调用候选、修改参数或重跑筛查。数据登记表保持210段／89次运行／89次冻结。本次没有210广测、封存新音乐、实际源码移植、版本提升、ledger写入、主分支合并或新部署。失败否定的是此固定候选在既定门槛下的资格，并不证明所有有理层级或纯算法方法无效。

主要身份：筛查冻结 `8fbe92377ba9b868e09e7dc5903365f90aa311eb94bd9720897d97c952608613`；终端报告 `44bab63c4b27c5e9a147e65d1a0e720975213caf955d9762b0696058eb46e501`；终端汇总 `0edffa2f86bee764335daf3116cf61f71ed354debcba2f6099e3ba2618ba46e9`。完整29文件身份及数学报告 hash 见 JSON。
