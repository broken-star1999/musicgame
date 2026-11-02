# UA1 共享物理起点：封闭缓存诊断

本轮 **技术数学 PASS、保存结果一致性 PASS，音乐质量门槛 FAIL；手机与端到端音频未测试**。本页记录一个未启用的纯算法研究候选，不改变当前运行版本，不构成上线或扩大测试授权。统计从唯一已结束的 original41 缓存实验投影；本次公共导出没有执行候选、匹配器、编谱器或音频处理。

UA1 把四路原始声音起点先合并为共享物理事件，每个事件只有一份单位质量，再交给已接受的节拍估计与跟踪器。随后只把真实事件分配到主拍／半拍／四分拍角色；没有匹配到事件的参考位置不会生成 head。它是对共享观测与角色绑定的研究，不能把数学不变性或样例均值改善等同于人耳认可的主拍。

## 同时保留改善与退步

| 项目 | B | C | C − B |
| --- | ---: | ---: | ---: |
| 五曲宏 Head 70 ms F1 | 0.512817476 | 0.607573193 | +0.094755717 |
| 五曲宏 Clock 70 ms F1 | 0.480293363 | 0.614983764 | +0.134690402 |
| 五曲宏 Pulse 70 ms F1 | 0.481367103 | 0.420541448 | -0.060825655 |
| Country：Head 70 ms F1 | 0.500000000 | 0.386363636 | -0.113636364 |
| Disco：Head 70 ms F1 | 0.983606557 | 0.864000000 | -0.119606557 |
| 一分钟 layered 控制：Head 70 ms F1 | 1.000000000 | 0.125490196 | -0.874509804 |

Head70 宏平均提高 **+0.094755717**、Clock70 提高 **+0.134690402**，但 Country 与 Disco 的 Head70 分别下降 **−0.113636364／−0.119606557**，一分钟控制下降 **−0.874509804**。原门槛中的每种已观察曲风代理不得低于 −0.03，以及一分钟／handoff 单指 50／70 ms 不下降两项失败。没有按歌曲跳过质量门槛，也没有设置例外。完整严格下降列表为 **83 个指标单元、104 个模式单元**，全部保留在 [诊断 JSON](unified-attacks-diagnostic.json)。

| 五个固定已观察片段 | B Head70 F1 | C Head70 F1 | C − B | 四指 head 数量比 C/B | 四指原 head 20 ms 保留率 |
| --- | ---: | ---: | ---: | ---: | ---: |
| country.00022 | 0.500000000 | 0.386363636 | -0.113636364 | 1.126437 | 0.827586 |
| hiphop.00013 | 0.039215686 | 0.653846154 | +0.614630468 | 1.042945 | 0.907975 |
| jazz.00035 | 0.760563380 | 0.828571429 | +0.068008048 | 1.140000 | 0.900000 |
| classical.00011 | 0.280701754 | 0.305084746 | +0.024382991 | 1.400000 | 1.000000 |
| disco.00031 | 0.983606557 | 0.864000000 | -0.119606557 | 1.065041 | 0.886179 |

五个片段只代表这五个开发集曲风代理；它们不是十曲风总体，也不是独立新歌测试。36 个成功缓存全部保留为配对分母，另有 5 个先前 B 拒绝案例。本轮没有读取新／封存音频或扩大至原 210 项。

## 技术检查与调用边界

- 物理事件／给定节拍角色两原语实际数学检查：**1812** 条断言通过，atom 49 次入口（38 返回、11 抛出），role 34 次入口（24 返回、10 抛出）。独立暴力 oracle 涵盖交替低鼓／军鼓、复制与幅度不变性、链式邻近、闭区间及下一 ULP、边界起点、空观测／休止、强反拍和均匀八分音符不可辨识性。这里没有调用音乐跟踪器。
- 实际 application 的固定字面起点检查：**831** 条断言通过，14 次 F/C 入口（10 返回、4 抛出）；六个成功 C 返回内部使用已接受的 tempo／tracker。内部次数由源码推定，未独立拦截；这也不是音乐质量实验。
- 唯一缓存实验：F **36/36** 返回，去掉唯一新增统计字段后整个 Analysis 与 B 一致；**144/144** 实际 F Chart 与原黄金文件字节一致。F 没有重复计分，公共 JSON 的 F 原始分数明确引用同一配对中的 B。
- C **36/36** application 返回，**288/288** Chart 调用返回。144 个模式保存首份谱面，全部具有合法性／可玩性／指法检查和两次调用确定性记录。第二份谱面没有单独保存，因此公共归档不声称拥有第二份独立完整文件。
- 独立事后 fs／哈希／字段／算术检查：**242460** 条断言、**1008** 个原始命中分数公式、18 个宏、全部 83／104 个严格下降单元通过一致性复核；468 个保存文件、2583 个 atom、7448 个原始 member、2367 个角色绑定与 4677 个空目标没有 head 的记录相符。该 PASS 不覆盖音乐门槛 FAIL。
- 四指 head 数量比最小 **1.000000**，20 ms 原 head 保留率最小 **0.668103448**。144 个模式的 B/C notes／heads／holds／tails／holdSeconds／4 秒密度／peakFingers／合法性／确定性／身份与所有命中原始计数只在 JSON 的配对模式块中保存一次，避免重复大表。

Head 指单指谱面去重后的 head；Clock 指 `Analysis.rhythm.beats`。**Pulse 定义为 `uniqueHeads(analysis.pulse?.onsets ?? analysis.onsets)`**，它包括 materialized pool 的 free 物理候选，不能当成主拍时钟或只含 primary 的集合。50／70 ms 分数包含 hits／predicted／reference，公式为 `P=h/max(1,p)`、`R=h/max(1,r)`、`F1=2h/max(1,p+r)`；事后只核算已存命中数，没有重新执行匹配器。

缓存子进程只运行一次，exit 0，5081.362 ms 后关闭，没有重试或超时。Node 的缓存进程采样不是手机加载速度、完整解码耗时、连续 RSS 上限或人耳踩点验证。Android／iOS／浏览器触控与音频恢复本轮均未测。

## 保存数据能定位到的失败环节

独立因果字段审阅完成 **14393** 条检查，没有执行新匹配或反事实候选；公共 JSON 只投影七项的统计，原时间／成员 ID tape 留在 QA。

一分钟控制的原 120 个 primary 分别落在 120 个独立 family，**合并丢失为 0**，原时间、强度与频带仍保留在 canonical pool。新时钟 seed 从 120 变为 133 BPM，间隔中位数从 0.5 秒变为约 0.45 秒。原 family 中仅 14 个仍是主拍，39 个为 half、23 个为 quarter、44 个未绑定；新 135 个 primary 中有 121 个来自其他 family，单指保留全部 135 个。这些事实指向时钟／角色解释改变，不能归因为把原主拍合没了，或下游 Chart 把这些新主拍删掉了。

Disco 的原 60 个 primary 也都在独立 family；53 个仍是 primary，5 个变 half、1 个 quarter、1 个未绑定，新 63 个 primary 中另有 10 个其他 family。原 primary 到代表点的绝对位移平均约 5.01 ms，最大约 40.09 ms，且单指保留全部 63 个新 primary。角色选择与代表时间都变了；没有新的参考匹配／反事实时钟，不能把保存结果减少的 6 个命中独归于 median 位移或某一种角色变化。原 B 的 primary 标签本身也不是真值。

handoff／噪声鼓点／100→180 控制的原 primary 家族与时间基本保持；噪声例仍含既有多余事件，不是无噪声恢复。HipHop 的改善同时存在 1 个新 primary 被单指省略；Jazz 的 35 个新 primary 全保留。改善、保留与遗漏都在 JSON 的因果统计及完整配对结果中保留，不能据此豁免整体验证失败。

## 全部 18 个五曲宏指标

下表显示九位小数便于阅读；JSON 保留原始双精度值，门槛按原值严格比较，没有 epsilon 或四舍五入放宽。

| 指标 | B | C | C − B |
| --- | ---: | ---: | ---: |
| head50F1 | 0.437459084 | 0.526128597 | +0.088669513 |
| head50Precision | 0.450416237 | 0.529805646 | +0.079389410 |
| head50Recall | 0.442841925 | 0.544563020 | +0.101721096 |
| head70F1 | 0.512817476 | 0.607573193 | +0.094755717 |
| head70Precision | 0.526498108 | 0.610808152 | +0.084310044 |
| head70Recall | 0.520363147 | 0.630287008 | +0.109923861 |
| clock50F1 | 0.394693734 | 0.515508440 | +0.120814706 |
| clock50Precision | 0.345853652 | 0.503338807 | +0.157485155 |
| clock50Recall | 0.489526378 | 0.544429955 | +0.054903578 |
| clock70F1 | 0.480293363 | 0.614983764 | +0.134690402 |
| clock70Precision | 0.415080628 | 0.599407043 | +0.184326415 |
| clock70Recall | 0.606213256 | 0.652241895 | +0.046028639 |
| pulse50F1 | 0.429475590 | 0.373782098 | -0.055693492 |
| pulse50Precision | 0.345279940 | 0.275828642 | -0.069451298 |
| pulse50Recall | 0.694118693 | 0.723672083 | +0.029553390 |
| pulse70F1 | 0.481367103 | 0.420541448 | -0.060825655 |
| pulse70Precision | 0.390182522 | 0.312139887 | -0.078042635 |
| pulse70Recall | 0.765925630 | 0.801193306 | +0.035267676 |

## 原质量门槛逐项结果

门槛常量与完整比较说明保留在 JSON；没有改写原 PULSE／minute handoff 要求。

| 原检查键 | 结果 |
| --- | --- |
| `macroHead70Gain` | PASS |
| `macroHead50NonDecrease` | PASS |
| `macroClock70Gain` | PASS |
| `everyObservedGenreProxy` | **FAIL** |
| `everyObservedClip` | PASS |
| `everyFourMeasuredCount` | PASS |
| `primaryMinuteHandoffOne50And70NonDecrease` | **FAIL** |
| `allModesPlayableDeterministicAndRouteChecked` | PASS |
| `noBSuccessLost` | PASS |
| `inheritedRejectsExplicitlyNotCalled` | PASS |
| `allOriginalTimesAndMembersPreserved` | PASS |
| `rawBaselineGoldenIdentity` | PASS |
| `fixedNormalizationAndSerializedChartInputs` | PASS |
| `featureOnlyWholeAnalysis` | PASS |
| `featureOnlyWholeChartGoldens` | PASS |
| `completeCallAccounting` | PASS |

## 先前 B 拒绝案例的边界

以下 5 项 F/C 都没有调用。它们仅继承原 B 状态，**不能称为 UA1 拒绝测试、UA1 静音验证或端到端状态一致性通过**。

| 固定案例 | 原 B 状态 | F application 次数 | C application 次数 |
| --- | --- | ---: | ---: |
| 14-primary-dynamics-subthreshold | SILENCE | 0 | 0 |
| 24-old10-stationary-noise-amp0.008-seed101 | INSUFFICIENT_ONSETS | 0 | 0 |
| 25-old10-silence | SILENCE | 0 | 0 |
| 26-abstention-stationary-noise-seed101-amp008 | INSUFFICIENT_ONSETS | 0 | 0 |
| 32-abstention-persistent-vibrato-amp006 | INSUFFICIENT_ONSETS | 0 | 0 |

## 源码证明与结果绑定

公开的非激活源码证明文件按字节原样复制，不改其中 `numericalResultBinding: null`。源码能应用／构建，与数值质量是否通过是两件事；结果侧由本页引用的诊断 JSON 另行绑定该三文件哈希、原缓存结果、两个数学报告及其 freeze、事后检查与 ROOT／因果审阅。此目录不包含音频、原始／参考时间序列、event／note／atom／member 数组、stack 或本机绝对路径。

- [unified-attacks-v12.patch](prototypes/unified-attacks-v12.patch) — Inactive ordinary git patch for the exact C28 source graph；SHA256 `048c441cd56662ab13244b3e1c56ed738d5ea698fec492480374767294452871`。
- [source-manifest.json](unified-attacks-source-manifest.json) — Inactive source provenance manifest with original null numerical binding；SHA256 `f98e7194dc6c5943e4a0b2b14e51dfa8ce59bdadb5125d9d9cdffa6c11746605`。
- [source-verification.json](unified-attacks-source-verification.json) — Actual ordinary git apply and exact C28 source reconstruction proof；SHA256 `dee0f3ba54be5108d66a47d710fa290cca588e3ac4e3af794e4100a07535ad17`。

| 保存证据角色 | SHA256 |
| --- | --- |
| cachedFreeze | `860a8d5f9b80c9bcdaeef37f05b0afdc7203f73897d834210704035db550542c` |
| cachedReport | `9ae995c0bd3c4d740bc77bcc39325f9ec9f1a82bcb7f7c2e0381592d815b3ddf` |
| cachedSummary | `5baa041c90bb3458121c3d18ab80e87547e2af7172ce74284986d4065756f160` |
| cachedInputs | `9eb2c10458d4af4e6b48fd9b0bf0eb06ccb2273c7ef621a9a721a765b214dfea` |
| closedChild | `8d3a60688251611090758db688804d3dbb985a9e5c03943b37bb5fc391524dac` |
| primitiveMath | `2cf8d4fa617b0c6c536fd28891abe1d2c65ebc5a1b2a10ce381e5e2f04603e3f` |
| applicationMath | `5fcc615bb3098dfcd428a91fdeffec5497e741f177d26ebfaae3579b248acb3b` |
| postflight | `9d406deece975a1af85a1593fdd0c6aa3b9693291ab64b6bb49d19917ba7e621` |
| rootReview | `31f3af06b8ef1204729092a505e048fbf9ebf652de91eee26b4f64cc01a80af2` |
| causalReview | `61434c332fb0e67fe3cfa1a918f7f9b592014aa79a9abb49bbce3d524d219dd5` |

基线为 `aeaf78284cb66601fd02bf9e40eaf99642285689`；B/F/C 都是 Chart12，没有把版本字段改名掩盖差异。公开 JSON 是统计投影，不是完整音乐数据重放包。原始命中数未重新匹配；route 证书未重新规划；内部 work 是 producer 自报。上述边界与质量失败同时保留，研究补丁不接入运行入口。
