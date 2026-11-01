# EC1：局部仿射节拍与有限路径原型，已拒绝

**固定original41缓存筛查为FAIL，候选未进入运行源码。** 分钟控制和Country、Hiphop、Jazz、Disco共5例触发8192搜索状态上限，应用没有成功返回。另有已完成案例把正常主拍选成慢一倍的层级，单指漏掉原主拍。四项数学验证通过不能替代复杂输入的资源与音乐质量验证。没有提高上限重跑、放宽门槛、扩大数据或部署。

对照B为accepted main的纯算法版本12，提交`aeaf78284cb66601fd02bf9e40eaf99642285689`；C为`EC1-affine/v1`，两者真实Chart.version均为12、没有归一化。当前网站继续使用既有纯算法。本原型没有神经网络、模型资源、推理库、后台服务或音乐上传。

## 候选改变了什么

原四条mixed／low／mid／high起音流与原周期／相位候选，经过最多四次局部centered OLS重估周期和相位。八秒上下文只用于拟合与资格，实际两秒owner单独评分；主拍、半／三／四分细分及未解释原事件显式分开。拟合保留initial和迭代中同准则最优的eligible状态，不宣称迭代收敛或连续空间全局最优。四条流是替代来源，mixed不重复投票；强度不决定时钟。

有限路径目标同时包含缺失主拍、未解释事件、主拍残差，以及明确的周期／相位连续代价。它保留完整未来相关上下文，并在超过资源预算时显式失败；这轮没有使用beam或丢弃状态后宣称精确最优。实际音符绑定原始物理ID／source成员／实际时间。参考几何以实际主拍为锚，仅在同chain缺少整数拍号时插值虚拟休止，不把这些参考当作物理音符。

编谱强度另用baseline-canonical-first/v1：既有物理时刻保持原canonical strength/band，新时刻取真实raw成员最大强度。新来源的strength仅作独立证据；四档归一化域按桥接前的原自动角色域冻结，自动／手动读同一可序列化arrangementSalience。whole unknown保留B所有旧字段、增加normalizer而无ECmarker。没有WeakMap或仅在QA存在的隐藏参数。

## 数学与实际筛查是不同证据

四个唯一数学stage均终态PASS：局部拟合22,063项断言（42调用，33返回／9拒绝）；有限路径403项（21调用，15返回／6拒绝）；完整readout8,687项（29调用，21返回／8拒绝）；桥接70项（1个实际oracle入口，helper调用点自报）。它们覆盖初始2%误差、缺拍、边缘halo、source接力、uniform别名、有限图穷举、实际角色绑定和JSON阈值传输。完整readout的owner内换手负控明确保留32个cue只出30个primary的结构限制，不称它为成功恢复；uniform快／慢两种解释也不被当作人类主拍真值。

实际缓存筛查仍为原41例＝36个合成控制＋5段已观察音乐；原B成功36例＝31控制＋5音乐，另5个B正常拒绝仅继承，C没有新分析调用。36次应用尝试中31次返回完成readout、5次异常；内部失败readout尝试未独立拦截，保守记录[0,5]。31个返回结果进行四模式各两次实际C Chart，合计248次全部返回；20个失败模式保持NOT_GENERATED。B的36份Analysis／144份真实Chart12由原golden缓存直接校验，未重跑B Chart。

31个返回Analysis中29份有ECmarker，另两份为`29-abstention-isolated4s-supported-weak-high`和`classical.00011`的全未知旧字段回退。C Chart输入先JSON序列化，实际验证固定阈值不依赖内存registry。返回子集124个实际模式结果通过机械检查；其四指数量及20ms身份保持原头，**不能代表失败的5例或整个候选通过**。

本轮B/C Analyzer、FFT、PCM、fresh、sealed和ledger调用均为0；实际评分调用988次。没有重新读取或试听音乐，不是端到端音频、实际手机或浏览器Worker测试。退出0只表示41条记录机械处理完毕，质量判定仍FAIL。

## 全部指标与失败分母

head为单指去重音符头，clock为Analysis.rhythm.beats，pulse为物理候选池。按原distinct-nearest一对一规则测量；不搜索offset、不裁切预测、不移除失败。四段音乐应用失败按空预测进入原5段音乐分母，因此下表反映功能失败代价，不能当作成功EC音乐跟踪器的对齐成绩。表格只保留六位小数，JSON／CSV保留完整精度，门槛严格按原值比较。

| 指标 | B | C | Δ |
| --- | ---: | ---: | ---: |
| head50F1 | 0.437459 | 0.049123 | -0.388336 |
| head50Precision | 0.450416 | 0.073684 | -0.376732 |
| head50Recall | 0.442842 | 0.036842 | -0.406000 |
| head70F1 | 0.512817 | 0.056140 | -0.456677 |
| head70Precision | 0.526498 | 0.084211 | -0.442288 |
| head70Recall | 0.520363 | 0.042105 | -0.478258 |
| clock50F1 | 0.394694 | 0.044444 | -0.350249 |
| clock50Precision | 0.345854 | 0.034286 | -0.311568 |
| clock50Recall | 0.489526 | 0.063158 | -0.426368 |
| clock70F1 | 0.480293 | 0.081481 | -0.398812 |
| clock70Precision | 0.415081 | 0.062857 | -0.352223 |
| clock70Recall | 0.606213 | 0.115789 | -0.490424 |
| pulse50F1 | 0.429476 | 0.048276 | -0.381200 |
| pulse50Precision | 0.345280 | 0.070000 | -0.275280 |
| pulse50Recall | 0.694119 | 0.036842 | -0.657277 |
| pulse70F1 | 0.481367 | 0.055172 | -0.426195 |
| pulse70Precision | 0.390183 | 0.080000 | -0.310183 |
| pulse70Recall | 0.765926 | 0.042105 | -0.723820 |

| 音乐 | C状态 | B head70 | C head70 | Δ |
| --- | --- | ---: | ---: | ---: |
| country.00022 | APPLICATION_FAILED | 0.500000 | 0.000000 | -0.500000 |
| hiphop.00013 | APPLICATION_FAILED | 0.039216 | 0.000000 | -0.039216 |
| jazz.00035 | APPLICATION_FAILED | 0.760563 | 0.000000 | -0.760563 |
| classical.00011 | ANALYZED | 0.280702 | 0.280702 | 0.000000 |
| disco.00031 | APPLICATION_FAILED | 0.983607 | 0.000000 | -0.983607 |

原六项PULSE规则不变：宏head70 gain≥.02、宏head50 gain≥0、宏clock70 gain≥.02、每风格代理head70 Δ≥−.03、每段head70 Δ≥−.15、每个B成功案例四指实测头数量比≥.95；另保留minute／handoff不退步和所有模式合法／确定／路线／单指长按约束。失败项为：`macroHead70Gain、macroHead50NonDecrease、macroClock70Gain、everyObservedGenreProxy、everyObservedClip、everyFourMeasuredCount、primaryMinuteHandoffOne50And70NonDecrease、allModesPlayableDeterministicAndRouteChecked、noBSuccessLost`。没有epsilon、负项豁免或按旧分数回退。

全部36×18＝648个primary指标单元中432个严格负项，四模式／两容差／三统计有278个严格负项，均完整保留。144行长按密度、36行四指保留包括失败行的零／未生成结果。不能只平均返回子集。

## 失败链路与保留下来的改进

五个失败的stack都指向chooseClockPath的精确frontier预算；没有保存失败owner、partial frontier、目标值或完整readout。这些信息保持未知，没有在原音乐上提高预算再运行。成功31例的最大自报frontier为5150、edgeTrials为899973，均在180→100控制；这些不是失败路径的峰值。

成功输出也显示层级问题：handoff选择19 primary＋19 half，P约1秒，单指19／38、二指38／38；100→180选择99 primary＋52 half，单指99／151、二指151／151。所有已选primary都进入单指，漏掉的主拍主要被分成细分，不能归咎于Chart吞掉primary。

weak-noise为16 primary＋16 half，单指16／32。其canonical strength／band改变数为0，固定域count34、q75=.871725004527625、阈值=.23，旧strength=.21654538588787178的boundary没有额外进入单指。原来的归一化联动已阻断，但它没有修好慢层选择，整例head70仍退步至2／3。

报告work是源码自报，外层应用／Chart计数才是wrapper实际计数。尤其fitWork.maximumPrimaryRecords／maximumSubdivisionRecords是**每次fit最大值的总和**，不是全局峰值、单次超限或手机内存。独立postflight已将此列为报告字段语义发现，原值保持不动。

## 源码与复核

独立cached-onlypostflight完成63,552项核对：410pins、253captures（7,923,643B）、124实际C谱面、988份计数公式、全部18宏／432与278负项／原分母及门槛一致。复核没有调用候选或metric matcher；它证明记录准确，不给算法发布资格。

- [完整诊断与31源manifest](event-affine-diagnostic.json)
- [全部648个primary指标单元](event-affine-primary18.csv)
- [全部278个模式负项](event-affine-all-mode-regressions.csv)
- [四指保留及失败行](event-affine-four-finger.csv)
- [全部144行长按密度](event-affine-hold-density.csv)
- [已拒绝、未启用补丁](prototypes/clock-event-affine-rejected-v12.patch)

补丁92462B，SHA256=`4da1fee05dc518b4fb39ab7d6052a4ffe5b730b657c8a2a8c9adcabde9cff454`。accepted main的B24到实际C31为6个修改、7个新增；独立QA树普通git apply --check及git apply通过，31个源文件逐字节等于冻结C图，目录／含type imports的闭包一致，无scratch commit。实际字段为Analysis.eventClock与Analysis.arrangementSalience；两个rational-*文件名仅为历史集成别名。补丁未应用到运行源码。

唯一child内部用时6649.9019ms、owner用时6789.099200000001ms；点采样最大RSS=270467072B，heapUsed=101593632B。512MiB V8 old-space／360秒预算不是RSS硬上限或手机实测。

公开材料去掉错误stack中的个人绝对路径，不含音频、PCM、原始音乐起音或真值时间数组。公共ledger保持210段／89runs／89freezes。没有重跑候选、runtime移植、版本提升、main合并或部署。后续需要证明安全的状态压缩，同时处理慢层偏置；仅提高上限不足以解决这些失败。

冻结`4eec7f0dac32df46ca018812d8ab0874a5a3aef69a162384f80668dd42274188`；终端报告`babe6ecaef6fa1a3c5f942b7ef41088476975cdb9aaafc975052388aab7af479`；汇总`45278df4e70a95c7465f5d8ad37f7c81f48605e27dee15e1d43d49a50c83c637`；独立postflight`1791a10699e9acfd11622f926724444b55f526e013ad3ebc62e4183654adc24d`。
