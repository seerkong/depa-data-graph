# Stream as source — Superseded historical alternative

## 目录职责

- **holds**：本目录仅保存 Stream-as-source/桥接方案被比较、否决和取代的历史理由，供迁移决策追溯。
- **excludes**：不保存当前规范性目标设计；目标态归入 `../unified-graph/` 与 `doc/architect/`。
- **tier**：`stable`
- **promotes_from**：统一图决策前的渐进迁移探索、比较记录与 track 分析。
- **promotes_to**：仅晋升为决策历史或迁移复盘材料，不投影为当前实现/API。

This bridge-oriented proposal is superseded by the accepted [Unified DataGraph target](../unified-graph/). Signal/Stream conversion and event projection are now explicit unified graph nodes; `GraphBridge` and related bridge APIs are deleted.
