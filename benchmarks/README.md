# 节拍识别开发比较：GTZAN 30 段

[逐曲报告](gtzan-30-v7.json) 记录真实运行的 ONNX/WASM 模型、前处理、节拍解码与四档编谱，包含模型/源码/输入 PCM 哈希。对照为 `4878ef958cbdd837e6697284e34fa67fb5bc9506` 的版本 6。

该记录对应版本 7 初始发布提交 `0b8d88641aac09d84a84d5127ebd7a5002799f44`。后续的模型下载进度、超时与线程恢复修复未改变推理及编谱算法；源码哈希按产生报告时的提交解释。

样本在 10 类风格中各固定取 `00000`、`00007`、`00019`，共约 15 分钟。人工标注使用 [Beat This! annotations](https://github.com/CPJKU/beat_this_annotations) 的 `fd9fcc0896cb78730bae735102c8753ef3a3badd`（v1.1 修正版）。音频来自 [GTZAN / Marsyas 数据](https://huggingface.co/datasets/marsyas/gtzan)，只作本地验证，不随本项目分发。

Beat This! 的训练排除 GTZAN；但这些 30 段用于本次开发和参数比较，**不是盲测，也不是全 GTZAN 的官方成绩**。没有用模型自己的预测当作节拍真值。

| 逐曲平均 | 版本 6 | 版本 7 增强 |
| --- | ---: | ---: |
| 节拍 F1，±70 ms | 0.6820 | 0.8427 |
| 节拍 F1，±50 ms | 0.6141 | 0.8121 |
| 单指音符头对人工节拍 F1，±70 ms | 0.5244 | 0.7775 |

21 段改善、4 段持平、5 段退步。报告保留全部失败样本：

| 退步样本 | 旧节拍 F1 | 新节拍 F1 |
| --- | ---: | ---: |
| blues.00000 | 0.9920 | 0.9841 |
| classical.00007 | 0.7339 | 0.4375 |
| metal.00019 | 0.5679 | 0.3664 |
| reggae.00019 | 0.9931 | 0.6667 |
| rock.00000 | 0.9836 | 0.8361 |

F1 采用容差内一对一匹配，分别计算精确率和召回率，再逐曲平均；不去掉开头五秒。半速/倍速也会被指标惩罚。单指会主动降低密度，人工节拍不包含全部合理旋律/切分落点，因而单指音符头 F1 **不是玩家准确率，也不是整张谱的音乐质量评分**。本报告没有完成逐键的人类听感评审。

## 本地复现

普通玩家、项目构建和部署无需以下准备。基准运行使用 Node.js，转换输入需要 FFmpeg 及 Python 标准库，不需要 Python 模型环境。请按数据来源的使用条款取得 GTZAN 音频，放在 `.qa/gtzan`；不要将音乐提交到 Git。

```bash
npm ci
git clone https://github.com/CPJKU/beat_this_annotations.git .qa/beat-annotations
git -C .qa/beat-annotations checkout fd9fcc0896cb78730bae735102c8753ef3a3badd
python scripts/prepare-beat-benchmark.py --audio .qa/gtzan --annotations .qa/beat-annotations/gtzan/annotations/beats --out .qa/beat-benchmark-input
node scripts/prepare-benchmark-baseline.mjs
node scripts/benchmark-beats.mjs --data .qa/beat-benchmark-input --baseline .qa/baseline/src/core --out .qa/reproduced-benchmark.json
```

Windows 可以将 `python` 换成 `py -3.12`。基准顺序运行随网站发布的实际 WASM 模型，可能需要几分钟，输出时长只代表运行机器。省略 `--baseline` 时，对照改为当前版本的轻量识别，不再是历史版本 6。历史对照需要本地 Git 中有该提交；浅克隆需先取得提交历史。

准备脚本将音频转为 22050 Hz / 单声道 Float32 PCM，并提取人工 `.beats` 第一列。浏览器采用自己的解码与抗混叠前处理，因此实际网页数量可能略有不同。脚本检查四档谱面的时间、占用和路线约束；它不能替代手机输入、内存或主观手感测试。

同频干扰的自合成声音另由 `tests/beat-inference.test.ts` 检查：真实鼓点时间独立于模型输出，参考数值来自未修改的原始 Torch small0 推理，用于检查 WASM 与跨块一致性。它不包含用户歌曲。
