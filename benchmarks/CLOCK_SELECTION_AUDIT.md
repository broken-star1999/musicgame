# 节拍证据、时钟与编谱选择审计

公开文件由已经完成的纯 DSP 实验捕获导出；**导出阶段不再执行分析、优化或参数搜索**。W、S、D、L、PULSE、R 都未形成可采用的新版本。当前运行源码已回到原 v11；临时 R v12 仅用于开发对照，未发布。

研究基线为 `067e0501b6704a1895c44429fd5219fc14362b27`。研究提交 `99bd987` 的运行源与该基线相同，提交中的研究材料不等于运行算法更新。本文与原 rubato 研究并列，未修改旧实验结果。

## 先区分三种证据范围

| 范围 | 材料与用途 | 可以说明什么 |
|---|---|---|
| W/S、实际 R 的 210 段 | 十 genre，各21段；全部此前已观察 | 固定开发诊断的整体与负例结果；不能称新盲测 |
| W/S valid-v2、D、L、PULSE valid-v2、R valid-v2 | 原36段已知PCM控制 + 5段已观察音乐；其中5个控制为正常拒绝，36组成功分析 | 数学／接线／结构验证及已知音乐取舍；D/L/PULSE没有210段结果 |
| 频带缓存审计 | 同5段已观察音乐的冻结缓存，全段和既有4秒窗 | 描述证据在哪一步可见；没有替代时钟、新预测或因果证明 |

210 段使用七个固定索引组：0/7/19、3/11/23、5/13/29、2/17/31、6/18/33、4/22/35、8/21/34，每组十 genre ×3。已准备的新9/10/12材料未消费，未运行 ASAP 或其他新音乐。

主18指标为 head／clock／pulse ×50／70ms ×F1／precision／recall，沿用原 distinct-nearest 匹配，不裁预测、不搜索 offset、不缩放 reference；仅排除不在实际PCM时长内或非有限数值的参考时间。多指 head 对同一参考拍点计分，不是人工谱面对全部可接受细分的完整质量评价。

四指数量沿用“去重head在自身原候选±20ms内”的口径；身份保留是与baseline实测head的±20ms匹配。候选可能包含边界cue，因此它们不等同于已证实物理上升沿。数量与身份单列，不能只报总数保持就称谱面完全相同。

## 固定候选做了什么

- **W／S**：仅改 `trackBeats` 的第一个输入。B为原 mixed+selected 合并并加权；W只用原selected再加原跨频带并发权重；S只用原selected。原selected指边界恢复与canonical绑定之前的 `musicalOnsets`，不是最终扩充的pulse。其余参数、原全曲BPM种子、来源上下文、调查器、门控、完整lag DP、编谱和指法都保持基线。
- **D**：仅把普通q状态的事件奖励从 `E(t)` 改为 `E(t)·q/local[t]`；free/start奖励、周期和连续性惩罚、domain、terminal、trace都不变，exactHull与独立brute同步修改。它消除平坦local、等能量时的部分拍数偏好，不能预先认定这就是音乐错误原因。
- **L**：固定audiojs/beat上游 `beatTrack` 的缓存ODF比较器，接收原100Hz E；不是npm高层完整PCM端到端结果。完整保留上游拍点、真实confidence及向开头外推段。
- **PULSE**：按FMP定义独立实现局部Fourier相位／重叠相加，固定100Hz E、8秒对称Hann、2秒hop、50～222整数BPM及精确上端222.222…、最小峰间隔25帧。它不是librosa逐字移植，也未证明与librosa结果等价。数学依据见 [FMP PLP](https://www.audiolabs-erlangen.de/resources/MIR/FMP/C6/C6S3_PredominantLocalPulse.html)；可对照版本固定的 [librosa 0.11.0 PLP源码](https://librosa.org/doc/0.11.0/_modules/librosa/beat.html)。
- **R**：只对明确signal引擎，把原strength²+.005总分改为优先，角色数量仅在原1e−10数值tie时比较；保留质量调用前声明的boundary cue不能驱逐冲突合格实测候选的guard。未知引擎／beat-this保持原roles策略，前置role筛选、gap、物理时间、hold、指法不变。实际port临时将chart容器11改为12以隔离最佳成绩。

## 210段结果：三条方向均被拒绝

| 候选 | 单指head50 F1 | 单指head70 F1 | clock50 F1 | clock70 F1 |
|---|---:|---:|---:|---:|
| B原v11 | .633062 | .692744 | .654195 | .723545 |
| W | .604920 | .662415 | .615098 | .679775 |
| S | .590433 | .646813 | .598669 | .662847 |
| 实际R | .628848 | .687614 | .654195 | .723545 |

W／S单指head70改善／下降／不变分别为39/78/93和44/94/72；clock70为43/86/81和51/98/61。四指数量最小比率均.608696，身份最低W=.556818、S=.545455。已知country22的小范围改善不能抵消整体与数量损失。结果支持保留混合证据，拒绝本次剔除非selected声部的两种固定方案。

实际R的单指head70改善21段、下降45段、不变144段。head70 Δ−.0051299571、head50 Δ−.0042141828，没有达到事先声明的+.01与非下降门槛。最差genre为blues（−.019326），最差单段blues.00022（−.108019）。R虽然没有越过genre−.03／clip−.15／四指数量.95这些界限，仍然不通过整体改善条件。

| 实际R模式 | head50 Δ | head70 Δ | 70ms改善／不变／下降 |
|---|---:|---:|---:|
|单指|−.004214|−.005130|21/144/45|
|二指|−.022296|−.023748|24/91/95|
|三指|−.021475|−.023029|17/80/113|
|四指|−.001823|−.001765|12/164/34|

R保留全部254条主18指标负例、1,676条全模式P/R/F1负例。它们是“指标行”数量，不是独立歌曲数。其四指数量最低.989130、身份最低.884615；数量下降3段、身份低于1的86段均保留。全部1,680份正式谱面合法、确定、route-checked，直接复核单指长按内部冲突为0。

R的210对完整Analysis JSON字节完全相同，rhythm、pulse、source sections、raw candidates各210对也完全相同。这由额外调用前冻结的直接sidecar证明，而非从旧报告未保存的原始向量推断。1,680个sidecar完整chart SHA全部复现正式CLI；baseline210个完整官方对象复现原067。正式CLI实际使用默认源入口及当前chart SUPPORT，未以QA入口冒充实际port。

主结果完整保留真实version12。只在单独辅助副本顶层12→11后，5首×4模式的20个fullchart SHA与旧冻结R小实验相同；未用映射后的SHA或数字作为主输出。sidecar增加420次分析／1,680次编谱验证，不是额外独立样本。

固定genre内、seed20261030、10,000次配对bootstrap的R head70 Δ95%区间为[−.0080059184,−.0023775779]，head50为[−.0067448103,−.0017999384]。统计结论只条件于固定十genre，没有artist/work独立性或总体推广保证。

## 小样本候选不能混写成210段验证

D的451帧新数学例在45与50倍数的并集设置等能量、local50：旧目标最优45间隔，目标10.6325622536；D选择50间隔，目标10。hull／独立brute全状态精确一致。这是新合成数学控制，不是真实音乐GT。音乐没有相应整体改善：country22 head70 .500000→.493506，jazz35 .760563→.704225；保留18条全模式F1负例，未扩大到210段。

L在jazz35有head70 .760563→.818182、clock70 .554455→.901408，但四指实测头50→40，数量.8、身份.74；country22／HP13／classical11退步。100→180与反向变速等控制明显退步，54条全模式F1负例均保留，未扩大到210段。

PULSE在HP13 head70 .039216→.424779、clock70 .039604→.554745，但jazz35下降；disco31 head70 .983607→.771930，Δ−.211677，已超过预写−.15容忍值，不作豁免。额外八分音符／等强八分音符控制head70也下降，可能选到更强细分层。29条全模式F1负例均保留，未扩大到210段。

原R小实验16条全模式F1退步仍保留，包括minute三指.824742→.760943、四指.681818→.670455的50／70ms退步。minute与handoff单指仍各120／38头、F1=1，不因此抹去高模式负例。每组的正常静音／起点不足拒绝均按原状态保存，未把正常拒绝当意外算法崩溃。

## audiojs源码审计与L的范围

固定提交为 `b7a294a5f7bbc9726f9119b9d3304ef569ef7c6a`：beat伞包3.0.0、track1.1.0、tempo2.0.0、onset1.0.3。`detect`产生固定网格；`beatTrack`只估计一次全曲combTempo目标周期，再做固定目标附近的单前驱DP，没有局部BPM轨迹、前一lag状态或来源身份。因此不能因文档措辞称它为已验证的自适应音乐时钟，也没有四轨编谱能力。见 [track](https://github.com/audiojs/beat/blob/b7a294a5f7bbc9726f9119b9d3304ef569ef7c6a/packages/beat-track/track.js)、[类型与缓存接口](https://github.com/audiojs/beat/blob/b7a294a5f7bbc9726f9119b9d3304ef569ef7c6a/packages/beat-track/index.d.ts)、[comb](https://github.com/audiojs/beat/blob/b7a294a5f7bbc9726f9119b9d3304ef569ef7c6a/packages/beat-tempo/comb.js)。

L采用源码层缓存 `Symbol.for('@audio/onset:odf')`，`beatTrack(null,opts)`；fs100／hop1／frameSize2只确定ODF物理帧坐标，保留默认min60／max200／tightness680，不传GT或本项目BPM种子。tempo从实际输出间隔派生，downbeats=[]／meterConfidence=0明确未知。confidence保留所选DP帧原ODF质量占全曲ODF质量的真值；不是正确率，也不改成1。完整保留库向开头外推的拍点，不能按GT或静音裁掉；其confidence分子本身不计这些外推拍。

源码缓存路径的本地raw/cache严格等价验证是后续比较器的独立测试，不是上游CI已验证的cache回归。早期审计manifest的“0算法调用”仅描述当时源码审计，不能覆盖后来实际L运行。运行链没有神经网络、远程权重或后端；FFT2.4.0／window3.0.1不是手机性能保证。上游根[LICENSE](https://github.com/audiojs/beat/blob/b7a294a5f7bbc9726f9119b9d3304ef569ef7c6a/LICENSE)含MIT全文并附Krishnized链接；本交付不复制第三方源码，不自行扩张许可含义。

## 五首频带缓存审计：有线索，没有新算法

本审计没有analyzer／optimizer／chart／新数据调用。原regular candidates精确multiset减去原regular mixed onsets，保留重复次数，恢复三条原measured streams；先过滤boundary再去除装饰字段。selected读取trace.sourceOnsets，不能用已经canonical扩充的pulse代替。所有band显著度按检测器自身reference归一化，不是可直接跨频带相加的绝对声学能量。

| 片段 | GT数 | B命中／预测 | PULSE命中／预测 | PULSE新增／丢失GT | GT／B未匹配的低频存在率 |
|---|---:|---:|---:|---:|---:|
|country22|31|19/64|27/92|9/1|87.10%/53.33%|
|HP13|51|2/50|38/86|37/1|82.35%/52.08%|
|jazz35|35|28/66|30/97|3/1|80.00%/2.63%|
|classical11|38|22/70|15/57|1/8|15.79%/16.67%|
|disco31|62|62/62|44/65|0/18|88.71%/空|

HP13的低频存在率总体可分，但12–20秒GT与旧错侧均100%，错侧显著度反而更强；16–20秒并发均值同为2。旧错48/48都有至少两band，GT为49/51；E邻域强度旧错.4249高于GT.3514，selected邻域覆盖GT80.39%／错83.33%。所以“多band就是真拍”“更强就是对拍”“selected有覆盖就正确”均得不到支持。classical几乎没有中高stream，不能泛化低频规则。PULSE新增命中与额外预测、丢失GT同时保留。

代码层面，E的Gaussian/max标量投影确实不保留band／贡献者身份；此前weighted预处理已带入部分跨band并发增益，不能称完全丢弃并发信息。缓存统计不能把错相位单因归给丢band，也不能保证新增特征纠正正确quarter层级。更丰富瞬态／频谱证据与节拍层级是后续假说，尚未实现或验证。

公开的2,160行band表只有全段／固定4秒窗统计，没有原始anchors、streams或GT时标数组。`clockProjected`主统计保留门控置零记录，“有记录”不能当“正证据”；私有只读companion按strength>0区分，两者没有混写。

## 失效记录、门槛与回退

- W/S首个harness误用namespace覆盖canonical入口，产生27个完整Analysis不一致；原结果保留并排除数值导出，valid-v2只修export接线，未改候选。
- PULSE首版B-trace临时变量重名，编译预检失败，数学／音乐调用均0；v2只改trace临时名和输出路径，stock实现与参数相同。
- R首个harness读取exports而非exports.api，82个TypeError均发生在分析前，调用0；valid-v2只改绑定与启动断言。
- L首稿误把ODF生成测试称cache等价测试，已作文字勘误；随后本地等价测试独立记录。D没有该类失效。
- R210汇总在JSON／CSV写完后最后console的局部变量名错误，修正仅限console，没有重跑音乐或改指标。所有有效报告中的正常拒绝与意外错误分类在JSON／CSV中区分。

前瞻规则原字节复制为 [clock-selection-qualification-nov1.json](clock-selection-qualification-nov1.json)，SHA256 **19b1377a6cde8002d962316330bb7f647ed7dfe145ef37c2de0c7eea687f5d65**。它在R／PULSE质量结果前写定，未按结果调整。R／PULSE必须先满足开发条件才能选择一个实际源码候选冻结后申请新材料验证；当前没有候选通过，未消费新30。

临时R12草案的453通过／1跳过及build通过只证明当时行为和构建，不是音乐质量通过，也不是回退后的当前测试数量。父任务归档五文件diff后主动回到HEAD99bd原v11，并重建dist；此为实验结束后的明确回退，不是运行中源码漂移。公共ledger保留75条，原210clip记录与原68条前缀不变，R12未发布。

## 交付索引与复核

- [compact JSON：范围、冻结SHA、各源文件SHA、错误分类](clock-selection-diagnostic.json)
- [W/S210全18指标](clock-selection-ws210-paired.csv) · [全部退步](clock-selection-ws210-regressions.csv) · [四指保留](clock-selection-ws210-four-finger.csv) · [十genre](clock-selection-ws210-genres.csv)
- [R210主18指标](clock-selection-r210-primary18.csv) · [主指标退步](clock-selection-r210-primary-regressions.csv) · [四模式head](clock-selection-r210-all-mode-heads.csv) · [四模式全部退步](clock-selection-r210-all-mode-regressions.csv) · [hold／tail／密度](clock-selection-r210-hold-density.csv) · [四指保留](clock-selection-r210-four-finger.csv)
- [小样本五首表（独立scope）](clock-selection-small-observed.csv) · [所有小样本状态](clock-selection-small-status.csv) · [固定窗口频带统计](clock-selection-band-windows.csv)

研究补丁及其独立副本git-apply／逐字节复核在 [prototype manifest](clock-selection-prototypes.json)。W/S/D以原067为base；PULSE公开独立local-pulse文件和rhythm差分；R公开的是被拒绝的五文件v12草案（含临时version12和当时测试），不代表新发布。补丁只供研究审阅，不自动应用到当前源码。

公开产物均为LF后计算artifact SHA；不包含音乐、reference数组、原始GT／anchor／stream时间向量、用户绝对路径或签名URL。统计导出和git-apply验证均没有执行算法。
